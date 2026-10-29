import { z } from "zod";
import { MOTION_PRESETS } from "@/lib/constants";
import { StoryBibleUpdateSchema } from "./story-bible";
import { LegacyStoryOutlineSchema, LegacyStoryReviewSchema, PlotSchema, QualityRecordSchema } from "./story-plan";

export const SceneSpecSchema = z.object({
  sceneNumber: z.number().int(),
  narration: z.string().describe("An exact, contiguous excerpt of storyNarration (usually one or two sentences). All scenes joined in order must reproduce storyNarration word for word."),
  imagePrompt: z
    .string()
    .describe(
      "One or two specific sentences for the illustrator: who is doing what, exactly where they are (consistent with visualState), their expression, the key object, and the light. Subject only: no art style, no text.",
    ),
  composition: z.string().describe("Shot type and layout, e.g. 'close-up on his gloved hands and the phone screen' or 'wide, chair tiny against the dark slope'."),
  continuity: z
    .string()
    .describe("What must be true in this shot: where the hero physically is, time of day and light, weather, and anything that changed since the previous shot."),
  characters: z.array(z.string()).describe("Names of the characters VISIBLE in this shot only. Leave someone out when the shot is about someone or something else."),
  objects: z.array(z.string()),
  motionPreset: z.enum(MOTION_PRESETS),
});

/** The physical facts every shot of an episode must respect, so images agree with the story and each other. */
export const VisualStateSchema = z.object({
  setting: z.string().describe("Where the episode happens, concretely (e.g. 'a stopped two-seat chairlift about 20 metres above an empty ski run')."),
  timeAndLight: z.string().describe("Time of day at the start and how the light changes by the end (e.g. 'late afternoon, sun low; after scene 9 the sun is behind the ridge and the slope is in blue shadow')."),
  weather: z.string(),
  heroSituation: z.string().describe("Where the hero physically is and what they can and cannot do, through the episode (e.g. 'seated on the chair the entire episode; never on the ground')."),
  heroLook: z.string().describe("What the hero wears and carries in this episode."),
  rules: z.array(z.string()).describe("Things that must be true in every shot (e.g. 'Ridge never leaves the chair', 'the base is far below and small')."),
});

export type VisualState = z.infer<typeof VisualStateSchema>;

export type SceneSpec = z.infer<typeof SceneSpecSchema>;

/** What the writer model returns. Narration, word count and duration are derived by code from the scenes. */
export const EpisodeDraftSchema = z.object({
  title: z.string(),
  // Written first so the story is told as one continuous piece before it is cut into shots.
  storyNarration: z.string().describe("The complete voiceover as one continuous, flowing story, written to be read aloud."),
  selectedHook: z.string().describe("The opening line(s), copied exactly from the start of storyNarration."),
  summary: z.string().describe("3–5 sentence summary of what happens and what is revealed."),
  visualState: VisualStateSchema,
  scenes: z.array(SceneSpecSchema),
  keyReveals: z.array(z.string()),
  unresolvedQuestions: z.array(z.string()),
  bibleUpdate: StoryBibleUpdateSchema,
});

export type EpisodeDraft = z.infer<typeof EpisodeDraftSchema>;

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
  visualState: VisualStateSchema.optional(),
  /** The causal plot the script was told from, and the record of every check and revision. */
  plot: PlotSchema.optional(),
  quality: QualityRecordSchema.optional(),
  /** Versions written before the quality pipeline: beat outline and editor scores. */
  outline: LegacyStoryOutlineSchema.optional(),
  storyReview: LegacyStoryReviewSchema.optional(),
  storyId: z.string(),
  partNumber: z.number().int(),
  narration: z.string(),
  wordCount: z.number().int(),
  estimatedDurationSec: z.number(),
  factCheckStatus: z.enum(["PENDING", "PASSED", "NEEDS_REVIEW", "MANUALLY_APPROVED"]),
});

export type EpisodeSpecRecord = z.infer<typeof EpisodeSpecRecordSchema>;

/** The storyboard pass: shots cut from the final narration, the physical facts they respect, and the bible update. */
export const SceneBreakdownSchema = z.object({
  visualState: VisualStateSchema,
  scenes: z.array(SceneSpecSchema),
  bibleUpdate: StoryBibleUpdateSchema,
});
