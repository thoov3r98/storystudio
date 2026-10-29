import { Suspense } from "react";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { JobStatusBadge, Money, PageHeader, PageSkeleton } from "@/components/studio";
import { AutoRefresh } from "@/components/client-helpers";
import { Progress } from "@/components/ui/progress";
import { getBatch } from "@/lib/queries";
import { ACTIVE_JOB_STATUSES, categoryLabel, QUALITY_PRESETS } from "@/lib/constants";
import { estimateEpisodeCost } from "@/lib/costs/estimate";
import { getDefaults, getPricing, getModels } from "@/lib/settings";
import { ConceptBoard } from "./concept-board";

export const metadata: Metadata = { title: "Batch" };

export default function BatchPage(props: PageProps<"/batches/[batchId]">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <BatchContent params={props.params} />
    </Suspense>
  );
}

async function BatchContent({ params }: { params: PageProps<"/batches/[batchId]">["params"] }) {
  const { batchId } = await params;
  const data = await getBatch(batchId);
  if (!data) notFound();
  const { batch, spentUsd } = data;
  const ideationJob = batch.jobs.find((j) => j.type === "BATCH_IDEATION");
  const active = batch.jobs.some((j) => ACTIVE_JOB_STATUSES.includes(j.status));
  // Only scripts are written from here; media is made per episode once its script is approved.
  const perEpisode = estimateEpisodeCost(await getPricing(), await getModels(), { durationSec: batch.targetDurationSec, quality: batch.quality, parts: (await getDefaults()).partsPerStory }).text;

  return (
    <>
      <AutoRefresh active={active} />
      <PageHeader
        eyebrow={`${batch.mode === "CONCEPT" ? "Concept batch" : "Production batch"} · ${batch.createdAt.toLocaleString()}`}
        title={`${batch.requestedCount} × ${categoryLabel(batch.category)}`}
        description={
          <>
            {batch.targetDurationSec}s · {QUALITY_PRESETS[batch.quality].label} quality · budget ${Number(batch.maxBudgetUsd).toFixed(2)} · spent <Money value={spentUsd} />
            {batch.customDirection ? <span className="mt-1 block italic">“{batch.customDirection}”</span> : null}
          </>
        }
      />
      {ideationJob && ideationJob.status !== "COMPLETED" ? (
        <div className="mb-8 rounded-xl border bg-card p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <JobStatusBadge status={ideationJob.status} />
              <span className="text-sm text-muted-foreground">{ideationJob.stage}</span>
            </div>
            <span className="text-sm tabular-nums text-muted-foreground">{Math.round(ideationJob.progress * 100)}%</span>
          </div>
          <Progress value={ideationJob.progress * 100} className="mt-3" />
          {ideationJob.status === "FAILED" ? (
            <p className="mt-3 text-sm text-destructive">{(ideationJob.error as { message?: string } | null)?.message ?? "Ideation failed."} Retry it from Generation Jobs.</p>
          ) : null}
        </div>
      ) : null}

      <ConceptBoard
        batchId={batch.id}
        perEpisodeEstimate={perEpisode}
        concepts={batch.concepts.map((c) => ({
          id: c.id,
          title: c.title,
          premise: c.premise,
          logline: c.logline,
          factMode: c.factMode,
          seriesPotential: c.seriesPotential,
          status: c.status,
          rank: c.rank,
          totalScore: c.totalScore,
          scores: c.scores as Record<string, { score: number; rationale: string }> & { summary?: string } | null,
          duplicateOfTitle: c.duplicateOfTitle,
          similarity: c.similarity,
          storyId: c.story?.id ?? null,
          episodeId: c.story?.episodes[0]?.id ?? null,
          episodeStatus: c.story?.episodes[0]?.status ?? null,
        }))}
      />
    </>
  );
}
