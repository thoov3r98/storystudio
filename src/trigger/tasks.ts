import { AbortTaskRunError, logger, schemaTask } from "@trigger.dev/sdk";
import { z } from "zod";
import { db } from "@/lib/db";
import { runTrackedJob } from "@/lib/jobs";
import { runChannelIdeation } from "@/lib/pipeline/channels";
import { EpisodeJobPayloadSchema, runEpisodeJob } from "@/lib/pipeline/produce";
import { productionDeps } from "@/lib/pipeline/deps";
import { refreshStoryStatus } from "@/lib/pipeline/versions";
import { BudgetExceededError } from "@/lib/costs/record";
import { StructuredOutputError } from "@/lib/ai/structured";
import { MissingConfigError } from "@/lib/env";

/*
 * Trigger.dev tasks. Each task is a thin wrapper that keeps the Job row in
 * sync; all logic lives in src/lib/pipeline so it is testable without Trigger.
 *
 * Retries: Trigger retries transient failures (network, provider 5xx). Errors
 * that will not succeed on retry (budget, configuration, invalid model output
 * after bounded retries, continuity conflicts) abort immediately. Because every
 * stage skips work whose artifact already exists, a retry resumes rather than
 * repeating paid work.
 */

function isPermanent(err: unknown): boolean {
  return (
    err instanceof BudgetExceededError ||
    err instanceof MissingConfigError ||
    err instanceof StructuredOutputError ||
    (err instanceof Error && ["ScriptGateError", "StoryQualityError", "ApprovalBlockedError", "JobCanceledError"].includes(err.name))
  );
}

export const ideateBatchTask = schemaTask({
  id: "ideate-batch",
  schema: z.object({ jobId: z.string(), batchId: z.string() }),
  maxDuration: 900,
  retry: { maxAttempts: 2 },
  run: async ({ jobId, batchId }, { ctx }) => {
    try {
      // Pitches for a channel; the producer picks one, and only then is a script written.
      return await runTrackedJob(jobId, ctx.run.id, () => runChannelIdeation({ batchId, jobId, deps: productionDeps }));
    } catch (err) {
      if (isPermanent(err)) throw new AbortTaskRunError(err instanceof Error ? err.message : String(err));
      throw err;
    }
  },
});

export const episodeJobTask = schemaTask({
  id: "episode-job",
  schema: EpisodeJobPayloadSchema,
  maxDuration: 3600,
  // Image and audio buffers outgrow the 0.5 GB default; an out-of-memory crash retries on a larger machine.
  machine: "small-2x",
  retry: { maxAttempts: 3, minTimeoutInMs: 5_000, maxTimeoutInMs: 60_000, factor: 2, outOfMemory: { machine: "medium-1x" } },
  run: async (payload, { ctx }) => {
    try {
      return await runTrackedJob(payload.jobId, ctx.run.id, () => runEpisodeJob(payload, productionDeps));
    } catch (err) {
      logger.error("Episode job failed", { jobId: payload.jobId, error: err instanceof Error ? err.message : String(err) });
      const episode = await db.episode.findUnique({ where: { id: payload.episodeId } });
      if (episode?.status === "IN_PRODUCTION") {
        await db.episode.update({ where: { id: episode.id }, data: { status: episode.currentVersionId ? "FAILED" : "DRAFT" } });
        await refreshStoryStatus(episode.storyId);
      }
      if (isPermanent(err)) throw new AbortTaskRunError(err instanceof Error ? err.message : String(err));
      throw err;
    }
  },
});
