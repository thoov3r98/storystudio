import { db } from "@/lib/db";
import { generateStructured } from "@/lib/ai/structured";
import { channelDesignPrompt, pitchPickPrompt, pitchPrompt } from "@/lib/ai/channel-prompts";
import { type ChannelGuide, ChannelDesignSchema, parseProfile, PitchBatchSchema, PitchPickSchema } from "@/lib/schemas/channel";
import { DEFAULT_STYLE } from "@/lib/constants";
import { normalizeTitle } from "@/lib/text";
import { dedupeCandidates } from "@/lib/similarity";
import { getDefaults, getModels, getPricing, getVoices } from "@/lib/settings";
import { assertWithinBudget, type CostContext } from "@/lib/costs/record";
import { setJobStage, assertNotCanceled } from "@/lib/jobs";
import type { PipelineDeps } from "./deps";
import { discoverTopics, EmptyLibraryError, libraryMatches, loadLibrary, matchSnapshot, snapshotOf } from "@/lib/topics/discover";
import { pickDiverse } from "@/lib/topics/scoring";
import { StructuredOutputError } from "@/lib/ai/structured";
import type { DiscoverySnapshot } from "@/lib/schemas/topics";
import type { Channel, Story } from "@/generated/prisma/client";

/** Pitches shown to the producer per request; more are written so weak ones and repeats can be dropped. */
export const PITCHES_SHOWN = 3;
const PITCHES_WRITTEN = 6;

export function channelGuide(channel: Pick<Channel, "name" | "format" | "profile">): ChannelGuide {
  return { name: channel.name, format: channel.format, profile: parseProfile(channel.profile) };
}

/** Designs a channel from the producer's prompt and saves it, ready to edit. */
export async function createChannelFromBrief(input: { brief: string; deps: PipelineDeps }): Promise<Channel> {
  const [pricing, models, existing, voices] = await Promise.all([getPricing(), getModels(), db.channel.findMany({ select: { name: true } }), getVoices()]);
  const design = await generateStructured({
    client: input.deps.text,
    pricing,
    model: models.main,
    ...channelDesignPrompt({ brief: input.brief, existingNames: existing.map((c) => c.name) }),
    schema: ChannelDesignSchema,
    schemaName: "channel_design",
    validate: (v) => [
      ...(v.minParts < 1 || v.minParts > 5 ? ["minParts must be 1–5."] : []),
      ...(v.maxParts < v.minParts || v.maxParts > 6 ? ["maxParts must be between minParts and 6."] : []),
      ...(v.profile.examples.length < 3 ? ["Give at least three examples."] : []),
    ],
    cost: { ctx: {}, operation: "channel-design" },
  });
  return db.channel.create({
    data: {
      name: design.name.trim(),
      brief: input.brief,
      format: "PROCESS_EXPLAINER",
      profile: design.profile,
      minParts: design.minParts,
      maxParts: design.maxParts,
      voiceId: voices[0]?.id ?? null,
      styleKey: DEFAULT_STYLE,
    },
  });
}

