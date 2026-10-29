import type { JobStatus, Quality, StoryStatus } from "@/generated/prisma/enums";

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
  "stick-figure-color": {
    label: "Stick figures + colour highlights",
    description: "Bold stick figures with flat colour on the hero and the key objects.",
    spec: [
      "Bold, clean stick-figure cartoon illustration in the style of animated story channels.",
      "Thick, consistent black ink outlines, round heads, simple expressive poses and clear facial expressions.",
      "Flat colour highlights only on what matters: the scene's key objects (the material, the product, the machine part doing the work); everything else stays black line on an off-white (#FAFAF7) background.",
      "Simple readable settings with a few key props; at most three figures; one clear action.",
      "No gradients, no shading, no photorealism, no 3D, no logos, no text, letters, numbers or captions anywhere in the image.",
    ].join(" "),
  },
  "stick-figure-full-color": {
    label: "Coloured-in stick figures",
    description: "Simple stick figures with everything coloured in: flat, soft colours on people, objects and backgrounds.",
    spec: [
      "Simple stick-figure cartoon illustration, fully coloured in like a neat colouring-book page.",
      "Thick, consistent black ink outlines, round heads, simple expressive poses and clear facial expressions.",
      "Every area is filled with flat colour: clothing, objects, buildings, ground and sky or walls. Use a soft, friendly palette of a few muted colours per scene.",
      "Simple readable settings with a few key props; at most three figures; one clear action.",
      "No gradients, no shading, no textures, no photorealism, no 3D, no logos, no text, letters, numbers or captions anywhere in the image.",
    ].join(" "),
  },
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
export const DEFAULT_STYLE: StyleKey = "stick-figure-color";

export function styleSpec(key: string): string {
  return (ILLUSTRATION_STYLES[key as StyleKey] ?? ILLUSTRATION_STYLES[DEFAULT_STYLE]).spec;
}

/** Every illustration is a 3:2 landscape image shown in full between the title band and the caption band. */
export const IMAGE_SIZE = "1536x1024";
export const SAFE_AREA =
  "Landscape 3:2 frame, shown in full. Keep the main subject and action near the centre with breathing room on every side; no empty space reserved for captions.";

/**
 * Band colours, picked stably from the story id.
 * The bands fill two-thirds of the frame, so they are muted and dark enough for white text.
 */
export const BAND_PALETTE = ["#4A5D6B", "#3F5E5A", "#5B5E3C", "#5A4660", "#7A4E3E", "#3E4F6E", "#6B5A45"] as const;

export function bandColorFor(storyId: string): string {
  let h = 0;
  for (const ch of storyId) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return BAND_PALETTE[h % BAND_PALETTE.length];
}

export const MOTION_PRESETS = ["slow-zoom-in", "slow-zoom-out", "pan-left", "pan-right", "pan-up", "still"] as const;
export type MotionPreset = (typeof MOTION_PRESETS)[number];

export const QUALITY_PRESETS: Record<
  Quality,
  { label: string; description: string; writerModel: "main" | "fast"; reviewerModel: "main" | "fast"; imageQuality: "low" | "medium" | "high" }
> = {
  DRAFT: { label: "Draft", description: "Fast model, low-quality images. For trying ideas.", writerModel: "fast", reviewerModel: "fast", imageQuality: "low" },
  STANDARD: { label: "Standard", description: "Main model writes and checks, medium images.", writerModel: "main", reviewerModel: "main", imageQuality: "medium" },
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
