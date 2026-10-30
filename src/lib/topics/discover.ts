import { db } from "@/lib/db";
import { generateStructured, type StructuredTextClient } from "@/lib/ai/structured";
import { topicEvaluationPrompt, topicIdeasPrompt, type ReferenceBrief } from "@/lib/ai/topic-prompts";
import type { Pricing } from "@/lib/costs/pricing";
import { assertWithinBudget, type CostContext } from "@/lib/costs/record";
import type { ChannelGuide } from "@/lib/schemas/channel";
import { type DiscoverySnapshot, type TopicIdea, TopicIdeaBatchSchema, type TopicRatings, TopicEvaluationSchema, RATED_DIMENSIONS } from "@/lib/schemas/topics";
import { dedupeCandidates, similarity } from "@/lib/similarity";
import { normalizeTitle } from "@/lib/text";
import { comparableEvidence, honestStrategy, type ReferenceForScoring, scoreTopic, traction } from "./scoring";
import { Prisma, type ManufacturingTopicCandidate } from "@/generated/prisma/client";

/*
 * Evidence-based topic discovery:
 *   library → (1 call) ideas linked to references → drop repeats of stories,
 *   approved/used topics and library products → (1 call) reviewer ratings,
 *   reused for products rated in the last 30 days → score in code.
 */

/** Ideas written per run; a few are lost to repeats, the rest are scored. */
export const IDEAS_WRITTEN = 9;
/** Earlier ratings for the same product are reused for this long instead of paying again. */
const RATING_CACHE_DAYS = 30;
const RECENT_PROPOSALS_DAYS = 90;

export type DiscoveryDeps = {
  text: StructuredTextClient;
  pricing: Pricing;
  writer: string;
  reviewer: string;
  cost: CostContext;
};

export async function loadLibrary() {
  return db.manufacturingContentReference.findMany({ include: { metrics: { orderBy: { observedAt: "desc" } } }, orderBy: { createdAt: "asc" } });
}
type LibraryRef = Awaited<ReturnType<typeof loadLibrary>>[number];

function forScoring(r: LibraryRef): ReferenceForScoring {
  return { id: r.id, platform: r.platform, category: r.category, publishedAt: r.publishedAt, metrics: r.metrics.map((m) => ({ ...m, source: m.source })) };
}

function brief(r: LibraryRef): ReferenceBrief {
  const t = traction(forScoring(r));
  const source = r.verification === "NEEDS_SOURCE" ? " (source not yet confirmed)" : "";
  return { ...r, traction: `${t.tier === "unknown" ? "no recorded numbers" : `${t.tier} traction: ${t.explanation}`}${source}` };
}

const asComparable = (x: { title: string; premise: string; keywords: string[] }) => x;
const productOnly = (product: string) => ({ title: product, premise: "", keywords: [] as string[] });

/** What a pitch or story keeps from a scored candidate. */
export function snapshotOf(
  c: Pick<ManufacturingTopicCandidate, "id" | "product" | "episodeConcept" | "strategy" | "evidenceLevel" | "score" | "scoreBreakdown" | "whyViewers" | "featuredStage" | "curiosityAngle" | "visualPayoff">,
  evidence: { reference: LibraryRef; relation: string }[],
  generation: DiscoverySnapshot["generation"],
): DiscoverySnapshot {
  return {
    candidateId: c.id,
    product: c.product,
    concept: c.episodeConcept,
    strategy: c.strategy,
    evidenceLevel: c.evidenceLevel,
    score: c.score,
    breakdown: (c.scoreBreakdown as DiscoverySnapshot["breakdown"] | null) ?? [],
    referenceIds: evidence.map((e) => e.reference.id),
    evidence: evidence.map((e) => ({
      referenceId: e.reference.id,
      title: e.reference.title,
      platform: e.reference.platform,
      creator: e.reference.creator,
      url: e.reference.url,
      relation: e.relation,
      traction: traction(forScoring(e.reference)).explanation,
    })),
    whyViewers: c.whyViewers,
    featuredStage: c.featuredStage,
    curiosityAngle: c.curiosityAngle,
    visualPayoff: c.visualPayoff,
    generation,
  };
}

/** Candidates already saved for this run (a retry resumes instead of paying again). */
async function savedFor(run: { batchId?: string | null; jobId?: string | null }) {
  const where = run.batchId ? { batchId: run.batchId } : run.jobId ? { jobId: run.jobId } : null;
  return where ? db.manufacturingTopicCandidate.findMany({ where, include: { evidence: true } }) : [];
}

