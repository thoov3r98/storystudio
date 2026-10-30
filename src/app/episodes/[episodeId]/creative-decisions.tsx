import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Section } from "@/components/studio";
import { EvidenceLevelBadge, ScoreBreakdown, TopicAngle, TopicScore } from "@/components/topic-evidence";
import type { getStorytelling } from "@/lib/queries";
import type { ProcessSpec, ResearchRecord } from "@/lib/schemas/process";
import { HOOK_CRITERIA, HOOK_CRITERIA_LABELS, PATTERN_KEYS, PATTERNS, researchClaims, type Pattern } from "@/lib/schemas/storytelling";
import type { DiscoverySnapshot } from "@/lib/schemas/topics";
import { cn } from "@/lib/utils";
import { EpisodeActionButton, PatternSwitcher } from "./episode-client";

type Storytelling = Awaited<ReturnType<typeof getStorytelling>>;
type Hook = Storytelling["hooks"][number];
type Review = Record<(typeof HOOK_CRITERIA)[number], number> & { supported: boolean; unsupportedDetail: string; note: string };

/** The research claims a hook cites, with their sources, so the producer can check it. */
function Claims({ ids, research }: { ids: string[]; research: ResearchRecord | null }) {
  if (!research || !ids.length) return null;
  const claims = researchClaims(research);
  const sources = new Map(research.sources.map((s) => [s.n, s]));
  return (
    <ul className="mt-1.5 space-y-1 text-xs text-muted-foreground">
      {ids.map((id) => {
        const c = claims.get(id);
        return (
          <li key={id}>
            <span className="font-medium text-foreground">{id}</span> {c ? c.text : "(not in the research)"}
            {c?.sources.map((n) => {
              const s = sources.get(n);
              return s ? (
                <a key={n} href={s.url} target="_blank" rel="noreferrer" className="ml-1 underline underline-offset-2">
                  [{n}]
                </a>
              ) : null;
            })}
          </li>
        );
      })}
    </ul>
  );
}

function HookCard({ hook, research, selected, writtenWith, episodeId, canChoose }: { hook: Hook; research: ResearchRecord | null; selected: boolean; writtenWith: boolean; episodeId: string; canChoose: boolean }) {
  const review = hook.review as Review | null;
  return (
    <div className={cn("rounded-xl border p-3 text-sm", selected ? "border-primary/50 bg-primary/5" : "bg-card", hook.flags.length && "border-amber-200")}>
      <div className="flex items-start justify-between gap-3">
        <p className="font-medium text-pretty">“{hook.line}”</p>
        {hook.total !== null ? (
          <span className="shrink-0 text-right text-xs text-muted-foreground" title="Editorial heuristic from an AI reviewer, not a predicted view count.">
            <span className="text-base font-semibold tabular-nums text-foreground">{Math.round(hook.total)}</span>/100
          </span>
        ) : null}
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs">
        <Badge variant="outline">{hook.strategy.replaceAll("-", " ")}</Badge>
        <Badge variant="outline">featured {hook.featuredStageId}</Badge>
        {selected ? (
          <Badge>
            <CheckCircle2 /> Selected
          </Badge>
        ) : null}
        {writtenWith && !selected ? <Badge variant="outline">this version opens with it</Badge> : null}
      </div>
      {hook.flags.length ? (
        <ul className="mt-2 space-y-0.5 text-xs text-amber-800">
          {hook.flags.map((f) => (
            <li key={f} className="flex gap-1">
              <AlertTriangle className="mt-0.5 size-3 shrink-0" /> {f}
            </li>
          ))}
        </ul>
      ) : null}
      <details className="mt-2 text-xs">
        <summary className="cursor-pointer text-muted-foreground hover:text-foreground">Evidence, review and first frame</summary>
        <Claims ids={hook.claimIds} research={research} />
        {review ? (
          <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-0.5 sm:grid-cols-4">
            {HOOK_CRITERIA.map((c) => (
              <span key={c} className="flex justify-between gap-2">
                <span className="text-muted-foreground">{HOOK_CRITERIA_LABELS[c]}</span>
                <span className="tabular-nums">{review[c]}/5</span>
              </span>
            ))}
          </div>
        ) : null}
        {review?.note ? <p className="mt-1 text-muted-foreground">Reviewer: {review.note}</p> : null}
        <p className="mt-1 text-muted-foreground">Why it might work: {hook.whyItWorks}</p>
        <p className="mt-1 text-muted-foreground">First frame: {hook.firstFrameVisual}</p>
        {hook.uncertainty ? <p className="mt-1 text-amber-800">Uncertain: {hook.uncertainty}</p> : null}
      </details>
      {canChoose && !selected ? (
        <div className="mt-2">
          <EpisodeActionButton
            episodeId={episodeId}
            request={{ action: "choose-hook", hookId: hook.id }}
            label="Use this opening"
            size="xs"
            variant="outline"
            continueProduction={false}
            confirm={`Rewrites Part 1 to open with “${hook.line}”, fact-checks it and stops for your review. The research, plan and other parts are unchanged; nothing is spent on media.`}
          />
        </div>
      ) : null}
    </div>
  );
}

