import { z } from "zod";

export const CHANNEL_FORMATS = {
  PROCESS_EXPLAINER: { label: "How it's made", description: "A real factory process shown step by step: machines, materials and the product at each stage." },
  INVISIBLE_EXPLAINER: {
    label: "What happens when…",
    description: "What really happens behind an everyday moment people never see (inside your body, under the street, inside machines), with cutaway pictures.",
  },
} as const;
export type ChannelFormat = keyof typeof CHANNEL_FORMATS;

/** The channel's own storyboard rules. Profiles saved before November 2026 also hold writing rules, which are ignored. */
export const ChannelProfileSchema = z.object({
  visuals: z.string().default("").describe("How the storyboard shows this channel's videos: what the shots are of, what is always on screen, what is never drawn."),
});
export type ChannelProfile = z.infer<typeof ChannelProfileSchema>;

/** The parts of a channel the prompts need. */
export type ChannelGuide = { name: string; format: ChannelFormat; profile: ChannelProfile };

export function parseProfile(value: unknown): ChannelProfile {
  return ChannelProfileSchema.parse(value ?? {});
}

export function channelGuide(channel: { name: string; format: ChannelFormat; profile: unknown }): ChannelGuide {
  return { name: channel.name, format: channel.format, profile: parseProfile(channel.profile) };
}

/** The channel's own storyboard rules, for the storyboard prompt. Empty when the channel has none. */
export function channelVisualsBlock(channel: ChannelGuide): string {
  const v = channel.profile.visuals?.trim();
  return v ? `THIS CHANNEL'S STORYBOARD RULES (they outrank the general shot rules below where they differ)\n${v}` : "";
}

/** A channel as the create and edit forms send it. */
export const ChannelEditSchema = z.object({
  name: z.string().trim().min(2).max(80),
  voiceId: z.string().nullable(),
  styleKey: z.string().min(1),
  quality: z.enum(["DRAFT", "STANDARD", "PREMIUM"]),
  profile: ChannelProfileSchema.extend({ visuals: z.string().trim().max(2000).default("") }),
});
export type ChannelEdit = z.infer<typeof ChannelEditSchema>;

export const ChannelCreateSchema = ChannelEditSchema.extend({
  format: z.enum(Object.keys(CHANNEL_FORMATS) as [ChannelFormat, ...ChannelFormat[]], { message: "Choose what kind of channel this is." }),
});
