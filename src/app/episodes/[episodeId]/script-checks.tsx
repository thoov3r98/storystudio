import { AlertTriangle, CheckCircle2, OctagonX } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Section } from "@/components/studio";
import type { EditorialNote, Plot, QualityRecord, RecordedIssue } from "@/lib/schemas/story-plan";
import type { ProcessSpec, ResearchRecord } from "@/lib/schemas/process";
import { cn } from "@/lib/utils";
import { DismissIssueButton, EpisodeActionButton, ScriptRating } from "./episode-client";

const STATUS = {
  passed: { label: "Passed", className: "border-emerald-200 bg-emerald-50/70 text-emerald-900", icon: CheckCircle2 },
  "needs-attention": { label: "Needs your attention", className: "border-amber-200 bg-amber-50/70 text-amber-900", icon: AlertTriangle },
  blocked: { label: "Blocked", className: "border-red-200 bg-red-50/60 text-red-900", icon: OctagonX },
} as const;

const RATING_CLASS: Record<string, string> = {
  weak: "bg-red-100 text-red-800",
  acceptable: "bg-muted text-foreground",
  strong: "bg-emerald-100 text-emerald-800",
  excellent: "bg-emerald-200 text-emerald-900",
};

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
          {issue.stage === "continuity" ? " · series" : ""}
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

function NoteCard({ note }: { note: EditorialNote }) {
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-3 text-sm">
      <span className="text-xs font-medium">editor · {note.area}</span>
      <Quote>{note.evidence}</Quote>
      <p className="mt-1.5">{note.problem}</p>
      <p className="mt-1 text-xs text-muted-foreground">Fix: {note.fix}</p>
    </div>
  );
}

