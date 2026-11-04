import { runs, tasks } from "@trigger.dev/sdk";
import { db } from "@/lib/db";
import { MissingConfigError, env } from "@/lib/env";
import { ACTIVE_JOB_STATUSES } from "@/lib/constants";
import { failJob } from "@/lib/jobs";
import { refreshStoryStatus } from "@/lib/pipeline/versions";
import type { JobType } from "@/generated/prisma/enums";
import { EpisodeJobPayloadSchema, type EpisodeJobPayload } from "@/lib/pipeline/produce";
import type { ScriptJobPayload } from "@/lib/pipeline/paste";
import type { episodeJobTask, scriptJobTask } from "@/trigger/tasks";

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

/** Splits and storyboards a pasted script; each part then goes on to its own production job. */
export async function enqueueScriptJob(input: Omit<ScriptJobPayload, "jobId">) {
  const job = await db.job.create({ data: { type: "STORYBOARD", storyId: input.storyId, input: input as object } });
  try {
    assertTriggerConfigured();
    const handle = await tasks.trigger<typeof scriptJobTask>("script-job", { ...input, jobId: job.id }, { tags: [`story:${input.storyId}`] });
    await db.job.update({ where: { id: job.id }, data: { triggerRunId: handle.id } });
  } catch (err) {
    await markSubmitFailed(job.id, err);
    throw err;
  }
  return job.id;
}

const ACTION_JOB_TYPE: Record<EpisodeJobPayload["request"]["action"], JobType> = {
  "regenerate-image": "REGENERATE_IMAGE",
  "regenerate-voiceover": "REGENERATE_VOICEOVER",
  render: "RENDER",
};

/** `fromTask`: queued by another task's run, which is itself authenticated with Trigger.dev. */
export async function enqueueEpisodeJob(input: Omit<EpisodeJobPayload, "jobId"> & { type?: JobType; fromTask?: boolean }) {
  const episode = await db.episode.findUniqueOrThrow({ where: { id: input.episodeId }, select: { storyId: true } });
  const active = await db.job.findFirst({
    where: { episodeId: input.episodeId, status: { notIn: ["COMPLETED", "FAILED", "CANCELED"] } },
    select: { id: true },
  });
  if (active) throw new Error("This episode already has a job in progress. Wait for it to finish or cancel it first.");

  const { type, fromTask, ...rest } = input;
  const job = await db.job.create({
    data: {
      type: type ?? ACTION_JOB_TYPE[input.request.action],
      episodeId: input.episodeId,
      storyId: episode.storyId,
      input: rest as object,
    },
  });
  try {
    if (!fromTask) assertTriggerConfigured();
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
    if (job.type === "STORYBOARD") {
      const input = job.input as Omit<ScriptJobPayload, "jobId">;
      const handle = await tasks.trigger<typeof scriptJobTask>("script-job", { ...input, jobId });
      await db.job.update({ where: { id: jobId }, data: { triggerRunId: handle.id } });
    } else {
      const parsed = EpisodeJobPayloadSchema.omit({ jobId: true }).safeParse(job.input);
      if (!parsed.success) throw new Error("This job is from the old script-writing flow and can't be retried. Use the buttons on the episode page instead.");
      const handle = await tasks.trigger<typeof episodeJobTask>("episode-job", { ...parsed.data, jobId });
      await db.job.update({ where: { id: jobId }, data: { triggerRunId: handle.id } });
    }
  } catch (err) {
    await markSubmitFailed(jobId, err);
    throw err;
  }
}
