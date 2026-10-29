import { channelBlock, type ChannelGuide } from "@/lib/schemas/channel";

/*
 * Prompts for channels: designing a channel from the producer's prompt, and
 * pitching ideas for it (from the producer's idea, or "Surprise me").
 */

export function channelDesignPrompt(input: { brief: string; existingNames: string[] }) {
  return {
    system: `You set up channels for a studio that makes narrated, stick-figure illustrated short vertical videos (TikTok, YouTube Shorts, Reels), about 60–90 seconds each. Stories are told across several videos (parts).

From the producer's description, write the channel's profile. It steers every later step: pitching ideas, writing, and checking scripts. So be concrete and specific, keep everything the producer asked for, and add nothing they would object to.
- format: CHARACTER_STORY for a recurring character's stories (fiction or everyday life); PROCESS_EXPLAINER for factual, step-by-step explainers of how real things are made or work, which are researched on the web before writing.
- voice: who narrates, tense, tone, and what it never does. Engaging, clear and descriptive; suspense or drama only if the producer asks for it.
- structure: how each story or series is shaped across its parts, how parts open and end, and the clarity rules that keep a viewer from getting confused.
- avoid: specific things the videos never do.
- surpriseMe: how to pick a fresh idea that fits the channel when the producer asks to be surprised.
- examples: three to six ideas, a few words each.
- Parts: how many videos one story should usually span (most channels: 3–5).`,
    user: `Producer's description:
${input.brief}

Existing channels (don't reuse a name): ${input.existingNames.join(", ") || "none"}`,
  };
}

/** The idea rules for each channel format, distilled from the producer's concept prompt (October 2026). */
const PITCH_RULES = {
  CHARACTER_STORY: `What makes a strong idea:
- An ordinary person understands it within two seconds and can picture themselves in it.
- A big, simple premise, the broad classic version of the scenario the way people already say it ("the power grid goes down", "a zombie outbreak starts"), never a niche predicament in one room or building. Where the story opens is decided later.
- Familiar premises are welcome; freshness comes from how it is told.
- A clear, natural progression across the parts with understandable consequences, choices that make sense and an ending earned without luck or conveniences.
- Easy to illustrate with simple stick figures and everyday objects.
Never: elaborate world-building, specialist knowledge, manufactured stakes, forced twists ("the real danger isn't X, it's Y"), logistics (clock times, deadlines, notices, routes), or advertising how surprising it is.`,
  PROCESS_EXPLAINER: `What makes a strong idea:
- One specific, everyday product a viewer recognises instantly and has never seen made.
- A real factory process with several distinct, visual stages (enough for every part).
- Plain title naming the product, e.g. "How Crayons Are Made".
Never: brand names or named companies, history-only topics, products whose making is a secret or can't be researched, or more than one product per pitch.`,
} as const;

export function pitchPrompt(input: { channel: ChannelGuide; idea: string | null; count: number; avoidTitles: string[]; hero: string | null; parts: [number, number] }) {
  const { channel } = input;
  const process = channel.format === "PROCESS_EXPLAINER";
  const idea = input.idea?.trim();
  const brief = idea
    ? `## The producer's idea (keep it exactly)
${idea}
${
  process
    ? "Every pitch is this product (or, if it is a broad kind of product, one specific everyday version of it). Pitches differ only in which version of the product or which factory process they follow."
    : "Keep its central situation exactly as given, even if it is impossible or apocalyptic; never swap it for a smaller, realistic or explained-away version. Every pitch is a different way into THIS premise: a different first moment, angle or path through it."
}`
    : `## Surprise me
The producer wants fresh ideas for this channel. ${channel.profile.surpriseMe}
Every pitch must be a different ${process ? "product" : "scenario"}.`;
  return {
    system: `You develop video ideas for one channel of a studio that makes narrated, stick-figure illustrated short vertical videos. Each idea becomes one series told across ${input.parts[0]}–${input.parts[1]} videos of about a minute.

${channelBlock(channel)}

${PITCH_RULES[channel.format]}`,
    user: `Pitch exactly ${input.count} ideas.

${brief}
${input.hero ? `\nEvery pitch stars ${input.hero}. Write premise, logline and openingSituation about ${input.hero}.\n` : ""}
For each, sketch the arc: ${process ? "the real manufacturing stages in order, from raw material to packed product" : "how it starts, how it develops across the parts, and how it ends"}, in three to five short sentences. A strong idea becomes a complete, clear series, not just a good first line.
Write each premise the way you'd say it out loud, in one or two plain sentences.
Do not repeat any of this channel's existing ${process ? "products" : "stories"}:
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