function PlotView({ plot, part }: { plot: Plot; part: number }) {
  const parts = plot.parts ?? [];
  const mine = parts.length > 1 ? new Set(parts.find((p) => p.part === part)?.beats ?? []) : null;
  return (
    <div className="space-y-2 text-sm">
      <p>
        <span className="font-medium">{plot.archetype}</span> · {plot.dramaticQuestion}
      </p>
      <p className="text-xs text-muted-foreground">Opens: {plot.openingState}</p>
      {plot.worldRules.length ? <p className="text-xs text-muted-foreground">Rules: {plot.worldRules.map((r) => `${r.id} ${r.rule}`).join(" · ")}</p> : null}
      {plot.setups.length ? <p className="text-xs text-muted-foreground">Setups: {plot.setups.map((s) => `${s.id} (beat ${s.plantedInBeat}) ${s.what}`).join(" · ")}</p> : null}
      <ol className="space-y-1.5">
        {plot.beats.map((b) => (
          <li key={b.n} className={cn("rounded-lg border bg-background p-2", mine && !mine.has(b.n) && "opacity-50")}>
            <span className="text-xs font-medium uppercase text-muted-foreground">
              B{b.n} · {b.link}
            </span>{" "}
            {b.event}
            <div className="text-xs text-muted-foreground">
              Because: {b.cause} ({b.enabledBy.join(", ") || "opening"}) · Knows: {b.heroKnows}
            </div>
          </li>
        ))}
      </ol>
      <p>
        <span className="font-medium">Ending ({plot.resolution.endingType}):</span> {plot.resolution.what}
      </p>
      {plot.deliberateMysteries.length ? <p className="text-xs text-muted-foreground">Left open on purpose: {plot.deliberateMysteries.join(" · ")}</p> : null}
      {parts.length > 1 ? (
        <ul className="space-y-1 text-xs">
          {parts.map((p) => (
            <li key={p.part} className={p.part === part ? "font-medium" : "text-muted-foreground"}>
              Part {p.part} (beats {p.beats.join(", ")}): answers {p.smallPayoff}
              {p.cliffhanger ? ` · ends on ${p.cliffhanger}` : ""}
            </li>
          ))}
        </ul>
      ) : null}
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

/** The record of every check on the current script: verdict, open issues, ratings, hooks, plot and revisions. */
export function ScriptChecks(props: {
  quality: QualityRecord | undefined;
  plot: Plot | undefined;
  process?: ProcessSpec;
  research?: ResearchRecord | null;
  versionId: string;
  episodeId: string;
  humanRating: number | null;
  busy: boolean;
  atGate: boolean;
}) {
  const { quality, plot, process, research, versionId, episodeId, busy, atGate } = props;
  if (!quality) {
    return (
      <Section title="Script checks">
        <p className="text-sm text-muted-foreground">This script was written before plot-logic and editorial checks were added. Regenerate it to have it planned and checked.</p>
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
  const openCount = serious.filter((i) => !dismissed.has(i.id)).length + quality.mustFix.length;
  const m = quality.metrics;
  const ratings = quality.editorial ? [...quality.editorial.narrative, ...quality.editorial.retention] : [];
  const hooks = quality.hooks;

  return (
    <Section
      title="Script checks"
      description={
        process
          ? "An independent fact-check of this script against the web research, plus clarity and tone. Read the sources for anything that matters."
          : "An independent logic audit and editorial review of this script. These are editorial judgements, not predictions of how it will perform."
      }
    >
      <div className="space-y-4">
        <div className={cn("flex flex-col gap-3 rounded-xl border p-4 text-sm sm:flex-row sm:items-center sm:justify-between", status.className)}>
          <div className="flex gap-2">
            <status.icon className="mt-0.5 size-4 shrink-0" />
            <div>
              <div className="font-medium">{status.label}</div>
              <p className="text-xs opacity-80">
                {quality.status === "blocked"
                  ? "A plot problem a viewer would notice. It can't be approved until it is fixed, or you dismiss the issue as wrong."
                  : quality.status === "needs-attention"
                    ? `${openCount} open item${openCount === 1 ? "" : "s"} survived the automatic revisions. Fix them, or approve with an override.`
                    : "No blocking or significant problems found."}
              </p>
              <p className="mt-1 text-xs opacity-70">
                Plot repaired {m.plotRepairs}× · script revised {m.scriptRevisions}× · {m.firstPass ? "passed first time" : "needed fixes"} · {fmtDuration(m.durationMs)} · ${m.textCostUsd.toFixed(2)} writing
                {quality.override ? ` · approved with ${quality.override.open} open item(s) by your override` : ""}
              </p>
            </div>
          </div>
          {openCount > 0 && (plot || process) && atGate ? (
            <div className="shrink-0">
              <EpisodeActionButton
                episodeId={episodeId}
                request={{ action: "revise-script" }}
                disabled={busy}
                label="Fix flagged issues"
                size="sm"
                continueProduction={false}
                confirm="Repairs the root cause of each open issue in the plot, rewrites only the affected lines, and checks the whole script again. Saved as a new version; nothing is spent on media."
              />
            </div>
          ) : null}
        </div>

        {serious.length || quality.mustFix.length ? (
          <div className="space-y-2">
            {serious.map((i) => (
              <IssueCard key={i.id} issue={i} dismissed={dismissed.has(i.id)} versionId={versionId} canDismiss={atGate && !busy} />
            ))}
            {quality.mustFix.map((n, k) => (
              <NoteCard key={k} note={n} />
            ))}
          </div>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-3">
          <span className="text-sm font-medium">Your rating of this story</span>
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

        {ratings.length ? (
          <details className="rounded-xl border bg-card p-3 text-sm">
            <summary className="cursor-pointer font-medium">Editorial ratings</summary>
            <div className="mt-3 grid gap-x-6 gap-y-3 sm:grid-cols-2">
              {ratings.map((r) => (
                <div key={r.criterion} className="text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{r.criterion.replaceAll("-", " ")}</span>
                    <span className={cn("rounded px-1.5 py-0.5 text-[11px] font-medium", RATING_CLASS[r.rating])}>{r.rating}</span>
                  </div>
                  <p className="mt-0.5 text-muted-foreground">{r.note}</p>
                </div>
              ))}
            </div>
            {quality.editorial?.suggestions.length ? (
              <div className="mt-3 border-t pt-3">
                <div className="text-xs font-medium text-muted-foreground">Optional suggestions</div>
                <ul className="mt-1 ml-4 list-disc space-y-1 text-xs">
                  {quality.editorial.suggestions.map((n, k) => (
                    <li key={k}>
                      {n.problem} <span className="text-muted-foreground">({n.fix})</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </details>
        ) : null}

        {hooks ? (
          <details className="rounded-xl border bg-card p-3 text-sm">
            <summary className="cursor-pointer font-medium">Hook development ({hooks.candidates.candidates.length} candidates)</summary>
            <p className="mt-2 text-xs text-muted-foreground">
              Question: {hooks.candidates.dramaticQuestion} · Strongest moment: {hooks.candidates.strongestMoment}
            </p>
            <ul className="mt-2 space-y-1.5">
              {hooks.candidates.candidates.map((c, i) => {
                const review = hooks.pick.reviews.find((r) => r.index === i);
                const chosen = i === hooks.pick.chosenIndex;
                return (
                  <li key={i} className={cn("rounded-lg border p-2", chosen ? "border-primary/40 bg-primary/5" : "bg-background")}>
                    <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                      <Badge variant="outline">{c.style}</Badge>
                      {chosen ? <Badge>chosen</Badge> : null}
                      {review ? `clarity ${review.clarity} · curiosity ${review.curiosity} · specific ${review.specificity}${review.deliveredByPlot ? "" : " · plot doesn't deliver"}` : null}
                    </div>
                    <p className="mt-1">{c.text}</p>
                  </li>
                );
              })}
            </ul>
            <p className="mt-2 text-xs">
              <span className="font-medium">Refined:</span> {hooks.pick.hook} <span className="text-muted-foreground">(promises: {hooks.pick.promise})</span>
            </p>
          </details>
        ) : null}

        {process ? <ProcessView process={process} research={research ?? null} part={quality.part ?? 1} /> : null}

        {plot ? (
          <details className="rounded-xl border bg-card p-3">
            <summary className="cursor-pointer text-sm font-medium">
              {(plot.parts?.length ?? 1) > 1 ? `Story plan (part ${quality.part ?? 1} of ${plot.parts.length}, ${plot.beats.length} beats in all)` : `Plot (${plot.beats.length} beats)`}
            </summary>
            <div className="mt-2">
              <PlotView plot={plot} part={quality.part ?? 1} />
            </div>
          </details>
        ) : null}

        <details className="rounded-xl border bg-card p-3 text-sm">
          <summary className="cursor-pointer font-medium">Check and revision history</summary>
          <ol className="mt-2 space-y-2 text-xs">
            {quality.plotRounds.map((r, i) => (
              <li key={`p${i}`}>
                <span className="font-medium">Plot audit {i + 1}:</span> {countLine(r.issues)}
                {r.changeLog.length ? <ChangeList items={r.changeLog} /> : null}
              </li>
            ))}
            {quality.scriptRounds.map((r, i) => (
              <li key={`s${i}`}>
                <span className="font-medium">Script check {i + 1}:</span> {countLine(r.issues)}, {r.mustFix.length} editor must-fix
                {r.unresolvedPrevious.length ? ` · still open from before: ${r.unresolvedPrevious.join(", ")}` : ""}
                {r.changeLog.length ? <ChangeList items={r.changeLog} /> : null}
              </li>
            ))}
          </ol>
          {quality.plotPick ? <p className="mt-2 text-xs text-muted-foreground">Plot chosen because: {quality.plotPick.reason}</p> : null}
          {quality.references.length ? <p className="mt-1 text-xs text-muted-foreground">Reference stories used: {quality.references.join(", ")}</p> : null}
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
