import { BadgeCheck, CircleHelp, FlaskConical, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { DiscoverySnapshot } from "@/lib/schemas/topics";
import { cn } from "@/lib/utils";

/*
 * How discovery evidence is shown wherever a topic appears. Kept apart on
 * purpose: audience evidence (recorded numbers), AI editorial ratings, and
 * proposals are labelled as what they are.
 */

const LEVEL = {
  VERIFIED: { label: "Verified audience evidence", className: "border-emerald-200 bg-emerald-50 text-emerald-800", icon: BadgeCheck },
  REPORTED: { label: "Audience numbers entered by hand (unverified)", className: "border-sky-200 bg-sky-50 text-sky-800", icon: CircleHelp },
  NONE: { label: "No audience evidence", className: "border-zinc-200 bg-zinc-50 text-zinc-700", icon: CircleHelp },
} as const;

const STRATEGY = {
  EVIDENCE_BACKED: { label: "Evidence-backed", icon: BadgeCheck },
  ADJACENT: { label: "Related to successful videos", icon: Sparkles },
  EXPLORATORY: { label: "Exploratory", icon: FlaskConical },
} as const;

export function EvidenceLevelBadge({ level }: { level: keyof typeof LEVEL }) {
  const l = LEVEL[level];
  return (
    <Badge variant="outline" className={l.className}>
      <l.icon /> {l.label}
    </Badge>
  );
}

export function StrategyBadge({ strategy }: { strategy: keyof typeof STRATEGY }) {
  const s = STRATEGY[strategy];
  return (
    <Badge variant="outline">
      <s.icon /> {s.label}
    </Badge>
  );
}

/** The 0–100 opportunity score, always labelled as an estimate. */
export function TopicScore({ score }: { score: number | null }) {
  if (score === null) return null;
  return (
    <span className="inline-flex items-baseline gap-1" title="Weighted editorial estimate. Not a prediction of views.">
      <span className="text-lg font-semibold tabular-nums">{Math.round(score)}</span>
      <span className="text-xs text-muted-foreground">/100 opportunity estimate</span>
    </span>
  );
}

export function ScoreBreakdown({ breakdown }: { breakdown: DiscoverySnapshot["breakdown"] }) {
  if (!breakdown.length) return null;
  return (
    <details className="text-xs">
      <summary className="cursor-pointer text-muted-foreground hover:text-foreground">Score breakdown</summary>
      <table className="mt-2 w-full">
        <tbody>
          {breakdown.map((l) => (
            <tr key={l.key} className="align-top">
              <td className="py-0.5 pr-2">
                {l.label}
                <div className="text-muted-foreground">{l.note}</div>
              </td>
              <td className="py-0.5 pr-2 text-right tabular-nums text-muted-foreground">{Math.round(l.weight * 100)}%</td>
              <td className="py-0.5 text-right tabular-nums">{l.value}/10</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-1 text-muted-foreground">
        The first line comes from recorded audience numbers in the reference library; the rest are an AI editor&apos;s ratings. Weights are starting heuristics.
      </p>
    </details>
  );
}

export function EvidenceList({ evidence, className }: { evidence: DiscoverySnapshot["evidence"]; className?: string }) {
  if (!evidence.length) return <p className={cn("text-xs text-muted-foreground", className)}>No comparable video in the reference library. Treat this as an exploration, not a proven topic.</p>;
  return (
    <ul className={cn("space-y-1.5 text-xs", className)}>
      {evidence.map((e) => (
        <li key={e.referenceId}>
          <span className="font-medium">{e.url ? <a href={e.url} target="_blank" rel="noreferrer" className="underline underline-offset-2">{e.title}</a> : e.title}</span>
          <span className="text-muted-foreground">
            {" "}
            · {e.creator} on {e.platform} · {e.relation}
          </span>
          <div className="text-muted-foreground">{e.traction}</div>
        </li>
      ))}
    </ul>
  );
}

/** The angle a topic was chosen for. */
export function TopicAngle({ d }: { d: Pick<DiscoverySnapshot, "curiosityAngle" | "featuredStage" | "visualPayoff" | "whyViewers"> }) {
  const rows = [
    ["Why viewers may stop", d.whyViewers],
    ["Curiosity angle", d.curiosityAngle],
    ["Featured stage (to be researched)", d.featuredStage],
    ["Visual payoff", d.visualPayoff],
  ].filter(([, v]) => v);
  if (!rows.length) return null;
  return (
    <dl className="grid gap-1 text-xs">
      {rows.map(([k, v]) => (
        <div key={k}>
          <dt className="inline font-medium">{k}: </dt>
          <dd className="inline text-muted-foreground">{v}</dd>
        </div>
      ))}
    </dl>
  );
}
