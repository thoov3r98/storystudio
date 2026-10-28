import { z } from "zod";

/**
 * Provider pricing used for cost estimates and usage records.
 *
 * Defaults are list prices as of October 2026 (OpenAI standard tier, ElevenLabs
 * pay-as-you-go API, Vercel Sandbox iad1). Providers change pricing and plans
 * differ; adjust them on the Settings page. Every cost the app shows is
 * labelled as an estimate derived from these numbers.
 */
export const PricingSchema = z.object({
  textModels: z.record(
    z.string(),
    z.object({ inputPerMTok: z.number().nonnegative(), cachedInputPerMTok: z.number().nonnegative(), outputPerMTok: z.number().nonnegative() }),
  ),
  /** Token prices for GPT image models when the API reports usage. */
  imageTokens: z.object({ textInputPerMTok: z.number().nonnegative(), imageInputPerMTok: z.number().nonnegative(), outputPerMTok: z.number().nonnegative() }),
  /** Fallback per-image prices by quality when usage isn't reported. */
  imagePerImage: z.object({ low: z.number().nonnegative(), medium: z.number().nonnegative(), high: z.number().nonnegative() }),
  elevenLabsPer1kChars: z.number().nonnegative(),
  sandboxPerVcpuHour: z.number().nonnegative(),
  /** Fixed overhead per sandbox render (setup time, memory). */
  sandboxOverheadPerRender: z.number().nonnegative(),
});

export type Pricing = z.infer<typeof PricingSchema>;

export const DEFAULT_PRICING: Pricing = {
  textModels: {
    "gpt-5.5": { inputPerMTok: 5, cachedInputPerMTok: 0.5, outputPerMTok: 30 },
    "gpt-5.4-mini": { inputPerMTok: 0.75, cachedInputPerMTok: 0.075, outputPerMTok: 4.5 },
    default: { inputPerMTok: 5, cachedInputPerMTok: 0.5, outputPerMTok: 30 },
  },
  imageTokens: { textInputPerMTok: 5, imageInputPerMTok: 8, outputPerMTok: 30 },
  // Portrait 1024x1536.
  imagePerImage: { low: 0.01, medium: 0.041, high: 0.165 },
  elevenLabsPer1kChars: 0.1,
  sandboxPerVcpuHour: 0.128,
  sandboxOverheadPerRender: 0.02,
};

export function textModelPrice(pricing: Pricing, model: string) {
  // Responses report dated snapshots ("gpt-5.4-mini-2026-03-17"); prices are keyed by alias.
  const alias = model.replace(/-\d{4}-\d{2}-\d{2}$/, "");
  return pricing.textModels[model] ?? pricing.textModels[alias] ?? pricing.textModels.default ?? DEFAULT_PRICING.textModels.default;
}

export function textCost(pricing: Pricing, model: string, usage: { inputTokens: number; cachedInputTokens?: number; outputTokens: number }): number {
  const p = textModelPrice(pricing, model);
  const cached = usage.cachedInputTokens ?? 0;
  const uncached = Math.max(0, usage.inputTokens - cached);
  return (uncached * p.inputPerMTok + cached * p.cachedInputPerMTok + usage.outputTokens * p.outputPerMTok) / 1_000_000;
}

export function imageCost(
  pricing: Pricing,
  quality: "low" | "medium" | "high",
  usage?: { textInputTokens: number; imageInputTokens: number; outputTokens: number } | null,
): { costUsd: number; estimated: boolean } {
  if (usage && usage.outputTokens > 0) {
    const p = pricing.imageTokens;
    return {
      costUsd: (usage.textInputTokens * p.textInputPerMTok + usage.imageInputTokens * p.imageInputPerMTok + usage.outputTokens * p.outputPerMTok) / 1_000_000,
      estimated: false,
    };
  }
  return { costUsd: pricing.imagePerImage[quality], estimated: true };
}

export function speechCost(pricing: Pricing, characters: number): number {
  return (characters / 1000) * pricing.elevenLabsPer1kChars;
}

export function renderCost(pricing: Pricing, vcpus: number, seconds: number): number {
  return (vcpus * seconds * pricing.sandboxPerVcpuHour) / 3600 + pricing.sandboxOverheadPerRender;
}
