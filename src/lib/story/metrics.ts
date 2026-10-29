import type { QualityRecord } from "@/lib/schemas/story-plan";

/** One script version written by the checked pipeline, with what the producer did with it. */
export type ScriptRow = {
  quality: QualityRecord;
  archetype: string | null;
  /** Approved at the gate: media was made, or the producer overrode open issues. */
  approved: boolean;
  /** Replaced by another version without ever being approved. */
  rejected: boolean;
  humanRating: number | null;
  hookStyle: string | null;
  performance: { views: number | null; completionRate: number | null; earlyRetention: number | null; rewatchRate: number | null } | null;
};

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const pct = (n: number, d: number) => (d ? (n / d) * 100 : null);

/**
 * Pipeline quality and outcome measures. AI-found issues and ratings are
 * editorial signals; only the producer's decisions and platform numbers are outcomes.
 */
export function summarize(rows: ScriptRow[]) {
  const decided = rows.filter((r) => r.approved || r.rejected);
  const serious = rows.flatMap((r) => r.quality.issues.filter((i) => i.severity !== "minor"));
  const dismissed = rows.reduce((n, r) => n + r.quality.dismissed.length, 0);
  const status = (s: string) => rows.filter((r) => r.quality.status === s).length;
  const curiosity = rows.map((r) => r.quality.hooks?.pick.reviews.find((x) => x.index === r.quality.hooks?.pick.chosenIndex)?.curiosity).filter(Boolean);
  return {
    scripts: rows.length,
    firstPassPct: pct(rows.filter((r) => r.quality.metrics.firstPass).length, rows.length),
    avgRevisionCycles: mean(rows.map((r) => r.quality.metrics.plotRepairs + r.quality.metrics.scriptRevisions)),
    blockingPerScript: mean(rows.map((r) => r.quality.metrics.blockingFound)),
    significantPerScript: mean(rows.map((r) => r.quality.metrics.significantFound)),
    verdicts: { passed: status("passed"), needsAttention: status("needs-attention"), blocked: status("blocked") },
    /** Share of open blocking/significant issues on final scripts that the producer dismissed as wrong. */
    falsePositivePct: pct(dismissed, serious.length),
    dismissed,
    overrides: rows.filter((r) => r.quality.override).length,
    approvalPct: pct(decided.filter((r) => r.approved).length, decided.length),
    approved: decided.filter((r) => r.approved).length,
    rejected: decided.filter((r) => r.rejected).length,
    avgHumanRating: mean(rows.flatMap((r) => (r.humanRating ? [r.humanRating] : []))),
    rated: rows.filter((r) => r.humanRating).length,
    strongHookPct: pct(curiosity.filter((c) => c === "strong" || c === "excellent").length, curiosity.length),
    avgDurationSec: mean(rows.map((r) => r.quality.metrics.durationMs / 1000)),
    avgCostUsd: mean(rows.map((r) => r.quality.metrics.textCostUsd)),
  };
}

/** Outcomes grouped by a story property (archetype, hook style), for comparing against real performance. */
export function groupOutcomes(rows: ScriptRow[], key: (r: ScriptRow) => string | null) {
  const groups = new Map<string, ScriptRow[]>();
  for (const r of rows) {
    const k = key(r) ?? "unknown";
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  return [...groups.entries()]
    .map(([name, rs]) => {
      const perf = rs.flatMap((r) => (r.performance ? [r.performance] : []));
      const decided = rs.filter((r) => r.approved || r.rejected);
      return {
        name,
        scripts: rs.length,
        approvalPct: pct(decided.filter((r) => r.approved).length, decided.length),
        avgRating: mean(rs.flatMap((r) => (r.humanRating ? [r.humanRating] : []))),
        published: perf.length,
        avgViews: mean(perf.flatMap((p) => (p.views != null ? [p.views] : []))),
        avgEarlyRetention: mean(perf.flatMap((p) => (p.earlyRetention != null ? [p.earlyRetention] : []))),
        avgCompletion: mean(perf.flatMap((p) => (p.completionRate != null ? [p.completionRate] : []))),
        avgRewatch: mean(perf.flatMap((p) => (p.rewatchRate != null ? [p.rewatchRate] : []))),
      };
    })
    .sort((a, b) => b.scripts - a.scripts);
}
