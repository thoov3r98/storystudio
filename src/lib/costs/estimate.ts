import { QUALITY_PRESETS, sceneCountRange } from "@/lib/constants";
import type { Quality } from "@/generated/prisma/enums";
import { type Pricing, imageCost, renderCost, speechCost, textCost } from "./pricing";

/*
 * Up-front cost estimates. Token counts are conservative heuristics measured
 * from typical prompt/response sizes; they are refined over time by comparing
 * with recorded CostEntry rows (see `calibration` below).
 */

export const TOKEN_HEURISTICS = {
  /** Pitching: six pitches written, three kept. */
  pitches: { input: 2500, output: 4000 },
  pitchPick: { input: 4500, output: 600 },
  /** Script pipeline (see docs/channels.md). Output includes reasoning tokens. */
  research: { input: 15000, output: 6000 },
  researchSearches: 8,
  researchNotes: { input: 8000, output: 4000 },
  plan: { input: 6000, output: 1500 },
  narration: { input: 7000, output: 1400 },
  scriptAudit: { input: 7000, output: 1000 },
  scriptRevision: { input: 7000, output: 1800 },
  sceneBreakdown: { input: 5500, output: 3800 },
  /** Expected script revisions per part. */
  expectedRevisions: 0.8,
  /** Share of images the check sends back for one redraw. */
  expectedRedraws: 0.2,
};

export type ModelNames = { main: string; fast: string; reviewer?: string };

export type Calibration = {
  /** Multiplier from recorded spend vs. estimates, clamped to [0.5, 3]. */
  textFactor: number;
};

export type EpisodeEstimateInput = {
  durationSec: number;
  quality: Quality;
  /** Writing Part 1 researches, plans and writes every part at once; `text` then covers all of them, media is for one part. */
  parts?: number;
};

export type CostBreakdown = { text: number; images: number; speech: number; render: number; total: number };

function sum(b: Omit<CostBreakdown, "total">): CostBreakdown {
  return { ...b, total: b.text + b.images + b.speech + b.render };
}

export function estimateIdeationCost(pricing: Pricing, models: ModelNames, quality: Quality, cal: Calibration = { textFactor: 1 }): CostBreakdown {
  const preset = QUALITY_PRESETS[quality];
  const writer = preset.writerModel === "main" ? models.main : models.fast;
  const reviewer = quality === "DRAFT" ? models.fast : models.reviewer?.trim() || models.main;
  const h = TOKEN_HEURISTICS;
  const text = (textCost(pricing, writer, { inputTokens: h.pitches.input, outputTokens: h.pitches.output }) + textCost(pricing, reviewer, { inputTokens: h.pitchPick.input, outputTokens: h.pitchPick.output })) * cal.textFactor;
  return sum({ text, images: 0, speech: 0, render: 0 });
}

export function estimateEpisodeCost(pricing: Pricing, models: ModelNames, input: EpisodeEstimateInput, cal: Calibration = { textFactor: 1 }): CostBreakdown {
  const preset = QUALITY_PRESETS[input.quality];
  const writer = preset.writerModel === "main" ? models.main : models.fast;
  const h = TOKEN_HEURISTICS;
  const scale = input.durationSec / 75;
  const p = input.parts ?? 1;
  // Matches scriptModels() in settings: checking uses the strongest model except at Draft.
  const checker = input.quality === "DRAFT" ? models.fast : models.reviewer?.trim() || models.main;
  const calls = (model: string, steps: [{ input: number; output: number }, number][]) =>
    textCost(pricing, model, {
      inputTokens: steps.reduce((t, [c, n]) => t + c.input * n, 0),
      outputTokens: steps.reduce((t, [c, n]) => t + c.output * n * scale, 0),
    });
  // Research and the plan happen once per story; everything after them once per part.
  const research = p > 1 ? 1 : 0;
  let text =
    calls(writer, [
      [h.research, research],
      [h.researchNotes, research],
      [h.plan, research],
      [h.narration, p],
      [h.scriptRevision, h.expectedRevisions * p],
      [h.sceneBreakdown, p],
    ]) + calls(checker, [[h.scriptAudit, (1 + h.expectedRevisions) * p]]);
  text = text * cal.textFactor + research * h.researchSearches * pricing.webSearchPerCall;

  const [, maxScenes] = sceneCountRange(input.durationSec);
  // Budget for the upper scene count, the check's redraws and ~10% retries.
  const checks = textCost(pricing, models.fast, { inputTokens: 1200, outputTokens: 150 }) * maxScenes * (1 + h.expectedRedraws);
  const images = imageCost(pricing, preset.imageQuality).costUsd * maxScenes * (1.1 + h.expectedRedraws) + checks;

  // ~5.6 characters per spoken word including spaces/punctuation, ~2.5 words/sec.
  const chars = input.durationSec * 2.5 * 5.6;
  const speech = speechCost(pricing, chars);

  // Rendering a 1080x1920 still-image video runs roughly 1.5–3x realtime on 4 vCPUs plus sandbox setup.
  const render = renderCost(pricing, 4, input.durationSec * 2.5 + 120);

  return sum({ text, images, speech, render });
}

export function formatUsd(n: number | string | { toString(): string }, digits = 2): string {
  const v = typeof n === "number" ? n : Number(n.toString());
  if (!Number.isFinite(v)) return "$—";
  if (v > 0 && v < 0.01) return "<$0.01";
  return `$${v.toFixed(digits)}`;
}
