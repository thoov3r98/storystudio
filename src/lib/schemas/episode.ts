import { z } from "zod";
import { MOTION_PRESETS } from "@/lib/constants";
import { StoryBibleUpdateSchema } from "./story-bible";

export const ClaimClassificationSchema = z.enum(["ESTABLISHED_FACT", "PLAUSIBLE_EXAMPLE", "FICTIONAL", "NEEDS_VERIFICATION"]);

export const SceneSpecSchema = z.object({
  sceneNumber: z.number().int(),
  narration: z.string().describe("An exact, contiguous excerpt of storyNarration (usually one or two sentences). All scenes joined in order must reproduce storyNarration word for word."),
  visualDescription: z.string().describe("What the viewer sees, in plain language."),
  imagePrompt: z.string().describe("Subject-only image prompt for ONE clear action: who is doing what, where, with which key objects. At most three figures. Do not describe art style or mention text."),
  composition: z.string().describe("Framing and layout, e.g. 'wide shot, figure small at left, conveyor belt diagonal'."),
  characters: z.array(z.string()).describe("Character names from the story bible appearing in this scene."),
  objects: z.array(z.string()),
  intendedDurationSec: z.number(),
  motionPreset: z.enum(MOTION_PRESETS),
});

export type SceneSpec = z.infer<typeof SceneSpecSchema>;

/** What the writer model returns. Narration, word count and duration are derived by code from the scenes. */
export const EpisodeDraftSchema = z.object({
  title: z.string(),
  // Written first so the story is told as one continuous piece before it is cut into shots.
  storyNarration: z.string().describe("The complete voiceover as one continuous, flowing story, written to be read aloud."),
  selectedHook: z.string().describe("The opening line(s), copied exactly from the start of storyNarration."),
  summary: z.string().describe("3–5 sentence summary of what happens and what is revealed."),
  scenes: z.array(SceneSpecSchema),
  keyReveals: z.array(z.string()),
  establishedFacts: z.array(z.string()),
  unresolvedQuestions: z.array(z.string()),
  continuationOpportunities: z.array(z.string()),
  claims: z.array(
    z.object({
      claim: z.string(),
      sceneNumber: z.number().int(),
      classification: ClaimClassificationSchema,
    }),
  ),
  bibleUpdate: StoryBibleUpdateSchema,
});

export type EpisodeDraft = z.infer<typeof EpisodeDraftSchema>;

export const FactReviewSchema = z.object({
  claims: z.array(
    z.object({
      claim: z.string(),
      sceneNumber: z.number().int(),
      classification: ClaimClassificationSchema,
      assessment: z.enum(["widely-documented", "plausible-unverified", "fictional-framed", "dubious", "presented-as-fact-but-unsupported"]),
      reasoning: z.string(),
      suggestedRevision: z.string().nullable(),
      verificationHints: z
        .array(z.string())
        .describe("Where a human could verify this (e.g. 'FAA Aeronautical Information Manual, lost comms procedures'). Never invent URLs."),
    }),
  ),
  verdict: z.enum(["pass", "needs-review", "needs-revision"]),
  notes: z.string(),
});

export type FactReview = z.infer<typeof FactReviewSchema>;

export const CONTINUITY_ISSUE_TYPES = [
  "character-contradiction",
  "location-contradiction",
  "impossible-timeline",
  "repeated-reveal",
  "broken-causality",
  "unexplained-new-fact",
  "real-world-conflict",
  "other",
] as const;

export const ContinuityReviewSchema = z.object({
  issues: z.array(
    z.object({
      type: z.enum(CONTINUITY_ISSUE_TYPES),
      severity: z.enum(["minor", "material"]),
      description: z.string(),
      sceneNumber: z.number().int().nullable(),
      suggestedFix: z.string(),
    }),
  ),
  verdict: z.enum(["consistent", "minor-issues", "material-conflicts"]),
});

export type ContinuityReview = z.infer<typeof ContinuityReviewSchema>;

export const SceneNarrationRewriteSchema = z.object({
  narration: z.string(),
  imagePrompt: z.string(),
  composition: z.string(),
  rationale: z.string(),
});

/** The full episode specification stored on each EpisodeVersion. */
export const EpisodeSpecRecordSchema = EpisodeDraftSchema.omit({ scenes: true }).extend({
  /** Absent on versions written before story-first drafting. */
  storyNarration: z.string().optional(),
  storyId: z.string(),
  partNumber: z.number().int(),
  alternativeHooks: z.array(z.string()),
  narration: z.string(),
  wordCount: z.number().int(),
  estimatedDurationSec: z.number(),
  factCheckStatus: z.enum(["PENDING", "PASSED", "NEEDS_REVIEW", "MANUALLY_APPROVED"]),
});

export type EpisodeSpecRecord = z.infer<typeof EpisodeSpecRecordSchema>;
