import { channelBlock, type ChannelGuide } from "@/lib/schemas/channel";

/*
 * Prompts for channels: designing a channel from the producer's prompt, and
 * pitching ideas for it (from the producer's idea, or "Surprise me").
 */

export function channelDesignPrompt(input: { brief: string; existingNames: string[] }) {
  return {
    system: `You set up channels for a studio that makes narrated, stick-figure illustrated short vertical videos (TikTok, YouTube Shorts, Reels), about 60–90 seconds each. Every channel explains, step by step, how real things are made or work, researched on the web before writing. Each subject is told across several videos (parts).

From the producer's description, write the channel's profile. It steers every later step: pitching ideas, writing, and checking scripts. So be concrete and specific, keep everything the producer asked for, and add nothing they would object to.
- voice: who narrates, tense, tone, and what it never does. Clear, calm and factual.
- structure: how each series is shaped across its parts, how parts open and end, and the clarity rules that keep a viewer from getting confused.
- avoid: specific things the videos never do.
- surpriseMe: how to pick a fresh idea that fits the channel when the producer asks to be surprised.
- examples: three to six ideas, a few words each.
- Parts: how many videos one subject should usually span (most channels: 3–5).`,
    user: `Producer's description:
${input.brief}

Existing channels (don't reuse a name): ${input.existingNames.join(", ") || "none"}`,
  };
}

/** What makes a strong idea, distilled from the producer's concept prompt (October 2026). */
const PITCH_RULES = `What makes a strong idea:
- One specific, everyday product a viewer recognises instantly and has never seen made.
- A real factory process with several distinct, visual stages (enough for every part).
- Plain title naming the product, e.g. "How Crayons Are Made".
Never: brand names or named companies, history-only topics, products whose making is a secret or can't be researched, or more than one product per pitch.`;

export function pitchPrompt(input: { channel: ChannelGuide; idea: string | null; count: number; avoidTitles: string[]; parts: [number, number] }) {
  const { channel } = input;
  const idea = input.idea?.trim();
  const brief = idea
    ? `## The producer's idea (keep it exactly)
${idea}
Every pitch is this product (or, if it is a broad kind of product, one specific everyday version of it). Pitches differ only in which version of the product or which factory process they follow.`
    : `## Surprise me
The producer wants fresh ideas for this channel. ${channel.profile.surpriseMe}
Every pitch must be a different product.`;
  return {
    system: `You develop video ideas for one channel of a studio that makes narrated, stick-figure illustrated short vertical videos. Each idea becomes one series told across ${input.parts[0]}–${input.parts[1]} videos of about a minute.

${channelBlock(channel)}

${PITCH_RULES}`,
    user: `Pitch exactly ${input.count} ideas.

${brief}

For each, sketch the arc: the real manufacturing stages in order, from raw material to packed product, in three to five short sentences. A strong idea becomes a complete, clear series, not just a good first line.
Write each premise the way you'd say it out loud, in one or two plain sentences.
Do not repeat any of this channel's existing products:
${input.avoidTitles.length ? input.avoidTitles.map((t) => `- ${t}`).join("\n") : "- (none yet)"}`,
  };
}

export function pitchPickPrompt(input: { channel: ChannelGuide; idea: string | null; pitches: { title: string; premise: string; arc: string }[]; keep: number }) {
  return {
    system: `You are the editor of one channel. Choose the ${input.keep} pitches most likely to make clear, engaging videos that fit the channel, and say in one plain sentence why each one works.

${channelBlock(input.channel)}

Favour: instantly understood, fits the channel exactly, a clear arc with enough real material for every part, easy to illustrate.${
      input.idea ? `\nThe producer asked for: ${input.idea}. A pitch that drifts from it is out.` : ""
    }`,
    user: input.pitches.map((p, i) => `[${i}] ${p.title}\n${p.premise}\nArc: ${p.arc}`).join("\n\n"),
  };
}
