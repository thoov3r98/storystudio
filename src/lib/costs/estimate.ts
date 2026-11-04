import { QUALITY_PRESETS } from "@/lib/constants";
import { sceneCountFor } from "@/lib/script";
import type { Quality } from "@/generated/prisma/enums";
import { type Pricing, imageCost, renderCost, speechCost, textCost } from "./pricing";

/*
 * Up-front cost estimates for a pasted script. Token counts are conservative
 * heuristics from typical prompt/response sizes; output scales with the words.
 */

export const TOKEN_HEURISTICS = {
  /** Fixed prompt size of the split and storyboard calls, before the script. */
  splitBase: { input: 700, output: 300 },
  storyboardBase: { input: 2200, output: 600 },
  /** Prompt tokens per script word (the storyboard also reads the whole script for context). */
  inputPerWord: 1.4,
  /** Storyboard output tokens per narration word (shots, prompts, continuity, reasoning). */
  storyboardOutputPerWord: 18,
  /** Share of images the check sends back for one redraw. */
  expectedRedraws: 0.2,
};

export type ModelNames = { main: string; fast: string };

export type ScriptEstimateInput = {
  /** Words in the whole pasted script. */
  words: number;
  parts: number;
  /** Words per second as the video plays. */
  wordsPerSecond: number;
  quality: Quality;
};

export type CostBreakdown = { text: number; images: number; speech: number; render: number; total: number };

function sum(b: Omit<CostBreakdown, "total">): CostBreakdown {
  return { ...b, total: b.text + b.images + b.speech + b.render };
}

/** Everything for the whole script: the split, one storyboard per part, and every part's images, voice and render. */
export function estimateScriptCost(pricing: Pricing, models: ModelNames, input: ScriptEstimateInput): CostBreakdown & { perPartSec: number } {
  const parts = Math.max(1, input.parts);
  const model = QUALITY_PRESETS[input.quality].writerModel === "main" ? models.main : models.fast;
  const h = TOKEN_HEURISTICS;
  const partWords = input.words / parts;
  const scriptTokens = input.words * h.inputPerWord;
  const split = parts > 1 ? textCost(pricing, model, { inputTokens: h.splitBase.input + scriptTokens, outputTokens: h.splitBase.output }) : 0;
  // Each storyboard re-reads the whole script when there are several parts.
  const storyboardInput = h.storyboardBase.input + (parts > 1 ? scriptTokens : 0) + partWords * h.inputPerWord;
  const storyboard = textCost(pricing, model, { inputTokens: storyboardInput, outputTokens: h.storyboardBase.output + partWords * h.storyboardOutputPerWord }) * parts;
  const post = textCost(pricing, models.fast, { inputTokens: 1500 + partWords * 3, outputTokens: 600 }) * parts;
  // ~10% of structured calls are retried.
  const text = (split + storyboard + post) * 1.1;

  const perPartSec = partWords / Math.max(0.5, input.wordsPerSecond);
  const [, maxScenes] = sceneCountFor(perPartSec);
  const checks = textCost(pricing, models.fast, { inputTokens: 1200, outputTokens: 150 }) * maxScenes * (1 + h.expectedRedraws);
  const images = (imageCost(pricing, QUALITY_PRESETS[input.quality].imageQuality).costUsd * maxScenes * (1.1 + h.expectedRedraws) + checks) * parts;

  // ~5.6 characters per spoken word including spaces and punctuation.
  const speech = speechCost(pricing, input.words * 5.6);

  // Rendering a 1080x1920 still-image video runs roughly 1.5–3x realtime on 4 vCPUs plus sandbox setup.
  const render = renderCost(pricing, 4, perPartSec * 2.5 + 120) * parts;

  return { ...sum({ text, images, speech, render }), perPartSec };
}

export function formatUsd(n: number | string | { toString(): string }, digits = 2): string {
  const v = typeof n === "number" ? n : Number(n.toString());
  if (!Number.isFinite(v)) return "$—";
  if (v > 0 && v < 0.01) return "<$0.01";
  return `$${v.toFixed(digits)}`;
}
