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
      "Friendly cartoon scenes, with cutaway and x-ray views where something physical is hidden (a body, a wall, the ground); a hidden thing the video follows glows in one bright cyan.",
    spec: [
      "Clean, friendly flat cartoon illustration in the style of a modern explainer channel.",
      "Draw the real people, places and objects of the moment. Only when the action is physically hidden inside something (a body, a wall, the ground) open it up with a neat cross-section edge, so the inside is plainly visible next to the familiar outside; never invent machines, pipes, conveyors or gears to stand for an idea.",
      "When the scene does follow a hidden physical subject (molecules, water, a nerve message), it is drawn as simple bold shapes in one bright accent colour, electric cyan (#16C7E8), with a soft glow, the brightest thing in the image; its path may show as a short glowing dotted trail. Otherwise use the cyan only as a small highlight on the most important thing.",
      "Everything else in a calm, muted palette: soft warm greys, pale blues and gentle skin tones, with thick, consistent dark navy (#1E2A3A) outlines. Anatomy is simplified and friendly, never gory and never medical-textbook realistic.",
      "Everyday people are simple rounded cartoon figures with bean-shaped bodies, dot eyes and expressive poses. A real, named person (a president, governor, senator, public figure) is instead a friendly, recognisable caricature of how they actually look: their real face shape, hair, skin tone, age, build and usual clothes, in the same flat style. At most three figures, one clear action, and the main subject large enough to fill most of the frame.",
      "Light off-white (#F7F6F2) background. Flat colour everywhere except the accent's soft glow; no photorealism, no 3D-render look, no heavy shading, no logos, no text, labels, letters, numbers or captions anywhere in the image.",
    ].join(" "),
  },
  "editorial-stick-figure": {
    label: "What Happens When? editorial",
    description:
      "Modern minimalist 2D editorial illustration: expressive stick figures in clean, recognisable places on warm off-white, with a fixed restrained palette and colour only on what matters.",
    spec: [
      "Modern minimalist 2D editorial illustration, like a frame from a premium, professionally art-directed animated explainer for curious adults; never a children's cartoon.",
      "Clean, confident charcoal (#252525) outlines of one consistent stroke weight; simple geometric shapes and instantly recognisable objects; clear silhouettes and uncluttered scenes; subtle depth from layering and composition, never realistic rendering.",
      "Fixed palette in every image, whatever the mood: warm off-white (#F8F7F4) background, light grey (#D9DDE1) for neutral objects, muted blue (#3B82B6) as the main accent, warm orange (#E8A04B) as the second accent, sage green (#86A78B) as a supporting colour, muted red (#D85C55) only for danger or urgency. Colour is restrained and selective: most of the scene stays line and light grey, and the narrative object of the moment stands out by contrast. Mood comes from composition, expression, small lighting cues and the situation, never from a palette change.",
      "Characters are expressive stick-figure-inspired people: a simple circular head, minimal expressive face, thin but clearly visible charcoal limbs, slightly playful posture and gesture. The default protagonist (\"you\"), unless the episode facts describe someone else, wears a small muted-blue shirt or torso shape and dark pants and looks like a neutral, approachable adult, with the same proportions, face, clothing colours and scale relative to objects in every image. Secondary characters share the visual language with one subtle distinguishing feature each (a hair shape, a coloured top, glasses). A real, named person is a recognisable caricature of how they actually look, in the same style.",
      "Each image shows one clear narrative moment: a character doing something, a visible consequence, a specific place, a discovery, or the object or mechanism that matters, never someone just standing and looking. Frame it the way the moment reads best: a wide shot for places and scale, a medium shot for a person dealing with something, a close-up for an object or a reaction, a neat cross-section cutaway only for something physically hidden inside a real building, machine, vehicle, body or the ground. The main subject is large and readable on a phone, in clear foreground with supporting background detail; whitespace is deliberate but most of the frame is used.",
      "Humour, when the moment allows, is dry and situational (a deadpan expression, a telling gesture, one small detail in the environment), never slapstick or random props; serious events are drawn respectfully.",
      "Flat colour only: no photorealism, no 3D rendering, no anime, no watercolour or paper textures, no gradients, no complex shading, no highly detailed backgrounds, no frames, borders, logos or watermarks.",
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
