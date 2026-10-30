import { similarity } from "@/lib/similarity";
import { normalizeTitle } from "@/lib/text";
import { RATED_DIMENSIONS, type RatedDimension, type TopicRatings } from "@/lib/schemas/topics";

/*
 * Deterministic, explainable topic scoring. The reviewer model only rates the
 * qualitative dimensions; comparable evidence comes from the library's metric
 * observations, and missing evidence always counts as zero.
 *
 * The weights are starting heuristics, not validated performance predictions.
 */

export const SCORE_WEIGHTS = {
  evidence: 0.25,
  visual: 0.25,
  familiarity: 0.15,
  surprise: 0.15,
  researchAvailability: 0.1,
  visualFeasibility: 0.1,
} as const satisfies Record<"evidence" | RatedDimension, number>;

export const DIMENSION_LABELS: Record<keyof typeof SCORE_WEIGHTS, string> = {
  evidence: "Comparable content with audience evidence",
  visual: "Visually compelling process",
  familiarity: "Familiar finished product",
  surprise: "Surprising manufacturing detail",
  researchAvailability: "Credible research available",
  visualFeasibility: "Can be illustrated accurately",
};

export type Observation = { views: number | null; likes: number | null; comments: number | null; shares: number | null; observedAt: Date; source: "MANUAL" | "YOUTUBE_API" };
export type ReferenceForScoring = { id: string; platform: string; category: string; publishedAt: Date | null; metrics: Observation[] };

export type TractionTier = "strong" | "moderate" | "limited" | "unknown";
export type Traction = { tier: TractionTier; value: number; verified: boolean; observation: Observation | null; explanation: string };

const TIER_VALUE: Record<TractionTier, number> = { strong: 1, moderate: 0.6, limited: 0.25, unknown: 0 };
/** Producer-entered numbers can't be checked, so they count for less than API observations. */
const MANUAL_TRUST = 0.8;
/** A comparable in a different product category is weaker evidence. */
const OTHER_CATEGORY = 0.7;

/**
 * Raw views aren't comparable across platforms or ages. Long-form platforms
 * are judged by views per month since publishing; short-form feeds front-load
 * their views, so they are judged on the total.
 */
const THRESHOLDS: Record<string, { perMonth: boolean; strong: number; moderate: number }> = {
  youtube: { perMonth: true, strong: 100_000, moderate: 10_000 },
  tiktok: { perMonth: false, strong: 2_000_000, moderate: 300_000 },
  instagram: { perMonth: false, strong: 1_000_000, moderate: 150_000 },
  other: { perMonth: true, strong: 100_000, moderate: 10_000 },
};

const fmt = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(Math.round(n)));
const day = (d: Date) => d.toISOString().slice(0, 10);

/** The most recent observation that has a view count. */
export function latestViews(metrics: Observation[]): Observation | null {
  return [...metrics].filter((m) => m.views !== null).sort((a, b) => b.observedAt.getTime() - a.observedAt.getTime())[0] ?? null;
}

/** How much audience interest a reference has shown, with the reasoning in words. */
export function traction(ref: Pick<ReferenceForScoring, "platform" | "publishedAt" | "metrics">): Traction {
  const obs = latestViews(ref.metrics);
  if (!obs) return { tier: "unknown", value: 0, verified: false, observation: null, explanation: "No view count recorded." };
  const verified = obs.source === "YOUTUBE_API";
  const t = THRESHOLDS[ref.platform] ?? THRESHOLDS.other;
  const views = obs.views!;
  let measure = views;
  let basis = `${fmt(views)} views`;
  if (t.perMonth) {
    if (ref.publishedAt) {
      const months = Math.max(1, (obs.observedAt.getTime() - ref.publishedAt.getTime()) / (30.44 * 86_400_000));
      measure = views / months;
      basis = `${fmt(views)} views over ${months < 12 ? `${Math.round(months)} months` : `${(months / 12).toFixed(1)} years`} (≈${fmt(measure)}/month)`;
    } else {
      // Without a publish date, a big total could be a decade of slow views: judged as if 3 years old.
      measure = views / 36;
      basis = `${fmt(views)} views, publish date unknown (judged as ≈${fmt(measure)}/month)`;
    }
  }
  const tier: TractionTier = measure >= t.strong ? "strong" : measure >= t.moderate ? "moderate" : "limited";
  const engaged = [obs.likes, obs.comments, obs.shares].filter((x): x is number => x !== null);
  const engagement = engaged.length && views > 0 ? ` · ${((engaged.reduce((a, b) => a + b, 0) / views) * 100).toFixed(1)}% engagement` : "";
  return {
    tier,
    value: TIER_VALUE[tier] * (verified ? 1 : MANUAL_TRUST),
    verified,
    observation: obs,
    explanation: `${basis} on ${ref.platform}${engagement}, observed ${day(obs.observedAt)}, ${verified ? "verified via API" : "entered by hand, unverified"}.`,
  };
}

