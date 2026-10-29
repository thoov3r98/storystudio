import { Suspense } from "react";
import { connection } from "next/server";
import Link from "next/link";
import type { Metadata } from "next";
import { CheckCircle2, ShieldAlert, Sparkles, Star } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState, PageHeader, PageSkeleton, Section, StatCard, relativeTime } from "@/components/studio";
import { db } from "@/lib/db";
import type { EpisodeSpecRecord } from "@/lib/schemas/episode";
import { groupOutcomes, type ScriptRow, summarize } from "@/lib/story/metrics";

export const metadata: Metadata = { title: "Story Quality" };

export default function QualityPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <QualityContent />
    </Suspense>
  );
}

const fmt = (n: number | null, digits = 1, suffix = "") => (n == null ? "—" : `${n.toFixed(digits)}${suffix}`);

const VERDICT: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  passed: { label: "passed", variant: "secondary" },
  "needs-attention": { label: "needs attention", variant: "outline" },
  blocked: { label: "blocked", variant: "destructive" },
};

async function QualityContent() {
  await connection();
  const versions = await db.episodeVersion.findMany({
    where: { qualityStatus: { not: null } },
    orderBy: { createdAt: "desc" },
    take: 300,
    select: {
      id: true,
      status: true,
      createdAt: true,
      voiceoverId: true,
      humanRating: true,
      qualityStatus: true,
      spec: true,
      episode: { select: { id: true, title: true, partNumber: true, status: true, currentVersionId: true, story: { select: { title: true } }, metrics: { orderBy: { recordedAt: "desc" }, take: 1 } } },
      _count: { select: { renders: true } },
    },
  });

  const rows = versions.flatMap((v) => {
    const spec = v.spec as EpisodeSpecRecord;
    if (!spec.quality) return [];
    const approved = Boolean(v.voiceoverId || v._count.renders || spec.quality.override);
    const m = v.episode.metrics[0];
    const hooks = spec.quality.hooks;
    const row: ScriptRow = {
      quality: spec.quality,
      archetype: spec.plot?.archetype ?? null,
      approved,
      rejected: !approved && v.status === "SUPERSEDED",
      humanRating: v.humanRating,
      hookStyle: hooks ? (hooks.candidates.candidates[hooks.pick.chosenIndex]?.style ?? null) : null,
      performance: m && v.episode.currentVersionId === v.id ? { views: m.views, completionRate: m.completionRate, earlyRetention: m.earlyRetention, rewatchRate: m.rewatchRate } : null,
    };
    return [{ v, row }];
  });

  const s = summarize(rows.map((r) => r.row));
  const byArchetype = groupOutcomes(
    rows.map((r) => r.row),
    (r) => r.archetype,
  );
  const byHook = groupOutcomes(
    rows.map((r) => r.row),
    (r) => r.hookStyle,
  );

  return (
    <>
      <PageHeader
        title="Story Quality"
        description="How the script checks are doing, and what you decided. AI ratings are editorial judgements; only your decisions and platform numbers are outcomes."
        actions={
          <Button asChild variant="outline">
            <Link href="/quality/references">Reference stories</Link>
          </Button>
        }
      />

      {rows.length === 0 ? (
        <EmptyState title="No checked scripts yet" description="Scripts written from now on are planned, audited and edited. Their results appear here." />
      ) : (
        <div className="space-y-10">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Scripts checked" value={s.scripts} icon={Sparkles} hint={`${s.verdicts.passed} passed · ${s.verdicts.needsAttention} need attention · ${s.verdicts.blocked} blocked`} />
            <StatCard label="Passed first review" value={fmt(s.firstPassPct, 0, "%")} icon={CheckCircle2} tone="success" hint={`Avg ${fmt(s.avgRevisionCycles)} repair/revision cycles`} />
            <StatCard
              label="Logic issues found per script"
              value={`${fmt(s.blockingPerScript)} / ${fmt(s.significantPerScript)}`}
              icon={ShieldAlert}
              tone="warning"
              hint="blocking / significant, before fixes"
            />
            <StatCard label="Your approval rate" value={fmt(s.approvalPct, 0, "%")} icon={Star} hint={`${s.approved} approved · ${s.rejected} replaced · rating ${fmt(s.avgHumanRating)} (${s.rated} rated)`} />
          </div>
          <div className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <Fact label="Dismissed by you as wrong" value={`${s.dismissed} (${fmt(s.falsePositivePct, 0, "%")} of open issues)`} />
            <Fact label="Approved with an override" value={String(s.overrides)} />
            <Fact label="Hooks rated strong for curiosity" value={fmt(s.strongHookPct, 0, "%")} />
            <Fact label="Avg writing time · cost" value={`${fmt((s.avgDurationSec ?? 0) / 60)} min · $${fmt(s.avgCostUsd, 2)}`} />
          </div>

          <Section title="By story type" description="Enter TikTok numbers on an episode (story page → Enter metrics) to compare. A handful of videos is not a trend.">
            <OutcomeTable groups={byArchetype} />
          </Section>
          <Section title="By hook style">
            <OutcomeTable groups={byHook} />
          </Section>

          <Section title="Recent scripts">
            <div className="overflow-x-auto rounded-xl border bg-card">
              <table className="w-full text-sm">
                <thead className="border-b text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="p-3 font-medium">Script</th>
                    <th className="p-3 font-medium">Verdict</th>
                    <th className="p-3 font-medium">Found (b/s)</th>
                    <th className="p-3 font-medium">Fixes</th>
                    <th className="p-3 font-medium">You</th>
                    <th className="p-3 font-medium">Cost · time</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {rows.slice(0, 50).map(({ v, row }) => (
                    <tr key={v.id}>
                      <td className="p-3">
                        <Link href={`/episodes/${v.episode.id}`} className="font-medium hover:underline">
                          {v.episode.story.title}
                        </Link>
                        <div className="text-xs text-muted-foreground">
                          Part {v.episode.partNumber} · {row.archetype ?? "—"} · {relativeTime(v.createdAt)}
                        </div>
                      </td>
                      <td className="p-3">
                        <Badge variant={VERDICT[row.quality.status].variant}>{VERDICT[row.quality.status].label}</Badge>
                      </td>
                      <td className="p-3 tabular-nums">
                        {row.quality.metrics.blockingFound}/{row.quality.metrics.significantFound}
                      </td>
                      <td className="p-3 tabular-nums">{row.quality.metrics.plotRepairs + row.quality.metrics.scriptRevisions}</td>
                      <td className="p-3 text-xs">
                        {row.approved ? "approved" : row.rejected ? "replaced" : "—"}
                        {row.humanRating ? ` · ${row.humanRating}★` : ""}
                      </td>
                      <td className="p-3 text-xs tabular-nums">
                        ${row.quality.metrics.textCostUsd.toFixed(2)} · {Math.round(row.quality.metrics.durationMs / 1000)}s
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>

          <Section title="Benchmark" description="Measure changes to prompts or models against a fixed set of stories.">
            <div className="rounded-xl border bg-card p-4 text-sm">
              <p>
                <code className="rounded bg-muted px-1">pnpm story-eval audit</code> runs the logic auditor on the fixed benchmark (stories with seeded holes and clean ones) and reports what it caught and what it wrongly flagged.
              </p>
              <p className="mt-2">
                <code className="rounded bg-muted px-1">pnpm story-eval generate</code> writes scripts for fixed premises with the real pipeline and saves them for side-by-side reading. Both use real models and cost money; results go to{" "}
                <code className="rounded bg-muted px-1">evals/results/</code>.
              </p>
            </div>
          </Section>
        </div>
      )}
    </>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border bg-card p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-0.5 font-medium tabular-nums">{value}</div>
    </div>
  );
}

function OutcomeTable({ groups }: { groups: ReturnType<typeof groupOutcomes> }) {
  return (
    <div className="overflow-x-auto rounded-xl border bg-card">
      <table className="w-full text-sm">
        <thead className="border-b text-left text-xs text-muted-foreground">
          <tr>
            <th className="p-3 font-medium">Type</th>
            <th className="p-3 font-medium">Scripts</th>
            <th className="p-3 font-medium">Approved</th>
            <th className="p-3 font-medium">Your rating</th>
            <th className="p-3 font-medium">Published</th>
            <th className="p-3 font-medium">Avg views</th>
            <th className="p-3 font-medium">3s retention</th>
            <th className="p-3 font-medium">Completion</th>
            <th className="p-3 font-medium">Rewatch</th>
          </tr>
        </thead>
        <tbody className="divide-y tabular-nums">
          {groups.map((g) => (
            <tr key={g.name}>
              <td className="p-3 font-medium">{g.name}</td>
              <td className="p-3">{g.scripts}</td>
              <td className="p-3">{fmt(g.approvalPct, 0, "%")}</td>
              <td className="p-3">{fmt(g.avgRating)}</td>
              <td className="p-3">{g.published}</td>
              <td className="p-3">{g.avgViews == null ? "—" : Math.round(g.avgViews).toLocaleString()}</td>
              <td className="p-3">{fmt(g.avgEarlyRetention, 0, "%")}</td>
              <td className="p-3">{fmt(g.avgCompletion, 0, "%")}</td>
              <td className="p-3">{fmt(g.avgRewatch, 0, "%")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
