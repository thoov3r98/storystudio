import { MOTION_PRESETS } from "@/lib/constants";
import { channelStyle } from "@/lib/ai/channel-styles";
import type { SceneSpec } from "@/lib/schemas/episode";
import { countWords, DEFAULT_WORDS_PER_SECOND, estimateSpokenDuration, joinNarration, tokenize } from "@/lib/text";

/*
 * Deterministic handling of the producer's pasted script: cleaning, splitting
 * into sentences, cutting into parts at chosen sentences, and checking that a
 * storyboard reproduces the words exactly. Code does every cut, so the words
 * the producer wrote are the words that are spoken.
 */

export const MAX_PARTS = 10;
/** Parts outside this range still work; the form warns about them. */
export const COMFORTABLE_PART_SEC: [number, number] = [20, 90];

/** One space between words, no stray blank lines; the text itself is untouched. */
export function cleanScript(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n\n");
}

/**
 * Sentences in order. A sentence ends at . ! ? or … (with any closing quote or
 * bracket), or at a paragraph break. Joined with single spaces they give the script back.
 */
export function splitSentences(text: string): string[] {
  return cleanScript(text)
    .split("\n\n")
    .flatMap((p) => p.split(/(?<=[.!?…]["'”’)\]]*)\s+/))
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Cuts the sentences into parts. `breaks` are the 1-based sentence numbers where parts 2..N begin. */
export function cutParts(sentences: string[], breaks: number[]): string[] {
  const starts = [1, ...breaks];
  return starts.map((start, i) => sentences.slice(start - 1, (starts[i + 1] ?? sentences.length + 1) - 1).join(" "));
}

export function splitIssues(sentences: string[], breaks: number[], parts: number): string[] {
  const issues: string[] = [];
  if (breaks.length !== parts - 1) issues.push(`Give exactly ${parts - 1} break${parts - 1 === 1 ? "" : "s"} (you gave ${breaks.length}).`);
  let last = 1;
  for (const b of breaks) {
    if (!Number.isInteger(b) || b <= last || b > sentences.length) {
      issues.push(`Breaks must be increasing sentence numbers from 2 to ${sentences.length}, each after the last; ${b} is not.`);
      break;
    }
    last = b;
  }
  if (issues.length) return issues;
  const words = cutParts(sentences, breaks).map(countWords);
  const avg = words.reduce((a, b) => a + b, 0) / words.length;
  const short = words.map((w, i) => (w < avg * 0.5 ? i + 1 : 0)).filter(Boolean);
  if (short.length) issues.push(`Part${short.length > 1 ? "s" : ""} ${short.join(", ")} ${short.length > 1 ? "are" : "is"} less than half the average length (${words.join(", ")} words). Move the breaks so the parts are closer to equal.`);
  return issues;
}

/** Even split by word count at sentence boundaries: the fallback when the model can't find good breaks. */
export function evenBreaks(sentences: string[], parts: number): number[] {
  const words = sentences.map(countWords);
  const total = words.reduce((a, b) => a + b, 0);
  const breaks: number[] = [];
  let acc = 0;
  for (let i = 0; i < sentences.length && breaks.length < parts - 1; i++) {
    acc += words[i];
    const target = (total * (breaks.length + 1)) / parts;
    const next = i + 2;
    if (acc >= target && next <= sentences.length && next > (breaks.at(-1) ?? 1)) breaks.push(next);
  }
  return breaks;
}

/** Shots for a part of this length: one picture roughly every 4–7 seconds. */
export function sceneCountFor(durationSec: number): [number, number] {
  const min = Math.max(1, Math.round(durationSec / 7));
  return [min, Math.max(min + 1, Math.round(durationSec / 4.5))];
}

export function estimateParts(text: string, parts: number, wordsPerSecond = DEFAULT_WORDS_PER_SECOND) {
  const totalSec = estimateSpokenDuration(cleanScript(text), wordsPerSecond);
  return { words: countWords(text), totalSec, perPartSec: parts > 0 ? totalSec / parts : totalSec };
}

/** Shots must be numbered, valid, use the style's sounds, and be an exact word-for-word cut of the narration. */
export function storyboardIssues(narration: string, scenes: SceneSpec[], opts: { format: string; durationSec: number }): string[] {
  const issues: string[] = [];
  const [min, max] = sceneCountFor(opts.durationSec);
  // A little slack around the asked-for range: a near miss isn't worth a paid retry.
  if (scenes.length < Math.max(1, min - 1) || scenes.length > max + 2) issues.push(`Use ${min}–${max} shots (you made ${scenes.length}).`);
  scenes.forEach((s, i) => {
    if (s.sceneNumber !== i + 1) issues.push(`Shots must be numbered 1..N in order; the shot at position ${i + 1} is numbered ${s.sceneNumber}.`);
    if (!s.narration.trim()) issues.push(`Shot ${i + 1} has empty narration.`);
    if (!MOTION_PRESETS.includes(s.motionPreset)) issues.push(`Shot ${i + 1} has an invalid motionPreset.`);
    const label = countWords(s.stepLabel ?? "");
    if (label < 1 || label > 5) issues.push(`Shot ${i + 1} needs a stepLabel of 2–4 plain words (it has ${label}).`);
  });
  const late = scenes.filter((s) => s.motionPreset === "dive-in" && s.sceneNumber !== 1);
  if (late.length) issues.push(`dive-in is only for shot 1; shots ${late.map((s) => s.sceneNumber).join(", ")} must use another motionPreset.`);
  const allowed = new Set<string>([...channelStyle(opts.format).soundEffects, "none"]);
  const wrong = scenes.filter((s) => !allowed.has(s.soundEffect));
  if (wrong.length) issues.push(`soundEffect must be one of ${[...allowed].join(", ")}; shots ${wrong.map((s) => s.sceneNumber).join(", ")} use others.`);
  const script = tokenize(narration);
  const cut = tokenize(joinNarration(scenes));
  const at = script.findIndex((w, i) => cut[i] !== w);
  if (at >= 0 || cut.length !== script.length) {
    const where = at >= 0 ? at : Math.min(script.length, cut.length);
    issues.push(
      `The shots' narration, joined in order, must reproduce the narration word for word. They differ at word ${where + 1}: the narration has "${script.slice(where, where + 8).join(" ")}", the shots have "${cut.slice(where, where + 8).join(" ")}".`,
    );
  }
  return issues;
}

/**
 * The producer's punctuation and capitals are kept: each shot's narration is
 * re-cut from the original text at the same word positions the model chose.
 */
export function recutExactly<T extends { narration: string }>(narration: string, scenes: T[]): T[] {
  const words = narration.split(/\s+/).filter(Boolean);
  let at = 0;
  return scenes.map((s, i) => {
    const start = at;
    if (i === scenes.length - 1) {
      at = words.length;
    } else {
      const need = tokenize(s.narration).length;
      let have = 0;
      while (at < words.length && have < need) have += tokenize(words[at++]).length;
    }
    return { ...s, narration: words.slice(start, at).join(" ") };
  });
}

/** The on-screen hook is read in a glance and may only repeat what the narration says. One *highlighted* phrase at most. */
export function onScreenHookIssues(text: string, narration: string, opts: { allowQuestion?: boolean } = {}): string[] {
  const issues: string[] = [];
  const words = countWords(text.replace(/\*/g, ""));
  if (words < 2 || words > 7) issues.push(`onScreenHook must be 3–6 words (it is ${words}).`);
  const stars = (text.match(/\*/g) ?? []).length;
  if (stars !== 0 && stars !== 2) issues.push('onScreenHook marks one word or short phrase with a single pair of asterisks, e.g. "It starts as a *liquid*".');
  if (text.includes("?") && !opts.allowQuestion) issues.push("onScreenHook must be a plain statement, not a question.");
  const said = new Set(narration.match(/\d[\d,.]*\d|\d/g) ?? []);
  const unsaid = (text.match(/\d[\d,.]*\d|\d/g) ?? []).filter((n) => !said.has(n));
  if (unsaid.length) issues.push(`onScreenHook says ${unsaid.join(", ")}, which the narration doesn't.`);
  return issues;
}

/** Numbers as written ("1,200", "3.5", "40"), for checking text says no number the narration doesn't. */
export function numbersIn(text: string): string[] {
  return text.match(/\d[\d,.]*\d|\d/g) ?? [];
}

export function firstSentence(text: string): string {
  return (/^.*?[.!?](?=\s|$)/.exec(text.trim())?.[0] ?? text.trim()).trim();
}