/** Pitches ideas for a channel from the producer's idea (or "Surprise me") and keeps the best few for the producer to choose from. */
export async function runChannelIdeation(input: { batchId: string; jobId: string; deps: PipelineDeps }) {
  const batch = await db.batch.findUniqueOrThrow({ where: { id: input.batchId }, include: { channel: true } });
  const channel = batch.channel;
  if (!channel) throw new Error("This batch was made before channels and can't be run again. Start a new one from Generate.");
  const guide = channelGuide(channel);
  const [pricing, models] = await Promise.all([getPricing(), getModels()]);
  const cost: CostContext = { jobId: input.jobId, batchId: batch.id, budgetUsd: Number(batch.maxBudgetUsd), budgetScope: "batch" };

  // Retry safety: pitches already saved are kept.
  const saved = await db.concept.count({ where: { batchId: batch.id } });
  if (saved > 0) return { pitches: saved, shown: Math.min(saved, PITCHES_SHOWN), resumed: true };

  // Surprise me discovers products from the reference library; without one (or if discovery
  // can't produce valid ideas) it falls back to the plain pitch writer below.
  if (!batch.customDirection) {
    try {
      return await surpriseFromDiscovery({ batchId: batch.id, jobId: input.jobId, channel, guide, cost, deps: input.deps, pricing, models });
    } catch (err) {
      if (!(err instanceof EmptyLibraryError || err instanceof StructuredOutputError)) throw err;
    }
  }

  await setJobStage(input.jobId, "GENERATING_IDEAS", batch.customDirection ? "Pitching takes on your idea" : "Pitching fresh ideas", 0.05);
  const existing = await db.story.findMany({ where: { channelId: channel.id }, select: { title: true, premise: true, keywords: true }, orderBy: { createdAt: "desc" }, take: 300 });
  await assertWithinBudget(cost, 0.05);
  const { pitches } = await generateStructured({
    client: input.deps.text,
    pricing,
    model: models.main,
    ...pitchPrompt({
      channel: guide,
      idea: batch.customDirection,
      count: PITCHES_WRITTEN,
      avoidTitles: existing.slice(0, 150).map((s) => s.title),
      parts: [channel.minParts, channel.maxParts],
    }),
    schema: PitchBatchSchema,
    schemaName: "pitch_batch",
    validate: (v) => (v.pitches.length < PITCHES_WRITTEN - 1 ? [`Return ${PITCHES_WRITTEN} pitches (got ${v.pitches.length}).`] : []),
    cost: { ctx: cost, operation: "pitch" },
  });

  // A producer's own idea is meant to repeat itself across pitches; only Surprise me is checked against the channel's stories.
  const { unique, duplicates } = batch.customDirection ? { unique: pitches, duplicates: [] } : dedupeCandidates(pitches, existing);
  await assertNotCanceled(input.jobId);
  await setJobStage(input.jobId, "EVALUATING_CONCEPTS", "Choosing the strongest pitches", 0.6);
  const keep = Math.min(PITCHES_SHOWN, unique.length);
  const { picks } = await generateStructured({
    client: input.deps.text,
    pricing,
    model: models.reviewer?.trim() || models.main,
    ...pitchPickPrompt({ channel: guide, idea: batch.customDirection, pitches: unique, keep }),
    schema: PitchPickSchema,
    schemaName: "pitch_pick",
    validate: (v) => {
      const ids = v.picks.map((p) => p.index);
      return [
        ...(ids.length !== keep ? [`Choose exactly ${keep}.`] : []),
        ...(ids.some((i) => i < 0 || i >= unique.length) ? [`Indexes must be 0–${unique.length - 1}.`] : []),
        ...(new Set(ids).size !== ids.length ? ["Choose each pitch once."] : []),
      ];
    },
    cost: { ctx: cost, operation: "pitch-pick" },
  });

  const rows = [
    ...picks.map((p, rank) => ({ pitch: unique[p.index], status: "CANDIDATE" as const, rank: rank + 1, reason: p.reason })),
    ...unique.filter((_, i) => !picks.some((p) => p.index === i)).map((pitch) => ({ pitch, status: "REJECTED" as const, rank: null, reason: null })),
  ];
  // A producer's own product keeps its name; library videos about it are attached as evidence only.
  const evidence = batch.customDirection ? matchSnapshot(batch.customDirection, libraryMatches(batch.customDirection, await loadLibrary())) : null;
  await db.concept.createMany({
    data: [
      ...rows.map((r) => ({
        discovery: evidence ?? undefined,
        batchId: batch.id,
        title: r.pitch.title,
        normalizedTitle: normalizeTitle(r.pitch.title),
        premise: r.pitch.premise,
        logline: r.pitch.openingSituation ? `${r.pitch.logline} Opening: ${r.pitch.openingSituation}` : r.pitch.logline,
        keywords: r.pitch.keywords.map((k) => k.toLowerCase()),
        seriesPotential: r.pitch.arc,
        storySeed: { beatSketch: r.pitch.arc },
        scores: r.reason ? { summary: r.reason } : undefined,
        rank: r.rank,
        status: r.status,
      })),
      ...duplicates.map((d) => ({
        batchId: batch.id,
        title: d.candidate.title,
        normalizedTitle: normalizeTitle(d.candidate.title),
        premise: d.candidate.premise,
        logline: d.candidate.logline,
        keywords: d.candidate.keywords,
        seriesPotential: d.candidate.arc,
        status: "DUPLICATE" as const,
        duplicateOfTitle: d.duplicateOf.title,
        similarity: d.score,
      })),
    ],
  });
  return { pitches: pitches.length, shown: keep, duplicates: duplicates.length, resumed: false };
}

