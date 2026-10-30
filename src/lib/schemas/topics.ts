import { z } from "zod";

/*
 * Topic discovery: a library of successful manufacturing videos (references),
 * and products proposed from it with an explainable score. See src/lib/topics.
 */

export const PLATFORMS = ["youtube", "tiktok", "instagram", "other"] as const;
export type Platform = (typeof PLATFORMS)[number];

const optionalInt = z.preprocess((v) => (v === "" || v === null || v === undefined ? null : v), z.coerce.number().int().nonnegative().nullable());
const optionalDate = z.preprocess((v) => (v === "" || v === null || v === undefined ? null : v), z.coerce.date().nullable());

/** A reference as the producer enters or edits it. */
export const ReferenceInputSchema = z.object({
  platform: z.enum(PLATFORMS),
  creator: z.string().trim().min(1).max(200),
  url: z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? null : v), z.string().trim().url().max(500).nullable()),
  title: z.string().trim().min(1).max(300),
  product: z.string().trim().min(1).max(120),
  category: z.string().trim().min(1).max(120),
  publishedAt: optionalDate,
  durationSec: optionalInt,
  notableStep: z.string().trim().max(1000).default(""),
  curiosityMechanism: z.string().trim().max(1000).default(""),
  observedHook: z.string().trim().max(1000).default(""),
  transformationType: z.string().trim().max(120).default(""),
  notes: z.string().trim().max(4000).default(""),
  usageRights: z.string().trim().min(1).max(500).default("Reference only; not licensed for reuse"),
});
type Num = string | number | null;
export type ReferenceInput = Omit<z.input<typeof ReferenceInputSchema>, "url" | "publishedAt" | "durationSec"> & { url?: string | null; publishedAt?: string | Date | null; durationSec?: Num };

/** One observation of a reference's numbers. Blank stays null: a missing count is never a zero. */
export const MetricInputSchema = z
  .object({
    views: optionalInt,
    likes: optionalInt,
    comments: optionalInt,
    shares: optionalInt,
    observedAt: z.coerce.date(),
    note: z.string().trim().max(500).default(""),
  })
  .refine((m) => [m.views, m.likes, m.comments, m.shares].some((x) => x !== null), { message: "Enter at least one number." })
  .refine((m) => m.observedAt.getTime() <= Date.now() + 60_000, { message: "The observation date can't be in the future.", path: ["observedAt"] });
export type MetricInput = { views?: Num; likes?: Num; comments?: Num; shares?: Num; observedAt: string | Date; note?: string };

// ── Model output ──────────────────────────────────────────────────────

export const TOPIC_STRATEGIES = ["EVIDENCE_BACKED", "ADJACENT", "EXPLORATORY"] as const;

export const TopicIdeaSchema = z.object({
  product: z.string().describe("One everyday product, plain name, singular or plural as people say it (e.g. 'Rubber flip-flops')."),
  category: z.string().describe("A short product category, e.g. 'footwear', 'frozen desserts', 'kitchen tools'."),
  title: z.string().describe("Plain title, e.g. 'How Flip-Flops Are Made'."),
  concept: z.string().describe("The episode concept in one plain sentence."),
  premise: z.string().describe("One or two plain sentences, the way you'd say it out loud."),
  arc: z.string().describe("Three to five short sentences: the stages as you understand them. A lead for later research, not a fact."),
  strategy: z.enum(TOPIC_STRATEGIES),
  referenceIds: z.array(z.string()).describe("Ids of the library references this idea is comparable to. Empty when none is genuinely comparable."),
  comparableReason: z.string().describe("Why those references are comparable (same operation, material or payoff). Empty when there are none."),
  whyViewers: z.string().describe("Why everyday viewers might stop for it, in one plain sentence. No claims about views."),
  featuredStage: z.string().describe("The most watchable manufacturing step you expect, as you understand it (to be checked by research)."),
  curiosityAngle: z.string().describe("The question a viewer would want answered."),
  visualPayoff: z.string().describe("The moment that rewards watching."),
  researchFeasibility: z.string().describe("Whether reliable public sources on how it is made likely exist, and why."),
  visualFeasibility: z.string().describe("Whether simple illustrations can show the process accurately, and why."),
});
export type TopicIdea = z.infer<typeof TopicIdeaSchema>;

export const TopicIdeaBatchSchema = z.object({ ideas: z.array(TopicIdeaSchema) });

/** The qualitative dimensions a reviewer rates. Comparable evidence is computed from the library, never rated. */
export const RATED_DIMENSIONS = ["visual", "familiarity", "surprise", "researchAvailability", "visualFeasibility"] as const;
export type RatedDimension = (typeof RATED_DIMENSIONS)[number];

const rating = z.object({ score: z.number().int().describe("0–10"), note: z.string().describe("One short plain sentence.") });

export const TopicEvaluationSchema = z.object({
  evaluations: z.array(
    z.object({
      index: z.number().int(),
      visual: rating.describe("How visually compelling the real process is (machines, transformations, motion)."),
      familiarity: rating.describe("How instantly an everyday viewer recognises the finished product."),
      surprise: rating.describe("How surprising or unexpected a detail of its making is likely to be."),
      researchAvailability: rating.describe("How likely credible public sources on its factory process exist."),
      visualFeasibility: rating.describe("How accurately simple stick-figure illustrations can show it."),
    }),
  ),
});
export type TopicEvaluation = z.infer<typeof TopicEvaluationSchema>["evaluations"][number];
export type TopicRatings = Pick<TopicEvaluation, RatedDimension>;

/** What a pitch and story keep from discovery, so writing can use it and the producer can see why it was picked. */
export const DiscoverySnapshotSchema = z.object({
  candidateId: z.string(),
  product: z.string(),
  concept: z.string(),
  strategy: z.enum(TOPIC_STRATEGIES),
  evidenceLevel: z.enum(["VERIFIED", "REPORTED", "NONE"]),
  score: z.number().nullable(),
  breakdown: z.array(z.object({ key: z.string(), label: z.string(), weight: z.number(), value: z.number(), points: z.number(), note: z.string() })),
  referenceIds: z.array(z.string()),
  evidence: z.array(z.object({ referenceId: z.string(), title: z.string(), platform: z.string(), creator: z.string(), url: z.string().nullable(), relation: z.string(), traction: z.string() })),
  whyViewers: z.string(),
  featuredStage: z.string(),
  curiosityAngle: z.string(),
  visualPayoff: z.string(),
  /** "discovery" for Surprise me, "library-match" for a producer's own product. */
  generation: z.enum(["discovery", "library-match", "topic-research"]),
});
export type DiscoverySnapshot = z.infer<typeof DiscoverySnapshotSchema>;
