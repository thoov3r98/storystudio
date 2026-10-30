import { Suspense } from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { ExternalLink } from "lucide-react";
import { EmptyState, JobStatusBadge, PageHeader, PageSkeleton, Section, relativeTime } from "@/components/studio";
import { AutoRefresh } from "@/components/client-helpers";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { EvidenceLevelBadge, EvidenceList, ScoreBreakdown, StrategyBadge, TopicAngle, TopicScore } from "@/components/topic-evidence";
import { getTopicResearch } from "@/lib/queries";
import { ACTIVE_JOB_STATUSES } from "@/lib/constants";
import { PLATFORMS, type DiscoverySnapshot } from "@/lib/schemas/topics";
import { traction, type TractionTier } from "@/lib/topics/scoring";
import { cn } from "@/lib/utils";
import { DiscoverButton, MetricDialog, ReferenceActions, ReferenceDialog, StarterButton, TopicActions } from "./topics-client";

export const metadata: Metadata = { title: "Topic Research" };

const TIERS: { value: TractionTier | "all"; label: string }[] = [
  { value: "all", label: "Any traction" },
  { value: "strong", label: "Strong" },
  { value: "moderate", label: "Moderate" },
  { value: "limited", label: "Limited" },
  { value: "unknown", label: "No numbers" },
];

const VERIFICATION = {
  SOURCE_CONFIRMED: { label: "Source confirmed", className: "border-emerald-200 bg-emerald-50 text-emerald-800" },
  USER_ENTERED: { label: "Entered by hand", className: "" },
  NEEDS_SOURCE: { label: "Needs source URL", className: "border-amber-200 bg-amber-50 text-amber-800" },
} as const;

export default function TopicsPage(props: PageProps<"/topics">) {
  return (
    <>
      <PageHeader
        title="Topic research"
        description="Manufacturing videos that audiences already watched, and products for our channel proposed from them. Audience numbers are dated observations; scores are editorial estimates, not predictions."
      />
      <Suspense fallback={<PageSkeleton />}>
        <TopicsContent searchParams={props.searchParams} />
      </Suspense>
    </>
  );
}

const fmt = (n: number | null) => (n === null ? "—" : n.toLocaleString());
const day = (d: Date) => d.toISOString().slice(0, 10);

