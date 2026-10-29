import { runs, tasks } from "@trigger.dev/sdk";
import { db } from "@/lib/db";
import { MissingConfigError, env } from "@/lib/env";
import { ACTIVE_JOB_STATUSES } from "@/lib/constants";
import { failJob } from "@/lib/jobs";
import { refreshStoryStatus } from "@/lib/pipeline/versions";
import type { JobType } from "@/generated/prisma/enums";
import type { EpisodeJobPayload } from "@/lib/pipeline/produce";
import type { episodeJobTask, ideateBatchTask } from "@/trigger/tasks";

/*
 * Server-side job submission. A Job row is created first so the UI shows the
 * job immediately and the state survives reloads; the Trigger.dev run id is
 * attached once the run is queued.
 */

function assertTriggerConfigured() {
  if (!env().TRIGGER_SECRET_KEY) throw new MissingConfigError("TRIGGER_SECRET_KEY", "running background jobs");
}

async function markSubmitFailed(jobId: string, err: unknown) {
  await db.job.update({
    where: { id: jobId },
    data: { status: "FAILED", completedAt: new Date(), error: { name: "SubmitError", message: err instanceof Error ? err.message : String(err) } },
  });
}

export async function enqueueIdeation(batchId: string) {
  const job = await db.job.create({ data: { type: "BATCH_IDEATION", batchId, input: { batchId } } });
  try {
    assertTriggerConfigured();
    const handle = await tasks.trigger<typeof ideateBatchTask>("ideate-batch", { jobId: job.id, batchId }, { tags: [`batch:${batchId}`] });
    await db.job.update({ where: { id: job.id }, data: { triggerRunId: handle.id } });
  } catch (err) {
    await markSubmitFailed(job.id, err);
    throw err;
  }
  return job.id;
}

const ACTION_JOB_TYPE: Record<EpisodeJobPayload["request"]["action"], JobType> = {
  produce: "EPISODE_PRODUCTION",
  "regenerate-script": "REGENERATE_SCRIPT",
  "revise-script": "REGENERATE_SCRIPT",
  "rewrite-scene": "REGENERATE_SCENE_NARRATION",
  "regenerate-image": "REGENERATE_IMAGE",
  "regenerate-voiceover": "REGENERATE_VOICEOVER",
  render: "RENDER",
};

export async function enqueueEpisodeJob(input: Omit<EpisodeJobPayload, "jobId"> & { type?: JobType }) {
  const episode = await db.episode.findUniqueOrThrow({ where: { id: input.episodeId }, select: { storyId: true } });
  const active = await db.job.findFirst({
    where: { episodeId: input.episodeId, status: { notIn: ["COMPLETED", "FAILED", "CANCELED"] } },
    select: { id: true },
  });
  if (active) throw new Error("This episode already has a job in progress. Wait for it to finish or cancel it first.");

  const { type, ...rest } = input;
  const job = await db.job.create({
    data: {
      type: type ?? ACTION_JOB_TYPE[input.request.action],
      episodeId: input.episodeId,
      storyId: episode.storyId,
      batchId: input.batchId ?? null,
      input: rest as object,
    },
  });
  try {
    assertTriggerConfigured();
    const payload: EpisodeJobPayload = { ...rest, jobId: job.id };
    const handle = await tasks.trigger<typeof episodeJobTask>("episode-job", payload, { tags: [`episode:${input.episodeId}`, `story:${episode.storyId}`] });
    await db.job.update({ where: { id: job.id }, data: { triggerRunId: handle.id } });
  } catch (err) {
    await markSubmitFailed(job.id, err);
    throw err;
  }
  return job.id;
}

export async function cancelJob(jobId: string) {
  const job = await db.job.findUniqueOrThrow({ where: { id: jobId } });
  if (["COMPLETED", "FAILED", "CANCELED"].includes(job.status)) return;
  // Mark first: running stages check this flag and stop at the next checkpoint.
  await db.job.update({ where: { id: jobId }, data: { status: "CANCELED", stage: "Canceled", completedAt: new Date() } });
  if (job.triggerRunId) await runs.cancel(job.triggerRunId).catch(() => {});
  if (job.episodeId) {
    const episode = await db.episode.findUnique({ where: { id: job.episodeId } });
    if (episode?.status === "IN_PRODUCTION") {
      await db.episode.update({ where: { id: episode.id }, data: { status: episode.currentVersionId ? "SCRIPTED" : "DRAFT" } });
    }
  }
}

/**
 * A run that dies without running our error handling (out of memory, a platform crash) leaves its
 * Job row "active" forever. Checks quiet active jobs against Trigger.dev and fails the dead ones
 * so they can be retried. Best effort: Trigger.dev being unreachable must not break page loads.
 */
export async function reconcileStaleJobs() {
  if (!env().TRIGGER_SECRET_KEY) return;
  const quietSince = new Date(Date.now() - 2 * 60_000);
  const stale = await db.job.findMany({
    where: { status: { in: ACTIVE_JOB_STATUSES }, triggerRunId: { not: null }, updatedAt: { lt: quietSince } },
    take: 20,
  });
  await Promise.all(
    stale.map(async (job) => {
      const run = await runs.retrieve(job.triggerRunId!).catch(() => null);
      if (!run || !(run.isFailed || run.isCancelled)) return;
      await failJob(job.id, new Error(`The background run ended unexpectedly (${run.status}${run.error?.message ? `: ${run.error.message}` : ""}).`));
      if (job.episodeId) {
        const episode = await db.episode.findUnique({ where: { id: job.episodeId } });
        if (episode?.status === "IN_PRODUCTION") {
          await db.episode.update({ where: { id: episode.id }, data: { status: episode.currentVersionId ? "FAILED" : "DRAFT" } });
          await refreshStoryStatus(episode.storyId);
        }
      }
    }),
  ).catch(() => {});
}

/** Re-runs a failed or canceled job with its original input. Completed stages are skipped. */
export async function retryJob(jobId: string) {
  const job = await db.job.findUniqueOrThrow({ where: { id: jobId } });
  if (!["FAILED", "CANCELED"].includes(job.status)) throw new Error("Only failed or canceled jobs can be retried.");
  assertTriggerConfigured();
  await db.job.update({ where: { id: jobId }, data: { status: "QUEUED", stage: "Queued for retry", completedAt: null } });
  try {
    if (job.type === "BATCH_IDEATION") {
      const handle = await tasks.trigger<typeof ideateBatchTask>("ideate-batch", { jobId, batchId: job.batchId! });
      await db.job.update({ where: { id: jobId }, data: { triggerRunId: handle.id } });
    } else {
      const input = job.input as Omit<EpisodeJobPayload, "jobId">;
      const handle = await tasks.trigger<typeof episodeJobTask>("episode-job", { ...input, jobId });
      await db.job.update({ where: { id: jobId }, data: { triggerRunId: handle.id } });
    }
  } catch (err) {
    await markSubmitFailed(jobId, err);
    throw err;
  }
}
