import { SOUND_EFFECTS } from "@/lib/constants";
import { channelVisualsBlock, type ChannelGuide } from "@/lib/schemas/channel";
import type { VisualState } from "@/lib/schemas/episode";
import { sceneCountFor } from "@/lib/script";
import { channelStyle } from "./channel-styles";

/*
 * The only two model calls between a pasted script and its media: where to
 * split it into videos, and how each video is storyboarded. Neither ever
 * writes narration; code checks every cut against the producer's words.
 */

export function splitPrompt(input: { channel: ChannelGuide; sentences: string[]; parts: number }) {
  const w = channelStyle(input.channel.format);
  return {
    system: `You split a narrator's finished script for ${w.kind}s into ${input.parts} consecutive short vertical videos (a numbered series: Part 1, Part 2, …). You never change the script; you only choose where each new video starts.

- breaks: the sentence numbers where Parts 2 to ${input.parts} begin, in increasing order (${input.parts - 1} number${input.parts - 1 === 1 ? "" : "s"}).
- Keep the videos close to equal length, and split only between whole ideas or steps: never in the middle of a step, a list or a sentence pair that belongs together.
- Prefer starting each video on a sentence that works as an opening line: one that names what this part is about or lands something surprising.
- seriesTitle: a plain title for the whole series naming its subject, at most 8 words (e.g. "How Crayons Are Made", "What Happens When You Drink Coffee"). No "Part", no brand names.`,
    user: `SCRIPT (${input.sentences.length} sentences)
${input.sentences.map((s, i) => `${i + 1}. ${s}`).join("\n")}`,
  };
}

export function storyboardPrompt(input: {
  channel: ChannelGuide;
  part: number;
  parts: number;
  narration: string;
  durationSec: number;
  /** The whole script, so each part's pictures fit the series. */
  fullScript: string;
  visualNotes: string | null;
  /** Part 1's physical facts: later parts keep the same look. */
  seriesVisualState: VisualState | null;
}) {
  const [minScenes, maxScenes] = sceneCountFor(input.durationSec);
  const w = channelStyle(input.channel.format);
  const visualsBlock = channelVisualsBlock(input.channel);
  const onScreen = input.part === 1 ? w.storyboard.onScreen.part1 : w.storyboard.onScreen.later;
  const question = w.allowsQuestions ? "a short question is allowed" : "a statement, never a question";
  const multi = input.parts > 1;
  return {
    system: `${w.storyboard.role}
${visualsBlock ? `\n${visualsBlock}\n` : ""}${input.visualNotes?.trim() ? `\nTHE PRODUCER'S NOTES FOR THIS SCRIPT (follow them)\n${input.visualNotes.trim()}\n` : ""}
STEP 1 — title and summary: ${multi ? `a plain title for this part (Part ${input.part} of ${input.parts}) naming what it shows, without "Part"` : "a plain title for this video naming its subject"}, at most 8 words; and 2–3 plain sentences saying what it shows.

STEP 2 — visualState: ${w.storyboard.visualState}${input.seriesVisualState ? " This is one part of a series: keep the series' look below (same heroLook, same rules) and change setting, timeAndLight or heroSituation only where this part's narration moves on." : ""}

STEP 3 — scenes: cut the narration into ${minScenes}–${maxScenes} shots, in order. Each shot's narration is an exact, contiguous excerpt (usually one or two sentences, 4–7 seconds); joined in order they reproduce the narration word for word. Do not rewrite, add, fix or drop anything, even a word you would say differently.
${w.storyboard.shots.map((x) => `- ${x}`).join("\n")}
- Shot 1 is the first frame a scrolling viewer sees: ${w.storyboard.firstShot}
- Each shot is one single picture of one moment: never two views, a before-and-after, an inset or a comparison in one image.
- characters: leave empty unless a named character is visible.
- imagePrompt: one or two specific sentences: what is happening, to what, where, and what it looks like at this moment. Subject only: no art-style words, no text, labels, numbers, dials with readings, or brand names.
- continuity: what must be true in this shot, including how the subject looks at this stage.
- motionPreset: ${w.storyboard.motion}
- stepLabel: ${w.storyboard.stepLabel}
- soundEffect: the sound of what happens in the shot, from: ${w.soundEffects.map((k) => `${k} (${SOUND_EFFECTS[k].label.toLowerCase()})`).join(", ")}. Use "none" when nothing audible happens. Most shots where something moves or works have one.

STEP 4 — onScreenHook: the big text over the opening seconds, for viewers watching with the sound off. 3–6 words: ${onScreen}. Don't copy the narration; say its promise in fewer, punchier words, ${w.storyboard.onScreen.examples}. Wrap the one word or short phrase that carries the surprise in asterisks. Sentence case, ${question}. Only what the narration says; no number it doesn't say; no brand, no "Part".`,
    user: `${multi ? `WHOLE SCRIPT (context only; storyboard just Part ${input.part})\n${input.fullScript}\n\n` : ""}${input.seriesVisualState ? `THE SERIES' LOOK (from Part 1)\n${JSON.stringify(input.seriesVisualState, null, 1)}\n\n` : ""}NARRATION TO STORYBOARD${multi ? ` — Part ${input.part} of ${input.parts}` : ""}
${input.narration}`,
  };
}
