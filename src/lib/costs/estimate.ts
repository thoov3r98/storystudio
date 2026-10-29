import { CANDIDATE_MULTIPLIER, QUALITY_PRESETS, sceneCountRange } from "@/lib/constants";
import type { Quality } from "@/generated/prisma/enums";
import { type Pricing, imageCost, renderCost, speechCost, textCost } from "./pricing";

/*
 * Up-front cost estimates. Token counts are conservative heuristics measured
 * from typical prompt/response sizes; they are refined over time by comparing
 * with recorded CostEntry rows (see `calibration` below).
 */

export const TOKEN_HEURISTICS = {
  ideationPerConcept: { input: 250, output: 380 },
  evaluationPerConcept: { input: 520, output: 600 },
  /** Script pipeline (see docs/story-quality.md), per 75 s episode. Output includes reasoning tokens. */
  plotCandidates: { input: 4500, output: 3500 },
  plotPick: { input: 3500, output: 500 },
  plotAudit: { input: 3000, output: 1000 },
  plotRepair: { input: 3500, output: 1800 },
  hookCandidates: { input: 2500, output: 900 },
  hookPick: { input: 2500, output: 700 },
  narration: { input: 7000, output: 1400 },
  scriptAudit: { input: 4000, output: 1000 },
  editorialReview: { input: 2200, output: 1500 },
  scriptRevision: { input: 6000, output: 3000 },
  sceneBreakdown: { input: 5500, output: 3800 },
  /** Expected plot repairs and script revisions per episode. */
  expectedPlotRepairs: 0.5,
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
};

export type CostBreakdown = { text: number; images: number; speech: number; render: number; total: number };

function sum(b: Omit<CostBreakdown, "total">): CostBreakdown {
  return { ...b, total: b.text + b.images + b.speech + b.render };
}

export function estimateIdeationCost(pricing: Pricing, models: ModelNames, requested: number, quality: Quality, cal: Calibration = { textFactor: 1 }): CostBreakdown {
  const preset = QUALITY_PRESETS[quality];
  const candidates = requested * CANDIDATE_MULTIPLIER;
  const writer = preset.writerModel === "main" ? models.main : models.fast;
  const reviewer = preset.reviewerModel === "main" ? models.main : models.fast;
  const h = TOKEN_HEURISTICS;
  const text =
    (textCost(pricing, writer, { inputTokens: candidates * h.ideationPerConcept.input, outputTokens: candidates * h.ideationPerConcept.output }) +
      textCost(pricing, reviewer, { inputTokens: candidates * h.evaluationPerConcept.input, outputTokens: candidates * h.evaluationPerConcept.output })) *
    cal.textFactor;
  return sum({ text, images: 0, speech: 0, render: 0 });
}

export function estimateEpisodeCost(pricing: Pricing, models: ModelNames, input: EpisodeEstimateInput, cal: Calibration = { textFactor: 1 }): CostBreakdown {
  const preset = QUALITY_PRESETS[input.quality];
  const writer = preset.writerModel === "main" ? models.main : models.fast;
  const reviewer = preset.reviewerModel === "main" ? models.main : models.fast;
  const h = TOKEN_HEURISTICS;
  const scale = input.durationSec / 75;
  // Matches scriptModels() in settings: checking uses the strongest model except at Draft.
  const checker = input.quality === "DRAFT" ? models.fast : models.reviewer?.trim() || models.main;
  const calls = (model: string, steps: [{ input: number; output: number }, number][]) =>
    textCost(pricing, model, {
      inputTokens: steps.reduce((t, [c, n]) => t + c.input * n, 0),
      outputTokens: steps.reduce((t, [c, n]) => t + c.output * n * scale, 0),
    });
  let text =
    calls(writer, [
      [h.plotCandidates, 1],
      [h.plotRepair, h.expectedPlotRepairs],
      [h.hookCandidates, 1],
      [h.narration, 1],
      [h.scriptRevision, h.expectedRevisions],
      [h.sceneBreakdown, 1],
    ]) +
    calls(checker, [
      [h.plotPick, 1],
      [h.plotAudit, 1 + h.expectedPlotRepairs],
      [h.hookPick, 1],
      [h.scriptAudit, 1 + h.expectedRevisions],
      [h.editorialReview, 1 + h.expectedRevisions],
    ]);
  text *= cal.textFactor;

  const [, maxScenes] = sceneCountRange(input.durationSec);
  // Budget for the upper scene count, the check's redraws and ~10% retries.
  const checks = textCost(pricing, reviewer === models.fast ? reviewer : models.fast, { inputTokens: 1200, outputTokens: 150 }) * maxScenes * (1 + h.expectedRedraws);
  const images = imageCost(pricing, preset.imageQuality).costUsd * maxScenes * (1.1 + h.expectedRedraws) + checks;

  // ~5.6 characters per spoken word including spaces/punctuation, ~2.5 words/sec.
  const chars = input.durationSec * 2.5 * 5.6;
  const speech = speechCost(pricing, chars);

  // Rendering a 1080x1920 still-image video runs roughly 1.5–3x realtime on 4 vCPUs plus sandbox setup.
  const render = renderCost(pricing, 4, input.durationSec * 2.5 + 120);

  return sum({ text, images, speech, render });
}

export function estimateBatchCost(
  pricing: Pricing,
  models: ModelNames,
  input: { requested: number; durationSec: number; quality: Quality; fullProduction: boolean },
  cal?: Calibration,
): { ideation: CostBreakdown; perEpisode: CostBreakdown; total: number } {
  const ideation = estimateIdeationCost(pricing, models, input.requested, input.quality, cal);
  const perEpisode = estimateEpisodeCost(pricing, models, { durationSec: input.durationSec, quality: input.quality }, cal);
  const total = ideation.total + (input.fullProduction ? perEpisode.total * input.requested : 0);
  return { ideation, perEpisode, total };
}

export function formatUsd(n: number | string | { toString(): string }, digits = 2): string {
  const v = typeof n === "number" ? n : Number(n.toString());
  if (!Number.isFinite(v)) return "$—";
  if (v > 0 && v < 0.01) return "<$0.01";
  return `$${v.toFixed(digits)}`;
}