/**
 * Proposes and scores products for a channel from the reference library.
 * Returns every saved candidate (duplicates included, with status DUPLICATE).
 */
export async function discoverTopics(input: { channelId: string; guide: ChannelGuide; batchId?: string | null; jobId?: string | null; deps: DiscoveryDeps; onStage?: (label: string, progress: number) => Promise<void> }) {
  const existing = await savedFor(input);
  if (existing.length) return { candidates: existing, resumed: true };

  const { deps } = input;
  const library = await loadLibrary();
  if (!library.length) throw new EmptyLibraryError();
  const byId = new Map(library.map((r) => [r.id, r]));

  const since = (days: number) => new Date(Date.now() - days * 86_400_000);
  const [stories, recent] = await Promise.all([
    db.story.findMany({ where: { channelId: input.channelId }, select: { title: true, premise: true, keywords: true }, orderBy: { createdAt: "desc" }, take: 300 }),
    db.manufacturingTopicCandidate.findMany({ where: { channelId: input.channelId, status: { not: "DUPLICATE" }, createdAt: { gte: since(RECENT_PROPOSALS_DAYS) } }, select: { title: true, product: true, episodeConcept: true, category: true, status: true } }),
  ]);

  await input.onStage?.("Proposing products from the reference library", 0.1);
  await assertWithinBudget(deps.cost, 0.05);
  const { ideas } = await generateStructured({
    client: deps.text,
    pricing: deps.pricing,
    model: deps.writer,
    ...topicIdeasPrompt({
      channel: input.guide,
      references: library.map(brief),
      count: IDEAS_WRITTEN,
      avoid: [...new Set([...stories.map((s) => s.title), ...recent.map((r) => r.product), ...library.map((r) => r.product)])].slice(0, 200),
    }),
    schema: TopicIdeaBatchSchema,
    schemaName: "topic_ideas",
    validate: (v) => [
      ...(v.ideas.length < IDEAS_WRITTEN - 2 ? [`Propose ${IDEAS_WRITTEN} ideas (got ${v.ideas.length}).`] : []),
      ...v.ideas.flatMap((x, i) => {
        const bad = x.referenceIds.filter((id) => !byId.has(id));
        return bad.length ? [`Idea ${i + 1} cites unknown reference ids ${bad.join(", ")}; use only ids from the library.`] : [];
      }),
    ],
    cost: { ctx: deps.cost, operation: "topic-ideas" },
  });

  // Repeats of the channel's stories, topics already approved or used, or a product already in the library are dropped.
  // Other recent proposals are only discouraged (in the prompt), so a product passed over before can come back.
  const comparable = (x: TopicIdea) => ({ ...x, keywords: [x.product, x.category] });
  const taken = recent.filter((r) => r.status === "APPROVED" || r.status === "USED");
  const prior = [...stories.map(asComparable), ...taken.map((r) => ({ title: r.title, premise: r.episodeConcept, keywords: [r.product, r.category] }))];
  const { unique: fresh, duplicates } = dedupeCandidates(ideas.map(comparable), prior);
  const inLibrary = (x: TopicIdea) => library.find((r) => similarity(productOnly(x.product), productOnly(r.product)).score >= 0.6);
  const unique = fresh.filter((x) => !inLibrary(x));
  const dupes = [
    ...duplicates.map((d) => ({ idea: d.candidate, of: d.duplicateOf.title })),
    ...fresh.filter((x) => inLibrary(x)).map((x) => ({ idea: x, of: `${inLibrary(x)!.product} (reference library)` })),
  ];

  // Ratings for a product rated recently are reused, so repeated runs don't pay twice.
  const cached = new Map<string, TopicRatings>();
  for (const x of unique) {
    const prev = await db.manufacturingTopicCandidate.findFirst({
      where: { normalizedProduct: normalizeTitle(x.product), ratings: { not: Prisma.AnyNull }, createdAt: { gte: since(RATING_CACHE_DAYS) } },
      orderBy: { createdAt: "desc" },
    });
    if (prev?.ratings) cached.set(x.product, prev.ratings as TopicRatings);
  }
  const toRate = unique.filter((x) => !cached.has(x.product));
  const ratings = new Map(cached);
  if (toRate.length) {
    await input.onStage?.("Rating the ideas", 0.5);
    await assertWithinBudget(deps.cost, 0.03);
    const { evaluations } = await generateStructured({
      client: deps.text,
      pricing: deps.pricing,
      model: deps.reviewer,
      ...topicEvaluationPrompt({ channel: input.guide, ideas: toRate }),
      schema: TopicEvaluationSchema,
      schemaName: "topic_evaluation",
      validate: (v) => {
        const ids = v.evaluations.map((e) => e.index).sort((a, b) => a - b);
        const issues = ids.join(",") !== toRate.map((_, i) => i).join(",") ? [`Rate every idea exactly once, indexes 0–${toRate.length - 1}.`] : [];
        const outOfRange = v.evaluations.some((e) => RATED_DIMENSIONS.some((d) => e[d].score < 0 || e[d].score > 10));
        return [...issues, ...(outOfRange ? ["Scores must be 0–10."] : [])];
      },
      cost: { ctx: deps.cost, operation: "topic-evaluation" },
    });
    for (const e of evaluations) ratings.set(toRate[e.index].product, Object.fromEntries(RATED_DIMENSIONS.map((d) => [d, e[d]])) as TopicRatings);
  }

  await input.onStage?.("Scoring against the evidence", 0.85);
  const base = (x: TopicIdea) => ({
    channelId: input.channelId,
    batchId: input.batchId ?? null,
    jobId: input.jobId ?? null,
    product: x.product,
    normalizedProduct: normalizeTitle(x.product),
    category: x.category,
    title: x.title,
    episodeConcept: x.concept,
    premise: x.premise,
    arc: x.arc,
    whyViewers: x.whyViewers,
    featuredStage: x.featuredStage,
    curiosityAngle: x.curiosityAngle,
    visualPayoff: x.visualPayoff,
    researchFeasibility: x.researchFeasibility,
    visualFeasibility: x.visualFeasibility,
  });
  const evidenceRows = (x: TopicIdea) => [...new Set(x.referenceIds)].map((referenceId) => ({ referenceId, relation: x.comparableReason || "Related manufacturing operation" }));

  await db.$transaction(async (tx) => {
    for (const x of unique) {
      const refs = [...new Set(x.referenceIds)].map((id) => forScoring(byId.get(id)!));
      const ev = comparableEvidence(x.category, refs);
      const r = ratings.get(x.product)!;
      const { score, breakdown } = scoreTopic(r, ev);
      await tx.manufacturingTopicCandidate.create({
        data: { ...base(x), strategy: honestStrategy(x.strategy, refs.length, ev.level), evidenceLevel: ev.level, ratings: r, score, scoreBreakdown: breakdown, evidence: { create: evidenceRows(x) } },
      });
    }
    for (const d of dupes) {
      await tx.manufacturingTopicCandidate.create({
        data: { ...base(d.idea), strategy: honestStrategy(d.idea.strategy, d.idea.referenceIds.length, "NONE"), evidenceLevel: "NONE", status: "DUPLICATE", duplicateOf: d.of, evidence: { create: evidenceRows(d.idea) } },
      });
    }
  });
  return { candidates: await savedFor(input), resumed: false, rated: toRate.length, reusedRatings: unique.length - toRate.length };
}