/** Turns a chosen pitch into a story of its channel, with Part 1 ready to write. */
export async function storyFromPitch(conceptId: string): Promise<Story & { episodes: { id: string }[] }> {
  const concept = await db.concept.findUniqueOrThrow({ where: { id: conceptId }, include: { batch: { include: { channel: true } }, story: { include: { episodes: true } }, topic: { select: { id: true } } } });
  if (concept.story) return concept.story;
  const channel = concept.batch.channel;
  if (!channel) throw new Error("This pitch was made before channels.");
  const story = await db.story.create({
    data: {
      title: concept.title,
      normalizedTitle: concept.normalizedTitle,
      premise: concept.premise,
      logline: concept.logline,
      storySeed: concept.storySeed ?? undefined,
      keywords: concept.keywords,
      styleKey: channel.styleKey,
      voiceId: channel.voiceId ?? concept.batch.voiceId,
      channelId: channel.id,
      targetDurationSec: channel.targetDurationSec,
      // The planner picks the real count within the channel's range when it writes Part 1.
      plannedParts: channel.maxParts,
      quality: channel.quality,
      conceptId: concept.id,
      // The topic's angle travels with the story so writing can use it; the product is never changed downstream.
      discovery: concept.discovery ?? undefined,
      topicCandidateId: concept.topic?.id ?? null,
      episodes: { create: { partNumber: 1, title: concept.title } },
    },
    include: { episodes: true },
  });
  await db.concept.update({ where: { id: conceptId }, data: { status: "SELECTED" } });
  if (concept.topic) await db.manufacturingTopicCandidate.update({ where: { id: concept.topic.id }, data: { status: "USED" } });
  return story;
}

type DiscoveryRun = { batchId: string; jobId: string; channel: Channel; guide: ChannelGuide; cost: CostContext; deps: PipelineDeps; pricing: Awaited<ReturnType<typeof getPricing>>; models: Awaited<ReturnType<typeof getModels>> };

/** Surprise me from evidence: discovery proposes and scores products; the best few, kept different from each other, become the pitches. */
async function surpriseFromDiscovery(run: DiscoveryRun) {
  const { candidates } = await discoverTopics({
    channelId: run.channel.id,
    guide: run.guide,
    batchId: run.batchId,
    jobId: run.jobId,
    deps: { text: run.deps.text, pricing: run.pricing, writer: run.models.main, reviewer: run.models.reviewer?.trim() || run.models.main, cost: run.cost },
    onStage: (label, progress) => setJobStage(run.jobId, progress < 0.5 ? "GENERATING_IDEAS" : "EVALUATING_CONCEPTS", label, progress),
  });
  const scored = candidates.filter((c) => c.status !== "DUPLICATE" && c.score !== null).map((c) => ({ ...c, score: c.score! }));
  if (!scored.length) throw new EmptyLibraryError();
  const picks = pickDiverse(scored, PITCHES_SHOWN);
  const library = new Map((await loadLibrary()).map((r) => [r.id, r]));
  await assertNotCanceled(run.jobId);
  await db.$transaction(async (tx) => {
    for (const c of candidates) {
      const picked = picks.findIndex((p) => p.id === c.id);
      const evidence = c.evidence.flatMap((e) => (library.has(e.referenceId) ? [{ reference: library.get(e.referenceId)!, relation: e.relation }] : []));
      const snapshot: DiscoverySnapshot = snapshotOf(c, evidence, "discovery");
      const concept = await tx.concept.create({
        data: {
          batchId: run.batchId,
          title: c.title,
          normalizedTitle: normalizeTitle(c.title),
          premise: c.premise,
          logline: c.episodeConcept,
          keywords: [...new Set([c.product, c.category].flatMap((x) => x.toLowerCase().split(/\s+/)))],
          seriesPotential: c.arc,
          storySeed: { beatSketch: c.arc },
          scores: { summary: c.whyViewers },
          discovery: snapshot,
          rank: picked >= 0 ? picked + 1 : null,
          status: c.status === "DUPLICATE" ? "DUPLICATE" : picked >= 0 ? "CANDIDATE" : "REJECTED",
          duplicateOfTitle: c.duplicateOf,
        },
      });
      await tx.manufacturingTopicCandidate.update({ where: { id: c.id }, data: { conceptId: concept.id } });
    }
  });
  return { pitches: candidates.length, shown: picks.length, duplicates: candidates.filter((c) => c.status === "DUPLICATE").length, resumed: false, discovery: true };
}

