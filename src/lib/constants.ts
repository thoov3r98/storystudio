import type { JobStatus, Quality, StoryStatus } from "@/generated/prisma/enums";

export const CATEGORIES = [
  { value: "hidden-infrastructure", label: "Hidden infrastructure" },
  { value: "travel-transportation", label: "Travel and transportation" },
  { value: "everyday-mysteries", label: "Everyday mysteries" },
  { value: "hypothetical-disasters", label: "Hypothetical disasters" },
  { value: "unusual-business-models", label: "Unusual business models" },
  { value: "engineering-logistics", label: "Engineering and logistics" },
  { value: "survival-scenarios", label: "Survival scenarios" },
  { value: "mixed", label: "Mixed categories" },
  { value: "custom", label: "Custom" },
] as const;

export type CategoryValue = (typeof CATEGORIES)[number]["value"];

export function categoryLabel(value: string): string {
  return CATEGORIES.find((c) => c.value === value)?.label ?? value;
}

export const TARGET_DURATIONS = [60, 75, 90] as const;
export type TargetDuration = (typeof TARGET_DURATIONS)[number];

/** Approximate spoken words for a duration at a conversational ~2.3 words/second, before voice calibration. */
export function targetWordRange(durationSec: number, wordsPerSecond = 2.3): [number, number] {
  const center = durationSec * wordsPerSecond;
  return [Math.round(center * 0.88), Math.round(center * 1.02)];
}

export const SCENE_COUNT_RANGE: Record<TargetDuration, [number, number]> = {
  60: [8, 12],
  75: [10, 15],
  90: [12, 17],
};

export function sceneCountRange(durationSec: number): [number, number] {
  return SCENE_COUNT_RANGE[durationSec as TargetDuration] ?? [10, 15];
}

/**
 * Global illustration style specifications. Every image prompt is built from
 * one of these, so the look stays consistent across scenes and episodes.
 */
export const ILLUSTRATION_STYLES = {
  "stick-figure": {
    label: "Minimal stick figures",
    description: "Black-and-white stick figures on off-white, flat, diagram-like.",
    spec: [
      "Minimalist black-and-white stick-figure illustration.",
      "Clean off-white (#FAFAF7) background, flat 2D, high contrast.",
      "Consistent medium-weight black ink lines, round heads, simple expressive poses.",
      "Objects drawn as minimal line diagrams.",
      "No gradients, no shading, no photorealism, no 3D, no logos, no text, letters, numbers or captions anywhere in the image.",
    ].join(" "),
  },
  "stick-figure-accent": {
    label: "Stick figures + red accent",
    description: "Same minimal style, with a single red accent for the key object.",
    spec: [
      "Minimalist black-and-white stick-figure illustration with exactly one accent colour: signal red (#E0362C), used only on the single most important object.",
      "Clean off-white (#FAFAF7) background, flat 2D, high contrast.",
      "Consistent medium-weight black ink lines, round heads, simple expressive poses.",
      "No gradients, no shading, no photorealism, no 3D, no logos, no text, letters, numbers or captions anywhere in the image.",
    ].join(" "),
  },
  "blueprint-line": {
    label: "Blueprint line art",
    description: "Thin technical line drawings, cutaways and schematics.",
    spec: [
      "Minimal technical line drawing in the style of a clean engineering cutaway.",
      "Thin uniform black lines on off-white (#FAFAF7), flat 2D, simple stick-figure people for scale.",
      "No gradients, no shading, no photorealism, no 3D, no logos, no text, labels, letters, numbers or captions anywhere in the image.",
    ].join(" "),
  },
} as const;

export type StyleKey = keyof typeof ILLUSTRATION_STYLES;
export const DEFAULT_STYLE: StyleKey = "stick-figure";

export function styleSpec(key: string): string {
  return (ILLUSTRATION_STYLES[key as StyleKey] ?? ILLUSTRATION_STYLES[DEFAULT_STYLE]).spec;
}

/** Composition rule appended to every image prompt: keeps captions and platform UI clear. */
export const SAFE_AREA_RULE =
  "Vertical 2:3 frame. Keep the main subject in the upper two-thirds; leave the bottom quarter mostly empty background for captions. Keep important details away from the right edge.";

export const MOTION_PRESETS = ["slow-zoom-in", "slow-zoom-out", "pan-left", "pan-right", "pan-up", "still"] as const;
export type MotionPreset = (typeof MOTION_PRESETS)[number];

export const QUALITY_PRESETS: Record<
  Quality,
  { label: string; description: string; writerModel: "main" | "fast"; reviewerModel: "main" | "fast"; imageQuality: "low" | "medium" | "high" }
> = {
  DRAFT: { label: "Draft", description: "Fast model, low-quality images. For trying ideas.", writerModel: "fast", reviewerModel: "fast", imageQuality: "low" },
  STANDARD: { label: "Standard", description: "Main model writes, fast model reviews, medium images.", writerModel: "main", reviewerModel: "fast", imageQuality: "medium" },
  PREMIUM: { label: "Premium", description: "Main model everywhere, high-quality images.", writerModel: "main", reviewerModel: "main", imageQuality: "high" },
};

export const STORY_STATUS_LABELS: Record<StoryStatus, string> = {
  CONCEPT: "Concept",
  IN_PRODUCTION: "In production",
  READY: "Ready",
  PUBLISHED: "Published manually",
  CONTINUING: "Continuing",
  ARCHIVED: "Archived",
};

export const JOB_STATUS_LABELS: Record<JobStatus, string> = {
  QUEUED: "Queued",
  GENERATING_IDEAS: "Generating ideas",
  EVALUATING_CONCEPTS: "Evaluating concepts",
  WRITING_STORY: "Writing story",
  GENERATING_SCENES: "Generating scenes",
  GENERATING_ILLUSTRATIONS: "Generating illustrations",
  GENERATING_VOICEOVER: "Generating voiceover",
  SYNCHRONIZING_NARRATION: "Synchronizing narration",
  RENDERING_VIDEO: "Rendering video",
  UPLOADING_MP4: "Uploading MP4",
  COMPLETED: "Completed",
  FAILED: "Failed",
  CANCELED: "Canceled",
};

export const ACTIVE_JOB_STATUSES: JobStatus[] = [
  "QUEUED",
  "GENERATING_IDEAS",
  "EVALUATING_CONCEPTS",
  "WRITING_STORY",
  "GENERATING_SCENES",
  "GENERATING_ILLUSTRATIONS",
  "GENERATING_VOICEOVER",
  "SYNCHRONIZING_NARRATION",
  "RENDERING_VIDEO",
  "UPLOADING_MP4",
];

export const TERMINAL_JOB_STATUSES: JobStatus[] = ["COMPLETED", "FAILED", "CANCELED"];

export const VIDEO = {
  width: 1080,
  height: 1920,
  fps: 30,
  /** Silence kept after the last spoken word before the video ends. */
  tailMs: 900,
  compositionId: "InvisibleWorldEpisode",
} as const;

/** How many candidate concepts to generate per requested episode. */
export const CANDIDATE_MULTIPLIER = 2;
export const MAX_BATCH_SIZE = 50;