export class EmptyLibraryError extends Error {
  constructor() {
    super("The reference library is empty, so there is no evidence to discover from.");
    this.name = "EmptyLibraryError";
  }
}

/**
 * For a producer's own product: library videos about the same or a closely
 * related product, as evidence only. The product itself is never changed.
 */
export function libraryMatches(product: string, library: LibraryRef[]) {
  const target = productOnly(product);
  return library
    .map((r) => ({ reference: r, score: Math.max(similarity(target, productOnly(r.product)).score, similarity(target, productOnly(r.category)).score * 0.8) }))
    .filter((m) => m.score >= 0.35)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((m) => ({ reference: m.reference, relation: m.score >= 0.6 ? "Same product" : "Related product" }));
}

/** Evidence snapshot for a producer's own product (no score: it wasn't proposed by discovery). */
export function matchSnapshot(product: string, matches: ReturnType<typeof libraryMatches>): DiscoverySnapshot | null {
  if (!matches.length) return null;
  const refs = matches.map((m) => forScoring(m.reference));
  const ev = comparableEvidence(matches[0].reference.category, refs);
  return {
    ...snapshotOf(
      { id: "", product, episodeConcept: "", strategy: "EVIDENCE_BACKED", evidenceLevel: ev.level, score: null, scoreBreakdown: [], whyViewers: "", featuredStage: "", curiosityAngle: "", visualPayoff: "" },
      matches,
      "library-match",
    ),
    candidateId: "",
    strategy: ev.level === "NONE" ? "ADJACENT" : "EVIDENCE_BACKED",
  };
}
