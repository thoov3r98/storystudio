import { AlertTriangle, CheckCircle2, OctagonX } from "lucide-react";
import { Section } from "@/components/studio";
import type { QualityRecord, RecordedIssue } from "@/lib/schemas/quality";
import type { ProcessSpec, ResearchRecord } from "@/lib/schemas/process";
import { cn } from "@/lib/utils";
import { DismissIssueButton, EpisodeActionButton, ScriptRating } from "./episode-client";

const STATUS = {
  passed: { label: "Passed", className: "border-emerald-200 bg-emerald-50/70 text-emerald-900", icon: CheckCircle2 },
  "needs-attention": { label: "Needs your attention", className: "border-amber-200 bg-amber-50/70 text-amber-900", icon: AlertTriangle },
  blocked: { label: "Blocked", className: "border-red-200 bg-red-50/60 text-red-900", icon: OctagonX },
} as const;

function Quote({ children }: { children: React.ReactNode }) {
  return <blockquote className="mt-1 border-l-2 pl-2 text-xs italic text-muted-foreground">“{children}”</blockquote>;
}

function IssueCard({ issue, dismissed, versionId, canDismiss }: { issue: RecordedIssue; dismissed: boolean; versionId: string; canDismiss: boolean }) {
  const tone = dismissed ? "bg-card opacity-60" : issue.severity === "blocking" ? "border-red-200 bg-red-50/50" : issue.severity === "significant" ? "border-amber-200 bg-amber-50/50" : "bg-card";
  return (
    <div className={cn("rounded-xl border p-3 text-sm", tone)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-medium">
          {issue.severity} · {issue.category.replaceAll("-", " ")} · {issue.kind === "contradiction" ? "contradiction" : "creative concern"} · {issue.location}
          {issue.stage === "continuity" ? " · series" : issue.stage === "attention" ? " · attention & payoff" : ""}
          {!issue.verified ? " · quote not found in script" : ""}
          {dismissed ? " · dismissed by you" : ""}
        </span>
        {canDismiss && !dismissed && issue.severity !== "minor" ? <DismissIssueButton versionId={versionId} issueId={issue.id} /> : null}
      </div>
      <Quote>{issue.evidence}</Quote>
      <p className="mt-1.5">{issue.problem}</p>
      <p className="mt-1 text-xs text-muted-foreground">Repair: {issue.repair}</p>
    </div>
  );
}

/** The part plan and the research every line was checked against, with its sources. */
function ProcessView({ process, research, part }: { process: ProcessSpec; research: ResearchRecord | null; part: number }) {
  const current = process.plan.parts.find((p) => p.part === part);
  return (
    <details className="rounded-xl border bg-card p-3 text-sm">
      <summary className="cursor-pointer font-medium">
        Research and plan (part {part} of {process.plan.parts.length}{research ? `, ${research.sources.length} sources` : ""})
      </summary>
      <ol className="mt-2 space-y-1 text-xs">
        {process.plan.parts.map((p) => (
          <li key={p.part} className={cn(p.part === part ? "font-medium" : "text-muted-foreground")}>
            Part {p.part}: {p.title} ({p.stages.join(", ")})
          </li>
        ))}
      </ol>
      {research ? (
        <div className="mt-3 space-y-3 border-t pt-3 text-xs">
          <p>{research.overview}</p>
          {research.stages
            .filter((s) => current?.stages.includes(s.id))
            .map((s) => (
              <div key={s.id}>
                <div className="font-medium">
                  {s.id} {s.name}
                </div>
                <ul className="mt-1 ml-4 list-disc space-y-1">
                  {s.steps.map((st, i) => (
                    <li key={i}>
                      {st.what}
                      {st.details ? <span className="text-muted-foreground"> ({st.details})</span> : null}
                      {st.sources.length ? <span className="text-muted-foreground"> [{st.sources.join(", ")}]</span> : null}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          {research.uncertain.length ? <p className="text-muted-foreground">Left out as uncertain: {research.uncertain.join("; ")}</p> : null}
          <ol className="space-y-0.5">
            {research.sources.map((s) => (
              <li key={s.n}>
                [{s.n}]{" "}
                <a href={s.url} target="_blank" rel="noreferrer" className="underline underline-offset-2">
                  {s.title}
                </a>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </details>
  );
}

function fmtDuration(ms: number) {
  const s = Math.round(ms / 1000);
  return s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`;
}

/** The record of every check on the current script: verdict, open issues, research and revisions. */
export function ScriptChecks(props: {
  quality: QualityRecord | undefined;
  process?: ProcessSpec;
  research?: ResearchRecord | null;
  versionId: string;
  episodeId: string;
  humanRating: number | null;
  busy: boolean;
  atGate: boolean;
}) {
  const { quality, process, research, versionId, episodeId, busy, atGate } = props;
  if (!quality) {
    return (
      <Section title="Script checks">
        <p className="text-sm text-muted-foreground">This script was written before the checks were added. Regenerate it to have it fact-checked.</p>
        <div className="mt-3">
          <ScriptRating versionId={versionId} rating={props.humanRating} />
        </div>
      </Section>
    );
  }
  const status = STATUS[quality.status];
  const dismissed = new Set(quality.dismissed.map((d) => d.issueId));
  const serious = quality.issues.filter((i) => i.severity !== "minor");
  const minor = quality.issues.filter((i) => i.severity === "minor");
  const openCount = serious.filter((i) => !dismissed.has(i.id)).length;
  const m = quality.metrics;

  return (
    <Section
      title="Script checks"
      description="An independent fact-check of this script against the web research, plus clarity, tone, and an attention and payoff review (which can flag pacing, never block). Read the sources for anything that matters."
    >
      <div className="space-y-4">
        <div className={cn("flex flex-col gap-3 rounded-xl border p-4 text-sm sm:flex-row sm:items-center sm:justify-between", status.className)}>
          <div className="flex gap-2">
            <status.icon className="mt-0.5 size-4 shrink-0" />
            <div>
              <div className="font-medium">{status.label}</div>
              <p className="text-xs opacity-80">
                {quality.status === "blocked"
                  ? "A mistake a viewer would notice. It can't be approved until it is fixed, or you dismiss the issue as wrong."
                  : quality.status === "needs-attention"
                    ? `${openCount} open item${openCount === 1 ? "" : "s"} survived the automatic revisions. Fix them, or approve with an override.`
                    : "No blocking or significant problems found."}
              </p>
              <p className="mt-1 text-xs opacity-70">
                Revised {m.scriptRevisions}× · {m.firstPass ? "passed first time" : "needed fixes"} · {fmtDuration(m.durationMs)} · ${m.textCostUsd.toFixed(2)} writing
                {quality.override ? ` · approved with ${quality.override.open} open item(s) by your override` : ""}
              </p>
            </div>
          </div>
          {openCount > 0 && process && atGate ? (
            <div className="shrink-0">
              <EpisodeActionButton
                episodeId={episodeId}
                request={{ action: "revise-script" }}
                disabled={busy}
                label="Fix flagged issues"
                size="sm"
                continueProduction={false}
                confirm="Fixes each open issue from the research, rewrites only the affected lines, and checks the whole script again. Saved as a new version; nothing is spent on media."
              />
            </div>
          ) : null}
        </div>

        {serious.length ? (
          <div className="space-y-2">
            {serious.map((i) => (
              <IssueCard key={i.id} issue={i} dismissed={dismissed.has(i.id)} versionId={versionId} canDismiss={atGate && !busy} />
            ))}
          </div>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-3">
          <span className="text-sm font-medium">Your rating of this script</span>
          <ScriptRating versionId={versionId} rating={props.humanRating} />
        </div>

        {minor.length ? (
          <details className="rounded-xl border bg-card p-3 text-sm">
            <summary className="cursor-pointer font-medium">Minor notes ({minor.length})</summary>
            <div className="mt-2 space-y-2">
              {minor.map((i) => (
                <IssueCard key={i.id} issue={i} dismissed={dismissed.has(i.id)} versionId={versionId} canDismiss={false} />
              ))}
            </div>
          </details>
        ) : null}

        {process ? <ProcessView process={process} research={research ?? null} part={quality.part ?? 1} /> : null}

        <details className="rounded-xl border bg-card p-3 text-sm">
          <summary className="cursor-pointer font-medium">Check and revision history</summary>
          <ol className="mt-2 space-y-2 text-xs">
            {quality.scriptRounds.map((r, i) => (
              <li key={`s${i}`}>
                <span className="font-medium">Script check {i + 1}:</span> {countLine(r.issues)}
                {r.unresolvedPrevious.length ? ` · still open from before: ${r.unresolvedPrevious.join(", ")}` : ""}
                {r.changeLog.length ? <ChangeList items={r.changeLog} /> : null}
              </li>
            ))}
          </ol>
        </details>
      </div>
    </Section>
  );
}

function countLine(issues: RecordedIssue[]) {
  const n = (s: string) => issues.filter((i) => i.severity === s).length;
  return `${n("blocking")} blocking, ${n("significant")} significant, ${n("minor")} minor`;
}

function ChangeList({ items }: { items: { issueId: string; change: string }[] }) {
  return (
    <ul className="mt-1 ml-4 list-disc space-y-0.5 text-muted-foreground">
      {items.map((c, k) => (
        <li key={k}>
          {c.issueId}: {c.change}
        </li>
      ))}
    </ul>
  );
}
