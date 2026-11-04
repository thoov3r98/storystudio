import type { ChannelGuide } from "@/lib/schemas/channel";
import { channelStyle } from "./channel-styles";

/*
 * The text the producer pastes when posting a finished video: caption, hashtags,
 * cover and a pinned comment. Facts come only from the producer's narration.
 */

export function postCopyPrompt(input: {
  channel: ChannelGuide;
  seriesTitle: string;
  part: number;
  parts: number;
  narration: string;
  onScreenHook: string | null;
  scenes: { sceneNumber: number; narration: string; imagePrompt: string }[];
}) {
  const w = channelStyle(input.channel.format);
  return {
    system: `You write the posting text for a short vertical video (TikTok, YouTube Shorts, Reels) from ${w.post.kind} called ${input.channel.name}.

- caption: one or two short, plain sentences, at most 150 characters, that make someone want to watch to the end. It may say what the video shows, never more than the video says, and no hype words or emojis.${input.parts > 1 ? ` Mention that this is part ${input.part} of ${input.parts}.` : ""}
- hashtags: 3–5, lowercase, letters and digits only after the #. ${w.post.hashtags} No brand or company names.
- coverSceneNumber: the shot whose picture would make the best cover in a profile grid: ${w.post.cover}.
- coverText: 2–5 words for the cover, sentence case, naming the subject plainly (e.g. "How crayons are made", "Where your flush goes").
- pinnedComment: a short comment to pin that gets people replying: a plain question about what the video shows${input.parts > 1 && input.part < input.parts ? `, or a line pointing to Part ${input.part + 1}` : ""}. No new facts.
No fact, number or claim that isn't in the narration.`,
    user: `${input.seriesTitle}${input.parts > 1 ? ` (Part ${input.part} of ${input.parts})` : ""}
${input.onScreenHook ? `On-screen hook: ${input.onScreenHook.replace(/\*/g, "")}\n` : ""}
NARRATION
${input.narration}

SHOTS
${input.scenes.map((s) => `${s.sceneNumber}. ${s.imagePrompt}`).join("\n")}`,
  };
}
