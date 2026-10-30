import { z } from "zod";

/** Input props for the episode composition. Built by src/lib/pipeline/render.ts. */
export const EpisodePropsSchema = z.object({
  fps: z.number().int(),
  width: z.number().int(),
  height: z.number().int(),
  durationInFrames: z.number().int().positive(),
  voiceoverUrl: z.string().url(),
  voiceVolume: z.number().min(0).max(2),
  voicePlaybackRate: z.number().min(1).max(1.5).default(1),
  music: z.object({ url: z.string().url(), volume: z.number().min(0).max(1) }).nullable(),
  sfxVolume: z.number().min(0).max(1).default(0),
  /** Shown in place of the series title over the first `hookFrames`. Empty: the title shows from the start. */
  hookText: z.string().default(""),
  hookFrames: z.number().int().nonnegative().default(78),
  scenes: z.array(
    z.object({
      sceneNumber: z.number().int(),
      imageUrl: z.string().url(),
      startFrame: z.number().int().nonnegative(),
      durationInFrames: z.number().int().positive(),
      motionPreset: z.string(),
      /** The shot's factory sound: looped under the shot, or played once as it starts. */
      sound: z.object({ url: z.string().url(), loop: z.boolean() }).nullable().default(null),
    }),
  ),
  captions: z.array(
    z.object({
      text: z.string(),
      startMs: z.number(),
      endMs: z.number(),
      words: z.array(z.object({ text: z.string(), startMs: z.number(), endMs: z.number() })),
    }),
  ),
  showCaptions: z.boolean(),
  /** "bands": landscape art between coloured title and caption bands. "full": legacy full-frame portrait art. */
  layout: z.enum(["bands", "full"]).default("full"),
  seriesTitle: z.string().default(""),
  partLabel: z.string().default(""),
  accentColor: z.string().default("#4A5D6B"),
});

export type EpisodeProps = z.infer<typeof EpisodePropsSchema>;