/** How this story is told: pattern, featured stage, openings, and why the topic was chosen. */
export function CreativeDecisions(props: {
  storytelling: Storytelling;
  research: ResearchRecord | null;
  process?: ProcessSpec;
  discovery: DiscoverySnapshot | null;
  part: number;
  episodeId: string;
  busy: boolean;
  anyUnproduced: boolean;
}) {
  const { storytelling, research, process, discovery, part, episodeId, busy } = props;
  const d = storytelling.decision;
  if (!d && !discovery) return null;
  const pattern = d ? PATTERNS[d.pattern as Pattern] : null;
  const featured = d && research ? research.stages.find((s) => s.id === d.featuredStageId) : undefined;
  const hooks = d ? storytelling.hooks.filter((h) => h.pattern === d.pattern) : [];
  const writtenHookId = process?.creative?.hookId ?? null;
  const writtenPattern = process?.creative?.pattern;

  return (
    <Section title="How it's told" description="Creative choices made from the verified research. Hook scores are an AI editor's judgement, not predicted views.">
      <div className="space-y-4">
        {d && pattern ? (
          <div className="space-y-2 rounded-xl border bg-card p-4 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{pattern.label}</span>
                <Badge variant="outline">{d.patternSource === "producer" ? "your choice" : "recommended"}</Badge>
                {writtenPattern && writtenPattern !== d.pattern ? <Badge variant="outline">this version was written as {PATTERNS[writtenPattern as Pattern]?.label ?? writtenPattern}</Badge> : null}
              </div>
              {props.anyUnproduced ? <PatternSwitcher episodeId={episodeId} current={d.pattern} options={PATTERN_KEYS.map((k) => ({ value: k, label: PATTERNS[k].label }))} disabled={busy} /> : null}
            </div>
            <p className="text-muted-foreground">{d.reason}</p>
            <dl className="grid gap-1 text-xs">
              <div>
                <dt className="inline font-medium">Viewer&apos;s question: </dt>
                <dd className="inline text-muted-foreground">{d.curiosityMechanism}</dd>
              </div>
              <div>
                <dt className="inline font-medium">Featured stage: </dt>
                <dd className="inline text-muted-foreground">
                  {d.featuredStageId}
                  {featured ? ` ${featured.name}` : ""}
                  {process && !process.plan.parts.find((p) => p.part === part)?.stages.includes(d.featuredStageId) ? " (told in another part)" : ""}
                </dd>
              </div>
              <div>
                <dt className="inline font-medium">Visual payoff: </dt>
                <dd className="inline text-muted-foreground">{d.visualPayoff}</dd>
              </div>
              {d.alternatives.length ? (
                <div>
                  <dt className="inline font-medium">Could also work: </dt>
                  <dd className="inline text-muted-foreground">{d.alternatives.map((a) => PATTERNS[a as Pattern].label).join(", ")}</dd>
                </div>
              ) : null}
            </dl>
            <details className="text-xs">
              <summary className="cursor-pointer text-muted-foreground hover:text-foreground">Pattern structure</summary>
              <ol className="mt-1 ml-4 list-decimal space-y-0.5 text-muted-foreground">
                {pattern.structure.map((x) => (
                  <li key={x}>{x}</li>
                ))}
              </ol>
              <p className="mt-1 text-muted-foreground">The opening may preview a later step; the steps themselves are always told in factory order.</p>
            </details>
          </div>
        ) : null}

        {d && part === 1 ? (
          <div className="space-y-2">
            <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Openings ({hooks.length})</div>
            {hooks.length === 0 ? <p className="text-sm text-muted-foreground">No openings were written for this pattern.</p> : null}
            {!d.selectedHookId && hooks.length ? <p className="text-sm text-amber-800">No opening passed every check, so Part 1 opens plainly. You can still pick one below.</p> : null}
            {[...hooks]
              .sort((a, b) => (a.id === d.selectedHookId ? -1 : b.id === d.selectedHookId ? 1 : (a.rank ?? 99) - (b.rank ?? 99)))
              .map((h) => (
                <HookCard key={h.id} hook={h} research={research} selected={h.id === d.selectedHookId} writtenWith={h.id === writtenHookId} episodeId={episodeId} canChoose={!busy} />
              ))}
          </div>
        ) : d && part !== 1 ? (
          <p className="text-xs text-muted-foreground">The opening hook belongs to Part 1; this part continues the same story.</p>
        ) : null}

        {discovery ? (
          <details className="rounded-xl border bg-card p-3 text-sm">
            <summary className="cursor-pointer font-medium">Why this topic was chosen</summary>
            <div className="mt-2 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <EvidenceLevelBadge level={discovery.evidenceLevel} />
                <TopicScore score={discovery.score} />
              </div>
              <TopicAngle d={discovery} />
              <ScoreBreakdown breakdown={discovery.breakdown} />
            </div>
          </details>
        ) : null}
      </div>
    </Section>
  );
}
