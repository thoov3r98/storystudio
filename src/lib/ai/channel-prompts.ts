import { channelBlock, type ChannelFormat, type ChannelGuide } from "@/lib/schemas/channel";
import { writingStyle } from "./writing-styles";

/*
 * Prompts for channels: designing a channel from the producer's prompt, and
 * pitching ideas for it (from the producer's idea, or "Surprise me").
 */

export function channelDesignPrompt(input: { format: ChannelFormat; brief: string; existingNames: string[] }) {
  const w = writingStyle(input.format);
  return {
    system: `You set up channels for a studio that makes narrated, illustrated short vertical videos (TikTok, YouTube Shorts, Reels). This channel is a ${w.kind}. ${w.channelDesign}

From the producer's description, write the channel's profile. It steers every later step: pitching ideas, writing, and checking scripts. So be concrete and specific, keep everything the producer asked for, and add nothing they would object to.
- voice: who narrates, tense, tone, and what it never does. It must agree with this kind of channel: ${w.designVoice}
- structure: how each story is shaped${w.defaults.maxParts > 1 ? " across its parts, how parts open and end" : ", how it opens and ends"}, and the clarity rules that keep a viewer from getting confused.
- avoid: specific things the videos never do.
- surpriseMe: how to pick a fresh idea that fits the channel when the producer asks to be surprised.
- examples: three to six ideas, a few words each.
- visuals: how the storyboard shows this channel's videos: what the shots are of, what is always on screen, what is never drawn. Two to four plain sentences. Pictures never contain text, labels or numbers.
- Parts: how many videos one subject should usually span (usually ${w.defaults.minParts === w.defaults.maxParts ? w.defaults.minParts : `${w.defaults.minParts}–${w.defaults.maxParts}`}).`,
    user: `Producer's description:
${input.brief}

Existing channels (don't reuse a name): ${input.existingNames.join(", ") || "none"}`,
  };
}


export function pitchPrompt(input: { channel: ChannelGuide; idea: string | null; count: number; avoidTitles: string[]; parts: [number, number] }) {
  const { channel } = input;
  const w = writingStyle(channel.format);
  const idea = input.idea?.trim();
  const brief = idea
    ? `## The producer's idea (keep it exactly)
${idea}
${w.pitchIdea}`
    : `## Surprise me
The producer wants fresh ideas for this channel. ${channel.profile.surpriseMe}
Every pitch must be a different ${w.subject}.`;
  const videos = input.parts[1] > 1 ? `one series told across ${input.parts[0]}–${input.parts[1]} videos` : "one standalone short video";
  return {
    system: `You develop video ideas for one channel of a studio that makes narrated, illustrated short vertical videos. Each idea becomes ${videos}.

${channelBlock(channel)}

${w.pitchRules}`,
    user: `Pitch exactly ${input.count} ideas.

${brief}

For each, sketch the arc: ${w.pitchArc}, in three to five short sentences. A strong idea becomes a complete, clear ${input.parts[1] > 1 ? "series" : "video"}, not just a good first line.
Write each premise the way you'd say it out loud, in one or two plain sentences.
Do not repeat any of this channel's existing ideas:
${input.avoidTitles.length ? input.avoidTitles.map((t) => `- ${t}`).join("\n") : "- (none yet)"}`,
  };
}

export function pitchPickPrompt(input: { channel: ChannelGuide; idea: string | null; pitches: { title: string; premise: string; arc: string }[]; keep: number }) {
  const w = writingStyle(input.channel.format);
  return {
    system: `You are the editor of one channel. Choose the ${input.keep} pitches most likely to make clear, engaging videos that fit the channel, and say in one plain sentence why each one works.

${channelBlock(input.channel)}

Favour: instantly understood, fits the channel exactly, a clear arc with enough real material, a surprising moment worth watching for, easy to illustrate.${
      input.idea ? `\nThe producer asked for: ${input.idea}. ${w.pitchIdeaPick}` : ""
    }`,
    user: input.pitches.map((p, i) => `[${i}] ${p.title}\n${p.premise}\nArc: ${p.arc}`).join("\n\n"),
  };
}
