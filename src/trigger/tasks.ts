import { AbortTaskRunError, logger, schemaTask } from "@trigger.dev/sdk";
import { db } from "@/lib/db";
import { runTrackedJob } from "@/lib/jobs";
import { EpisodeJobPayloadSchema, runEpisodeJob } from "@/lib/pipeline/produce";
import { runScriptJob, ScriptJobPayloadSchema } from "@/lib/pipeline/paste";
import { enqueueEpisodeJob } from "@/lib/enqueue";
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
    (err instanceof Error && ["ApprovalBlockedError", "JobCanceledError"].includes(err.name))
  );
}

export const scriptJobTask = schemaTask({
  id: "script-job",
  schema: ScriptJobPayloadSchema,
  maxDuration: 900,
  retry: { maxAttempts: 2 },
  run: async (payload, { ctx }) => {
    try {
      // Split and storyboard (finished parts are kept on retry), then every part goes straight on to its video.
      const result = await runTrackedJob(payload.jobId, ctx.run.id, () => runScriptJob(payload, productionDeps));
      if (!result) return result;
      for (const episodeId of result.episodeIds) {
        const episode = await db.episode.findUnique({ where: { id: episodeId }, select: { status: true } });
        if (episode?.status !== "SCRIPTED") continue;
        await enqueueEpisodeJob({ episodeId, continueProduction: true, request: { action: "render" }, fromTask: true }).catch((err) =>
          logger.warn("Production not queued", { episodeId, error: err instanceof Error ? err.message : String(err) }),
        );
      }
      return result;
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
