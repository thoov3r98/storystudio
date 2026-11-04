import type { JobStatus, Quality, StoryStatus } from "@/generated/prisma/enums";

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
  "object-focus": {
    label: "Machines and materials up close",
    description: "Flat, coloured close-ups where the machine and the material fill the frame; people only as hands or small figures for scale.",
    spec: [
      "Clean flat cartoon illustration where the machine, the material and the product are the subject and fill most of the frame.",
      "Thick, consistent black ink outlines; bold flat colours on the material and the product, softer muted colours on machines and background.",
      "People appear only as simple gloved hands or one small stick figure for scale, never as the focus.",
      "Close, readable compositions: one clear action per image, the material's texture and state easy to see.",
      "No gradients, no shading, no photorealism, no 3D, no logos, no text, letters, numbers or captions anywhere in the image.",
    ].join(" "),
  },
  "invisible-cutaway": {
    label: "Cutaway: the invisible made visible",
    description:
      "Friendly cartoon cutaways and x-ray views that open up bodies, pipes, walls and machines; the hidden thing the video follows glows in one bright cyan.",
    spec: [
      "Clean, friendly flat cartoon illustration in the style of a modern science-explainer channel, made to show what normally can't be seen.",
      "Cutaway and x-ray views: open up whatever hides the action (a body, a wall, a pipe, the ground, a machine, a card reader) with a neat cross-section edge, so the inside is plainly visible right next to the familiar outside.",
      "The hidden subject the episode follows (molecules, a signal, water, a bag on a belt, a nerve message, data) is drawn as simple bold shapes in one bright accent colour, electric cyan (#16C7E8), with a soft glow. It is the brightest thing in every image and the eye goes to it first; its path may show as a short glowing dotted trail.",
      "Everything else in a calm, muted palette: soft warm greys, pale blues and gentle skin and organ tones, with thick, consistent dark navy (#1E2A3A) outlines. Anatomy and machinery are simplified and friendly, never gory and never medical-textbook realistic.",
      "People are simple rounded cartoon figures with bean-shaped bodies, dot eyes and expressive poses; at most three figures, one clear action, and the main subject large enough to fill most of the frame.",
      "Light off-white (#F7F6F2) background. Flat colour everywhere except the accent's soft glow; no photorealism, no 3D-render look, no heavy shading, no logos, no text, labels, letters, numbers or captions anywhere in the image.",
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

/**
 * Illustration shapes. Square art (from November 2026) fills more of the vertical frame; landscape art
 * belongs to versions written before it and keeps the bands layout. Each shot shows its picture whole,
 * with one slow camera move toward the action (see imageFocus in render-props).
 */
export const IMAGE_SHAPES = {
  square: {
    size: "1024x1024",
    safeArea: "One square picture filling the whole frame. Use the whole square: the main subject and action large and clear, placed wherever the composition reads best; no empty space reserved for captions.",
  },
  landscape: {
    size: "1536x1024",
    safeArea: "Landscape 3:2 frame, shown in full. Keep the main subject and action near the centre with breathing room on every side; no empty space reserved for captions.",
  },
} as const;
export type ImageShape = keyof typeof IMAGE_SHAPES;

export function imageShape(value: string | null | undefined): ImageShape {
  return value === "landscape" ? "landscape" : "square";
}

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

/** "dive-in" is a fast, accelerating push for an opening shot that goes inside (a head, a pipe); styles say when to use it. */
export const MOTION_PRESETS = ["slow-zoom-in", "slow-zoom-out", "pan-left", "pan-right", "pan-up", "still", "dive-in"] as const;
export type MotionPreset = (typeof MOTION_PRESETS)[number];

/**
 * Sounds a shot can carry; each writing style offers its own subset (src/lib/ai/writing-styles.ts). Each is generated once (ElevenLabs sound
 * effects) and kept in the audio library under "sfx:<key>". Loops run under
 * the whole shot; the others play once as the shot starts.
 */
export const SOUND_EFFECTS = {
  conveyor: { label: "Conveyor belt", prompt: "Steady low rumble and soft rattle of a factory conveyor belt running", loop: true },
  machine: { label: "Machine hum", prompt: "Industrial machine motor humming and whirring steadily on a factory floor", loop: true },
  mixer: { label: "Mixer", prompt: "Large industrial mixer churning a thick mixture in a steel tank", loop: true },
  bubbling: { label: "Bubbling", prompt: "Thick hot liquid bubbling and simmering in a large steel vat", loop: true },
  furnace: { label: "Furnace", prompt: "Deep steady roar of an industrial furnace", loop: true },
  pour: { label: "Pouring", prompt: "Thick liquid pouring from a nozzle into moulds", loop: false },
  press: { label: "Press", prompt: "Heavy hydraulic press stamping down once with a deep metallic thump and a short hiss", loop: false },
  hiss: { label: "Steam hiss", prompt: "Short burst of hissing steam or compressed air", loop: false },
  cut: { label: "Cutting", prompt: "Rapid mechanical blades cutting through material several times", loop: false },
  clatter: { label: "Clatter", prompt: "Many small hard objects clattering onto a metal tray", loop: false },
  clunk: { label: "Clunk", prompt: "Single heavy metallic clunk of a machine part locking into place", loop: false },
  spray: { label: "Spray", prompt: "Spray nozzles misting liquid in short bursts", loop: false },
  wrap: { label: "Wrapping", prompt: "Plastic film rustling and crinkling as products are wrapped by a machine", loop: false },
  packing: { label: "Packing", prompt: "Cardboard boxes being folded, filled and taped shut on a packing line", loop: false },
  gulp: { label: "Gulp", prompt: "A single close, soft gulp of someone swallowing a drink", loop: false },
  heartbeat: { label: "Heartbeat", prompt: "Steady, soft, muffled human heartbeat heard from inside the body", loop: true },
  flow: { label: "Flowing liquid", prompt: "Liquid rushing steadily through a pipe or tube, muffled and continuous", loop: true },
  drip: { label: "Drip", prompt: "A few clear water drops falling into a pool, with a soft echo", loop: false },
  flush: { label: "Flush", prompt: "A toilet flushing, close up, water swirling and draining away", loop: false },
  whoosh: { label: "Whoosh", prompt: "Quick soft whoosh of something moving fast past the listener", loop: false },
  beep: { label: "Beep", prompt: "Short friendly electronic confirmation beep of a card reader", loop: false },
  electric: { label: "Electric hum", prompt: "Soft electronic hum with faint digital chirps, like data moving through circuits", loop: true },
  crowd: { label: "Crowd", prompt: "Muffled murmur of a busy indoor hall with people talking and footsteps, no clear words", loop: true },
} as const;
export type SoundEffectKey = keyof typeof SOUND_EFFECTS;
export const SOUND_EFFECT_KEYS = [...(Object.keys(SOUND_EFFECTS) as SoundEffectKey[]), "none"] as const;

/** Length of the instrumental bed generated once per writing style when no music track is chosen (see each style's `music`). */
export const MUSIC_BED_MS = 90_000;

export const QUALITY_PRESETS: Record<
  Quality,
  { label: string; description: string; writerModel: "main" | "fast"; imageQuality: "low" | "medium" | "high" }
> = {
  DRAFT: { label: "Draft", description: "Fast model storyboards, low-quality images. For trying things out.", writerModel: "fast", imageQuality: "low" },
  STANDARD: { label: "Standard", description: "Main model storyboards, medium images.", writerModel: "main", imageQuality: "medium" },
  PREMIUM: { label: "Premium", description: "Main model storyboards, high-quality images.", writerModel: "main", imageQuality: "high" },
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
  STORYBOARDING: "Storyboarding",
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
  "STORYBOARDING",
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
  /**
   * The on-screen hook holds the title band while its spoken line plays, within these bounds;
   * the fallback applies when the spoken line can't be located in the timing.
   */
  hookTextMs: { min: 2200, max: 4500, fallback: 2600 },
  compositionId: "InvisibleWorldEpisode",
} as const;
