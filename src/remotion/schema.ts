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
  scenes: z.array(
    z.object({
      sceneNumber: z.number().int(),
      imageUrl: z.string().url(),
      startFrame: z.number().int().nonnegative(),
      durationInFrames: z.number().int().positive(),
      motionPreset: z.string(),
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
});

export type EpisodeProps = z.infer<typeof EpisodePropsSchema>;
