import { z } from "zod";
import { MOTION_PRESETS, SOUND_EFFECT_KEYS } from "@/lib/constants";

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
  soundEffect: z.enum(SOUND_EFFECT_KEYS).describe('The sound of what happens in this shot, or "none" for a quiet shot.'),
  stepLabel: z.string().describe("The step or stage this shot belongs to, 2–4 plain words shown on screen (e.g. 'Cooking the syrup', 'Into your stomach'). Consecutive shots of one step use the same words."),
});

/** The physical facts every shot of an episode must respect, so images agree with the story and each other. */
export const VisualStateSchema = z.object({
  setting: z.string().describe("Where the episode happens, concretely (e.g. 'a stopped two-seat chairlift about 20 metres above an empty ski run')."),
  timeAndLight: z.string().describe("Time of day at the start and how the light changes by the end (e.g. 'late afternoon, sun low; after scene 9 the sun is behind the ridge and the slope is in blue shadow')."),
  weather: z.string(),
  heroSituation: z.string().describe("Where the hero physically is and what they can and cannot do, through the episode (e.g. 'seated on the chair the entire episode; never on the ground')."),
  heroLook: z.string().describe("What the hero wears and carries in this episode, and how each real, named person who appears actually looks (age, build, skin tone, hair, face, glasses, usual clothes)."),
  rules: z.array(z.string()).describe("Things that must be true in every shot (e.g. 'Ridge never leaves the chair', 'the base is far below and small')."),
});

export type VisualState = z.infer<typeof VisualStateSchema>;

export type SceneSpec = z.infer<typeof SceneSpecSchema>;

/** One part's script and storyboard. Narration, word count and duration are derived by code from the scenes. */
export const EpisodeDraftSchema = z.object({
  title: z.string(),
  /** This part's pasted narration, word for word. */
  storyNarration: z.string(),
  /** The opening sentence of storyNarration. */
  selectedHook: z.string(),
  summary: z.string().describe("3–5 sentence summary of what happens and what is revealed."),
  /** Shown big on screen over the opening seconds. Missing on scripts written before it existed. */
  onScreenHook: z.string().optional(),
  visualState: VisualStateSchema,
  scenes: z.array(SceneSpecSchema),
});

export type EpisodeDraft = z.infer<typeof EpisodeDraftSchema>;

/** The full episode specification stored on each EpisodeVersion. */
export const EpisodeSpecRecordSchema = EpisodeDraftSchema.omit({ scenes: true }).extend({
  storyId: z.string(),
  partNumber: z.number().int(),
  narration: z.string(),
  wordCount: z.number().int(),
  estimatedDurationSec: z.number(),
});

export type EpisodeSpecRecord = z.infer<typeof EpisodeSpecRecordSchema>;

/** The storyboard pass: shots cut from the producer's narration and the physical facts they respect. */
export const SceneBreakdownSchema = z.object({
  title: z.string().describe("A plain title for this video naming its subject, at most 8 words, e.g. \"How Crayons Are Made\"."),
  summary: z.string().describe("2–3 plain sentences: what this video shows, for the illustrator's context."),
  onScreenHook: z.string().describe("3–6 words shown big on screen over the first seconds, for viewers watching with the sound off."),
  visualState: VisualStateSchema,
  scenes: z.array(SceneSpecSchema),
});

/** What the producer pastes when posting a video. Written after it renders; facts only from the narration. */
export const PostCopySchema = z.object({
  caption: z.string().describe("The post caption: one or two short, plain sentences, at most 150 characters."),
  hashtags: z.array(z.string()).describe("3–5 hashtags, lowercase, each starting with #."),
  coverSceneNumber: z.number().int().describe("The shot whose picture makes the best cover: the product or material instantly recognisable."),
  coverText: z.string().describe("2–5 words to put on the cover, for the profile grid."),
  pinnedComment: z.string().describe("A comment to pin that gets people replying: a short question about what the video shows, in one or two plain sentences, with no new facts."),
});
export type PostCopy = z.infer<typeof PostCopySchema>;
