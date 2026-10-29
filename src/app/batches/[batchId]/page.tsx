import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { JobStatusBadge, Money, PageHeader, PageSkeleton } from "@/components/studio";
import { AutoRefresh } from "@/components/client-helpers";
import { Progress } from "@/components/ui/progress";
import { getBatch } from "@/lib/queries";
import { ACTIVE_JOB_STATUSES } from "@/lib/constants";
import { PitchBoard } from "./concept-board";

export const metadata: Metadata = { title: "Pitches" };

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

  return (
    <>
      <AutoRefresh active={active} />
      <PageHeader
        eyebrow={
          batch.channel ? (
            <Link href={`/channels/${batch.channel.id}`} className="hover:underline">
              {batch.channel.name}
            </Link>
          ) : (
            "Before channels"
          )
        }
        title={batch.customDirection ? `“${batch.customDirection}”` : "Surprise me"}
        description={
          <>
            {batch.createdAt.toLocaleString()} · spent <Money value={spentUsd} />
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
            <p className="mt-3 text-sm text-destructive">{(ideationJob.error as { message?: string } | null)?.message ?? "Pitching failed."} Retry it from Generation Jobs.</p>
          ) : null}
        </div>
      ) : null}

      <PitchBoard
        canWrite={Boolean(batch.channel)}
        concepts={batch.concepts.map((c) => ({
          id: c.id,
          title: c.title,
          premise: c.premise,
          logline: c.logline,
          arc: c.seriesPotential,
          status: c.status,
          rank: c.rank,
          reason: (c.scores as { summary?: string } | null)?.summary ?? null,
          duplicateOfTitle: c.duplicateOfTitle,
          storyId: c.story?.id ?? null,
        }))}
      />
    </>
  );
}
