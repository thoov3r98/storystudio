import { z } from "zod";

export const CHANNEL_FORMATS = {
  CHARACTER_STORY: { label: "Character story", description: "A recurring character's stories, planned as multi-part series." },
  PROCESS_EXPLAINER: { label: "How it's made", description: "A real process explained step by step, researched on the web first." },
} as const;
export type ChannelFormat = keyof typeof CHANNEL_FORMATS;

/** What a channel is about and how its videos are told. Every pitching, writing and checking prompt reads it. */
export const ChannelProfileSchema = z.object({
  summary: z.string().describe("The channel in one plain sentence."),
  subjects: z.string().describe("What its videos are about, concretely."),
  voice: z.string().describe("How the narration sounds: who narrates, tense, tone, and what it never does."),
  structure: z.string().describe("How each story or series is shaped: how parts open, what each covers, how they end."),
  avoid: z.array(z.string()).describe("Specific things this channel's videos never do."),
  surpriseMe: z.string().describe("How to pick a fresh idea when the producer asks to be surprised."),
  examples: z.array(z.string()).describe("Three to six example video ideas, a few words each."),
});
export type ChannelProfile = z.infer<typeof ChannelProfileSchema>;

/** What the channel designer returns from the producer's prompt. */
export const ChannelDesignSchema = z.object({
  name: z.string().describe("The channel's name: the producer's, if they gave one."),
  format: z.enum(["CHARACTER_STORY", "PROCESS_EXPLAINER"]).describe("CHARACTER_STORY for a recurring character's stories; PROCESS_EXPLAINER for factual step-by-step explainers of how real things are made or work."),
  perspective: z.enum(["FIRST_PERSON", "THIRD_PERSON"]).describe("FIRST_PERSON only if the character narrates their own stories; otherwise THIRD_PERSON (an unseen narrator)."),
  minParts: z.number().int().describe("Fewest videos per story, 1–5."),
  maxParts: z.number().int().describe("Most videos per story, minParts–6."),
  profile: ChannelProfileSchema,
});
export type ChannelDesign = z.infer<typeof ChannelDesignSchema>;

/** The parts of a channel the prompts need. */
export type ChannelGuide = { name: string; format: ChannelFormat; profile: ChannelProfile };

export function parseProfile(value: unknown): ChannelProfile {
  return ChannelProfileSchema.parse(value);
}

export function channelBlock(channel: ChannelGuide): string {
  const p = channel.profile;
  return `CHANNEL: ${channel.name}. ${p.summary}
Subjects: ${p.subjects}
Voice: ${p.voice}
Shape: ${p.structure}
Never: ${p.avoid.join("; ")}.
The channel's rules outrank any general craft note or story-type guide that differs from them.`;
}

/** An editable channel as the edit form sends it. */
export const ChannelEditSchema = z
  .object({
    name: z.string().trim().min(2).max(80),
    characterId: z.string().nullable(),
    perspective: z.enum(["FIRST_PERSON", "THIRD_PERSON"]),
    voiceId: z.string().nullable(),
    styleKey: z.string().min(1),
    targetDurationSec: z.number().int(),
    minParts: z.number().int().min(1).max(6),
    maxParts: z.number().int().min(1).max(6),
    quality: z.enum(["DRAFT", "STANDARD", "PREMIUM"]),
    profile: z.object({
      summary: z.string().trim().min(1).max(500),
      subjects: z.string().trim().min(1).max(2000),
      voice: z.string().trim().min(1).max(2000),
      structure: z.string().trim().min(1).max(2000),
      avoid: z.array(z.string().trim().min(1).max(300)).max(20),
      surpriseMe: z.string().trim().min(1).max(2000),
      examples: z.array(z.string().trim().min(1).max(200)).max(12),
    }),
  })
  .refine((c) => c.minParts <= c.maxParts, { message: "The fewest parts can't be more than the most parts.", path: ["minParts"] });

// ── Pitches ───────────────────────────────────────────────────────────

export const PitchSchema = z.object({
  title: z.string().describe("Plain title naming the situation or product."),
  premise: z.string().describe("One or two plain sentences, the way you'd say it out loud."),
  logline: z.string().describe("The idea in one plain sentence."),
  keywords: z.array(z.string()).describe("4–8 lowercase keywords."),
  openingSituation: z.string().describe("The first moment the series opens on, in one plain sentence."),
  arc: z.string().describe("Three to five short sentences: the arc across the parts (or the real manufacturing stages, in order)."),
});
export type Pitch = z.infer<typeof PitchSchema>;

export const PitchBatchSchema = z.object({ pitches: z.array(PitchSchema) });

export const PitchPickSchema = z.object({
  picks: z.array(z.object({ index: z.number().int(), reason: z.string().describe("One plain sentence.") })),
});
