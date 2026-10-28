import { Suspense } from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { Progress } from "@/components/ui/progress";
import { EmptyState, JobStatusBadge, Money, PageHeader, PageSkeleton } from "@/components/studio";
import { AutoRefresh } from "@/components/client-helpers";
import { listJobs } from "@/lib/queries";
import { reconcileStaleJobs } from "@/lib/enqueue";
import { ACTIVE_JOB_STATUSES } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { JobControls } from "./job-controls";

export const metadata: Metadata = { title: "Generation Jobs" };

const TABS = [
  { value: "all", label: "All" },
  { value: "active", label: "Active" },
  { value: "failed", label: "Failed" },
];

export default function JobsPage(props: PageProps<"/jobs">) {
  return (
    <>
      <PageHeader title="Generation Jobs" description="Every background job, its current stage and what it has spent. State is stored in the database and survives reloads." />
      <Suspense fallback={<PageSkeleton />}>
        <JobsContent searchParams={props.searchParams} />
      </Suspense>
    </>
  );
}

function duration(start: Date | null, end: Date | null) {
  if (!start) return "—";
  const s = Math.round(((end ?? new Date()).getTime() - start.getTime()) / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

async function JobsContent({ searchParams }: { searchParams: PageProps<"/jobs">["searchParams"] }) {
  const sp = await searchParams;
  const status = typeof sp.status === "string" ? sp.status : "all";
  await reconcileStaleJobs();
  const jobs = await listJobs({ status });
  const anyActive = jobs.some((j) => ACTIVE_JOB_STATUSES.includes(j.status));

  return (
    <div className="space-y-5">
      <AutoRefresh active={anyActive} intervalMs={3000} />
      <nav className="flex gap-1">
        {TABS.map((t) => (
          <Link
            key={t.value}
            href={t.value === "all" ? "/jobs" : `/jobs?status=${t.value}`}
            className={cn(
              "rounded-full border px-3 py-1 text-sm",
              status === t.value ? "border-primary bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
          </Link>
        ))}
      </nav>
      {jobs.length === 0 ? (
        <EmptyState title="No jobs" description="Jobs appear here when you generate concepts or produce episodes." />
      ) : (
        <div className="space-y-2">
          {jobs.map((j) => {
            const err = j.error as { message?: string; name?: string; failedScenes?: { sceneNumber: number; error: string }[]; conflicts?: string[] } | null;
            const target = j.episode
              ? { href: `/episodes/${j.episode.id}`, label: `${j.story?.title ?? "Episode"} · Part ${j.episode.partNumber}` }
              : j.batch
                ? { href: `/batches/${j.batch.id}`, label: `Batch of ${j.batch.requestedCount} (${j.batch.mode === "CONCEPT" ? "concepts" : "production"})` }
                : j.story
                  ? { href: `/stories/${j.story.id}`, label: j.story.title }
                  : null;
            const active = ACTIVE_JOB_STATUSES.includes(j.status);
            return (
              <div key={j.id} className="rounded-xl border bg-card p-4">
                <div className="flex flex-col gap-3 md:flex-row md:items-center">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <JobStatusBadge status={j.status} />
                      <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{j.type.replaceAll("_", " ").toLowerCase()}</span>
                      {j.attempts > 1 ? <span className="text-xs text-muted-foreground">attempt {j.attempts}</span> : null}
                    </div>
                    {target ? (
                      <Link href={target.href} className="mt-1 block truncate font-medium hover:underline">
                        {target.label}
                      </Link>
                    ) : null}
                    <div className="mt-1 text-xs text-muted-foreground">
                      {j.stage ?? "Waiting to start"} · started {j.startedAt?.toLocaleString() ?? "—"}
                      {j.completedAt ? ` · finished ${j.completedAt.toLocaleString()}` : ""} · {duration(j.startedAt, j.completedAt)}
                    </div>
                  </div>
                  <div className="flex items-center gap-4 md:w-auto">
                    <div className="w-36">
                      <Progress value={j.progress * 100} />
                      <div className="mt-1 text-right text-xs tabular-nums text-muted-foreground">{Math.round(j.progress * 100)}%</div>
                    </div>
                    <div className="w-20 text-right text-sm">
                      <Money value={j.costUsd} />
                    </div>
                    <JobControls jobId={j.id} canCancel={active} canRetry={j.status === "FAILED" || j.status === "CANCELED"} />
                  </div>
                </div>
                {j.status === "FAILED" && err ? (
                  <div className="mt-3 rounded-lg bg-red-50 p-3 text-xs text-red-800">
                    <div className="font-medium">{err.name ?? "Error"}</div>
                    <div className="mt-0.5 whitespace-pre-wrap">{err.message}</div>
                    {err.failedScenes?.length ? (
                      <ul className="mt-1 ml-4 list-disc">
                        {err.failedScenes.map((f) => (
                          <li key={f.sceneNumber}>
                            Scene {f.sceneNumber}: {f.error}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    {err.conflicts?.length ? (
                      <ul className="mt-1 ml-4 list-disc">
                        {err.conflicts.map((c, i) => (
                          <li key={i}>{c}</li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