async function TopicsContent({ searchParams }: { searchParams: PageProps<"/topics">["searchParams"] }) {
  const sp = await searchParams;
  const str = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const filters = { platform: str("platform"), category: str("category"), q: str("q"), traction: str("traction") };
  const data = await getTopicResearch(filters);
  const refs = data.references
    .map((r) => ({ r, t: traction({ platform: r.platform, publishedAt: r.publishedAt, metrics: r.metrics }) }))
    .filter(({ t }) => !filters.traction || filters.traction === "all" || t.tier === filters.traction);
  const job = data.activeJob;
  const running = Boolean(job && ACTIVE_JOB_STATUSES.includes(job.status));
  const proposed = data.candidates.filter((c) => c.status !== "DUPLICATE");
  const duplicates = data.candidates.filter((c) => c.status === "DUPLICATE");

  return (
    <div className="space-y-10">
      <AutoRefresh active={running} />
      <Section
        title={`Reference library (${data.total})`}
        description="Successful manufacturing videos by others. We learn what makes people curious; we never copy or reuse them."
        actions={
          <div className="flex flex-wrap gap-2">
            {data.total < 5 ? <StarterButton /> : null}
            <ReferenceDialog />
          </div>
        }
      >
        <form method="get" className="flex flex-wrap items-end gap-2 rounded-xl border bg-card p-3 text-sm">
          <label className="grid gap-1 text-xs text-muted-foreground">
            Product or title
            <input name="q" defaultValue={filters.q ?? ""} placeholder="Search" className="h-8 rounded-md border bg-background px-2 text-sm text-foreground" />
          </label>
          <FilterSelect name="platform" label="Platform" value={filters.platform} options={[["all", "All platforms"], ...PLATFORMS.map((p) => [p, p] as [string, string])]} />
          <FilterSelect name="category" label="Category" value={filters.category} options={[["all", "All categories"], ...data.categories.map((c) => [c, c] as [string, string])]} />
          <FilterSelect name="traction" label="Audience traction" value={filters.traction} options={TIERS.map((t) => [t.value, t.label])} />
          <button type="submit" className="h-8 rounded-md border px-3 text-sm font-medium hover:bg-muted">
            Filter
          </button>
          {Object.values(filters).some(Boolean) ? (
            <Link href="/topics" className="h-8 px-2 text-sm leading-8 text-muted-foreground hover:text-foreground">
              Clear
            </Link>
          ) : null}
        </form>

        {data.total === 0 ? (
          <EmptyState title="No references yet" description="Add a successful manufacturing video by URL, or start from the curated starter set. Surprise me uses the plain pitch writer until the library has entries." />
        ) : refs.length === 0 ? (
          <p className="text-sm text-muted-foreground">No references match these filters.</p>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {refs.map(({ r, t }) => {
              const v = VERIFICATION[r.verification];
              return (
                <div key={r.id} className="space-y-2 rounded-xl border bg-card p-4 text-sm">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-medium text-balance">
                        {r.url ? (
                          <a href={r.url} target="_blank" rel="noreferrer" className="hover:underline">
                            {r.title} <ExternalLink className="inline size-3" />
                          </a>
                        ) : (
                          r.title
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {r.creator} · {r.platform}
                        {r.publishedAt ? ` · published ${day(r.publishedAt)}` : ""}
                        {r.durationSec ? ` · ${Math.floor(r.durationSec / 60)}:${String(r.durationSec % 60).padStart(2, "0")}` : ""}
                      </div>
                    </div>
                    <ReferenceActions
                      reference={{
                        id: r.id,
                        platform: r.platform,
                        creator: r.creator,
                        url: r.url,
                        title: r.title,
                        product: r.product,
                        category: r.category,
                        publishedAt: r.publishedAt ? day(r.publishedAt) : "",
                        durationSec: r.durationSec,
                        notableStep: r.notableStep,
                        curiosityMechanism: r.curiosityMechanism,
                        observedHook: r.observedHook,
                        transformationType: r.transformationType,
                        notes: r.notes,
                        usageRights: r.usageRights,
                      }}
                    />
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <Badge variant="secondary">{r.product}</Badge>
                    <Badge variant="outline">{r.category}</Badge>
                    {r.transformationType ? <Badge variant="outline">{r.transformationType}</Badge> : null}
                    <Badge variant="outline" className={v.className}>
                      {v.label}
                    </Badge>
                  </div>
                  {r.notableStep || r.curiosityMechanism ? (
                    <p className="text-xs text-muted-foreground">
                      {r.notableStep}
                      {r.notableStep && r.curiosityMechanism ? " · " : ""}
                      {r.curiosityMechanism}
                    </p>
                  ) : null}
                  {r.observedHook ? <p className="text-xs italic text-muted-foreground">Opening as observed: “{r.observedHook}”</p> : null}
                  <div className="rounded-lg bg-muted/50 p-2 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <span className={cn("font-medium", t.tier === "unknown" && "text-muted-foreground")}>{t.tier === "unknown" ? "No audience numbers recorded" : `${t.tier[0].toUpperCase()}${t.tier.slice(1)} traction`}</span>
                      <MetricDialog referenceId={r.id} title={r.title} />
                    </div>
                    {t.tier !== "unknown" ? <p className="mt-0.5 text-muted-foreground">{t.explanation}</p> : null}
                    {r.metrics.length ? (
                      <details className="mt-1">
                        <summary className="cursor-pointer text-muted-foreground">Observations ({r.metrics.length})</summary>
                        <ul className="mt-1 space-y-0.5 tabular-nums">
                          {r.metrics.map((m) => (
                            <li key={m.id}>
                              {day(m.observedAt)} · {fmt(m.views)} views · {fmt(m.likes)} likes · {fmt(m.comments)} comments · {fmt(m.shares)} shares ·{" "}
                              {m.source === "YOUTUBE_API" ? "verified (YouTube API)" : "entered by hand"}
                              {m.note ? ` · ${m.note}` : ""}
                            </li>
                          ))}
                        </ul>
                      </details>
                    ) : null}
                  </div>
                  {r.notes ? <p className="text-xs text-muted-foreground">{r.notes}</p> : null}
                  <p className="text-[11px] text-muted-foreground">Rights: {r.usageRights}</p>
                </div>
              );
            })}
          </div>
        )}
      </Section>

      <Section
        title="Topic opportunities"
        description="Products proposed from the library and scored. Approve the ones worth making; Make this video starts the normal research, script and approval flow."
        actions={<DiscoverButton channels={data.channels} disabled={running || data.total === 0} />}
      >
        {job && job.status !== "COMPLETED" ? (
          <div className="rounded-xl border bg-card p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <JobStatusBadge status={job.status} />
                <span className="text-sm text-muted-foreground">{job.stage}</span>
              </div>
              <span className="text-sm tabular-nums text-muted-foreground">{Math.round(job.progress * 100)}%</span>
            </div>
            <Progress value={job.progress * 100} className="mt-3" />
            {job.status === "FAILED" ? <p className="mt-3 text-sm text-destructive">{(job.error as { message?: string } | null)?.message ?? "Discovery failed."} Retry it from Generation Jobs.</p> : null}
          </div>
        ) : null}
        {proposed.length === 0 ? (
          <EmptyState title="No proposals yet" description={data.total === 0 ? "Add references first." : "Generate topics to get scored product ideas from the library."} />
        ) : (
          <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
            {proposed.map((c) => {
              const evidence: DiscoverySnapshot["evidence"] = c.evidence.map((e) => ({
                referenceId: e.referenceId,
                title: e.reference.title,
                platform: e.reference.platform,
                creator: e.reference.creator,
                url: e.reference.url,
                relation: e.relation,
                traction: traction({ platform: e.reference.platform, publishedAt: e.reference.publishedAt, metrics: e.reference.metrics }).explanation,
              }));
              const storyId = c.concept?.story?.id ?? null;
              return (
                <div key={c.id} className={cn("space-y-3 rounded-xl border bg-card p-4 text-sm", c.status === "REJECTED" && "opacity-60", c.status === "APPROVED" && "border-primary/40")}>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="font-medium text-balance">{c.title}</div>
                      <div className="text-xs text-muted-foreground">
                        {c.category} · proposed {relativeTime(c.createdAt)}
                        {c.status !== "PROPOSED" ? ` · ${c.status.toLowerCase()}` : ""}
                      </div>
                    </div>
                    <TopicScore score={c.score} />
                  </div>
                  <p className="text-pretty">{c.episodeConcept}</p>
                  <div className="flex flex-wrap gap-1.5">
                    <StrategyBadge strategy={c.strategy} />
                    <EvidenceLevelBadge level={c.evidenceLevel} />
                  </div>
                  <EvidenceList evidence={evidence} />
                  <TopicAngle d={c} />
                  <p className="text-xs text-muted-foreground">
                    Research: {c.researchFeasibility} Visuals: {c.visualFeasibility}
                  </p>
                  <ScoreBreakdown breakdown={(c.scoreBreakdown as DiscoverySnapshot["breakdown"] | null) ?? []} />
                  <TopicActions id={c.id} title={c.title} status={c.status} storyId={storyId} />
                </div>
              );
            })}
          </div>
        )}
        {duplicates.length ? (
          <details className="text-sm text-muted-foreground">
            <summary className="cursor-pointer">{duplicates.length} proposal(s) dropped as repeats</summary>
            <ul className="mt-2 ml-4 list-disc space-y-0.5 text-xs">
              {duplicates.map((d) => (
                <li key={d.id}>
                  {d.product}: close to {d.duplicateOf}
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </Section>
    </div>
  );
}

function FilterSelect({ name, label, value, options }: { name: string; label: string; value?: string; options: [string, string][] }) {
  return (
    <label className="grid gap-1 text-xs text-muted-foreground">
      {label}
      <select name={name} defaultValue={value ?? "all"} className="h-8 rounded-md border bg-background px-2 text-sm text-foreground">
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </label>
  );
}