/** Topic Research: discovery for a channel outside Make Videos. Candidates wait on the Topic Research page for review. */
export async function runTopicDiscovery(input: { channelId: string; jobId: string; deps: PipelineDeps }) {
  const channel = await db.channel.findUniqueOrThrow({ where: { id: input.channelId } });
  const [pricing, models, defaults] = await Promise.all([getPricing(), getModels(), getDefaults()]);
  const cost: CostContext = { jobId: input.jobId, budgetUsd: defaults.maxBatchBudgetUsd, budgetScope: "job" };
  const { candidates, resumed } = await discoverTopics({
    channelId: channel.id,
    guide: channelGuide(channel),
    jobId: input.jobId,
    deps: { text: input.deps.text, pricing, writer: models.main, reviewer: models.reviewer?.trim() || models.main, cost },
    onStage: (label, progress) => setJobStage(input.jobId, progress < 0.5 ? "GENERATING_IDEAS" : "EVALUATING_CONCEPTS", label, progress),
  });
  return { candidates: candidates.length, proposed: candidates.filter((c) => c.status !== "DUPLICATE").length, resumed };
}

/** A topic approved on Topic Research becomes a one-pitch batch for its channel, ready to write. */
export async function conceptFromCandidate(candidateId: string): Promise<string> {
  const c = await db.manufacturingTopicCandidate.findUniqueOrThrow({ where: { id: candidateId }, include: { channel: true, evidence: true, concept: true } });
  if (c.concept) return c.concept.id;
  if (c.status === "DUPLICATE") throw new Error("This topic repeats one already made or proposed.");
  const voiceId = c.channel.voiceId ?? (await getVoices())[0]?.id;
  if (!voiceId) throw new Error("Add a narrator voice in Settings first.");
  const library = new Map((await loadLibrary()).map((r) => [r.id, r]));
  const evidence = c.evidence.flatMap((e) => (library.has(e.referenceId) ? [{ reference: library.get(e.referenceId)!, relation: e.relation }] : []));
  const batch = await db.batch.create({
    data: { customDirection: c.product, requestedCount: 1, targetDurationSec: c.channel.targetDurationSec, styleKey: c.channel.styleKey, voiceId, quality: c.channel.quality, maxBudgetUsd: 0, channelId: c.channelId },
  });
  const concept = await db.concept.create({
    data: {
      batchId: batch.id,
      title: c.title,
      normalizedTitle: normalizeTitle(c.title),
      premise: c.premise,
      logline: c.episodeConcept,
      keywords: [c.product.toLowerCase(), c.category.toLowerCase()],
      seriesPotential: c.arc,
      storySeed: { beatSketch: c.arc },
      scores: { summary: c.whyViewers },
      discovery: snapshotOf(c, evidence, "topic-research"),
      rank: 1,
      status: "CANDIDATE",
    },
  });
  await db.manufacturingTopicCandidate.update({ where: { id: c.id }, data: { conceptId: concept.id, status: "APPROVED" } });
  return concept.id;
}
