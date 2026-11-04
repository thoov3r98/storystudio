import { z } from "zod";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { DEFAULT_PRICING, type Pricing, PricingSchema } from "@/lib/costs/pricing";
import { QUALITY_PRESETS } from "@/lib/constants";
import { trimmedDurationMs } from "@/lib/timing";
import { DEFAULT_WORDS_PER_SECOND } from "@/lib/text";
import type { Quality } from "@/generated/prisma/enums";

export const VoiceSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().default(""),
});
export type Voice = z.infer<typeof VoiceSchema>;

export const VoiceSettingsSchema = z.object({
  stability: z.number().min(0).max(1).default(0.5),
  similarityBoost: z.number().min(0).max(1).default(0.75),
  style: z.number().min(0).max(1).default(0.15),
  speed: z.number().min(0.7).max(1.2).default(1),
  useSpeakerBoost: z.boolean().default(true),
});
export type VoiceSettings = z.infer<typeof VoiceSettingsSchema>;

export const AudioMixSchema = z.object({
  voiceVolume: z.number().min(0).max(2).default(1),
  musicVolume: z.number().min(0).max(1).default(0.12),
  sfxVolume: z.number().min(0).max(1).default(0.3),
  /** Background music under every video. With no track chosen, a default bed is generated once. */
  musicEnabled: z.boolean().default(true),
  musicAssetId: z.string().nullable().default(null),
  /** Render-time narration speed-up on top of ElevenLabs' own speed (which caps at 1.2×). Pitch is preserved. */
  narrationSpeed: z.number().min(1).max(1.5).default(1),
  /** Longest pause kept between words in the video (ms); the voice's longer pauses are cut down to it at render. */
  maxPauseMs: z.number().min(100).max(1500).default(250),
});
export type AudioMix = z.infer<typeof AudioMixSchema>;

export const DefaultsSchema = z.object({
  /** Check each illustration against its line and redraw it once if it is wrong. */
  imageCheck: z.boolean().default(true),
  useStyleReferences: z.boolean().default(true),
});
export type Defaults = z.infer<typeof DefaultsSchema>;

async function readSetting<T>(key: string, schema: z.ZodType<T>, fallback: T): Promise<T> {
  const row = await db.setting.findUnique({ where: { key } });
  if (!row) return fallback;
  const parsed = schema.safeParse(row.value);
  return parsed.success ? parsed.data : fallback;
}

export async function writeSetting(key: string, value: unknown) {
  await db.setting.upsert({ where: { key }, create: { key, value: value as object }, update: { value: value as object } });
}

export async function getPricing(): Promise<Pricing> {
  return readSetting("pricing", PricingSchema, DEFAULT_PRICING);
}

export async function getVoices(): Promise<Voice[]> {
  const voices = await readSetting("voices", z.array(VoiceSchema), []);
  const fallback = env().ELEVENLABS_DEFAULT_VOICE_ID;
  if (voices.length === 0 && fallback) return [{ id: fallback, name: "Default narrator", description: "From ELEVENLABS_DEFAULT_VOICE_ID" }];
  return voices;
}

export async function getVoiceSettings(): Promise<VoiceSettings> {
  return readSetting("voiceSettings", VoiceSettingsSchema, VoiceSettingsSchema.parse({}));
}

export async function getAudioMix(): Promise<AudioMix> {
  return readSetting("audioMix", AudioMixSchema, AudioMixSchema.parse({}));
}

export async function getDefaults(): Promise<Defaults> {
  return readSetting("defaults", DefaultsSchema, DefaultsSchema.parse({}));
}

export const ModelsSchema = z.object({
  /** Splits and storyboards pasted scripts. */
  main: z.string().trim().min(1),
  /** Checks images and writes post text; Draft quality storyboards with it too. */
  fast: z.string().trim().min(1),
  image: z.string().trim().min(1),
  speech: z.string().trim().min(1),
});
export type Models = z.infer<typeof ModelsSchema>;

/** Models chosen on the Settings page; the environment variables are the defaults. Applies to new jobs. */
export async function getModels(): Promise<Models> {
  const e = env();
  return readSetting("models", ModelsSchema, { main: e.OPENAI_TEXT_MODEL, fast: e.OPENAI_TEXT_MODEL_FAST, image: e.OPENAI_IMAGE_MODEL, speech: e.ELEVENLABS_MODEL_ID });
}

/** Measured narration rate for a voice, from previously generated voiceovers. */
/** The voice's pace as it plays in the video: measured from recent voiceovers, with pauses trimmed to `maxPauseMs` as the render does. */
export async function voiceWordsPerSecond(voiceId: string, maxPauseMs?: number | null): Promise<number | null> {
  const recent = await db.voiceover.findMany({
    where: { voiceId, status: "SUCCEEDED", durationMs: { not: null } },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: { text: true, durationMs: true, words: true },
  });
  const rates = recent
    .map((v) => {
      const words = v.text.trim().split(/\s+/).length;
      const timed = Array.isArray(v.words) ? (v.words as { startMs: number; endMs: number }[]) : [];
      const ms = maxPauseMs && timed.length && v.durationMs ? trimmedDurationMs(timed, v.durationMs, maxPauseMs) : v.durationMs;
      return ms ? words / (ms / 1000) : 0;
    })
    .filter((r) => r > 1 && r < 5);
  if (rates.length === 0) return null;
  return rates.reduce((a, b) => a + b, 0) / rates.length;
}

/** The model that splits and storyboards pasted scripts: the main model except at Draft quality. */
export function storyboardModel(quality: Quality, models: Models): string {
  return QUALITY_PRESETS[quality].writerModel === "main" ? models.main : models.fast;
}

/** Words per second as the video plays: the voice's measured pace (pauses trimmed as the render does), sped up by the render's narration speed. */
export async function playbackWordsPerSecond(voiceId: string | null | undefined): Promise<number> {
  const mix = await getAudioMix();
  const measured = voiceId ? await voiceWordsPerSecond(voiceId, mix.maxPauseMs) : null;
  return (measured ?? DEFAULT_WORDS_PER_SECOND) * mix.narrationSpeed;
}