export type EvidenceLevel = "VERIFIED" | "REPORTED" | "NONE";

/** The comparable-evidence dimension (0–10) and evidence level from the references a topic is linked to. */
export function comparableEvidence(category: string, refs: ReferenceForScoring[]): { value: number; level: EvidenceLevel; note: string } {
  if (!refs.length) return { value: 0, level: "NONE", note: "No comparable video in the library." };
  const scored = refs.map((r) => {
    const t = traction(r);
    const sameCategory = normalizeTitle(r.category) === normalizeTitle(category);
    return { t, value: t.value * (sameCategory ? 1 : OTHER_CATEGORY) };
  });
  const best = scored.reduce((a, b) => (b.value > a.value ? b : a));
  const level: EvidenceLevel = scored.some((s) => s.t.verified && s.t.observation) ? "VERIFIED" : scored.some((s) => s.t.observation) ? "REPORTED" : "NONE";
  const note =
    level === "NONE"
      ? `${refs.length} comparable video${refs.length === 1 ? "" : "s"}, but no recorded audience numbers.`
      : `Best comparable: ${best.t.tier} traction. ${best.t.explanation}`;
  return { value: Math.round(best.value * 100) / 10, level, note };
}

export type ScoreLine = { key: keyof typeof SCORE_WEIGHTS; label: string; weight: number; value: number; points: number; note: string };

const clamp10 = (n: number) => Math.max(0, Math.min(10, Math.round(n)));

/** Weighted 0–100 score with a line per dimension. Same inputs always give the same score. */
export function scoreTopic(ratings: TopicRatings, evidence: { value: number; note: string }): { score: number; breakdown: ScoreLine[] } {
  const values: Record<keyof typeof SCORE_WEIGHTS, { value: number; note: string }> = {
    evidence: { value: Math.max(0, Math.min(10, evidence.value)), note: evidence.note },
    ...(Object.fromEntries(RATED_DIMENSIONS.map((d) => [d, { value: clamp10(ratings[d].score), note: ratings[d].note }])) as Record<RatedDimension, { value: number; note: string }>),
  };
  const breakdown = (Object.keys(SCORE_WEIGHTS) as (keyof typeof SCORE_WEIGHTS)[]).map((key) => {
    const weight = SCORE_WEIGHTS[key];
    const { value, note } = values[key];
    return { key, label: DIMENSION_LABELS[key], weight, value, points: Math.round(weight * value * 10 * 10) / 10, note };
  });
  return { score: Math.round(breakdown.reduce((t, l) => t + l.points, 0) * 10) / 10, breakdown };
}

/** A strategy may only claim what the evidence shows. */
export function honestStrategy(claimed: "EVIDENCE_BACKED" | "ADJACENT" | "EXPLORATORY", refs: number, level: EvidenceLevel) {
  if (refs === 0) return "EXPLORATORY" as const;
  if (claimed === "EVIDENCE_BACKED" && level === "NONE") return "ADJACENT" as const;
  return claimed;
}

/**
 * Picks the top `count` by score while keeping them different: a second pick
 * from the same category or a near-identical product is skipped until there
 * is nothing else to show.
 */
export function pickDiverse<T extends { product: string; category: string; score: number }>(items: T[], count: number): T[] {
  const sorted = [...items].sort((a, b) => b.score - a.score);
  const picks: T[] = [];
  const tooClose = (a: T, b: T) => similarity({ title: a.product, premise: "", keywords: [] }, { title: b.product, premise: "", keywords: [] }).score >= 0.45;
  for (const strict of [true, false]) {
    for (const item of sorted) {
      if (picks.length >= count) break;
      if (picks.includes(item)) continue;
      if (picks.some((p) => tooClose(p, item))) continue;
      if (strict && picks.some((p) => normalizeTitle(p.category) === normalizeTitle(item.category))) continue;
      picks.push(item);
    }
  }
  return picks;
}
