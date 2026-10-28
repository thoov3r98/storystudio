import { db } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";
import type { JobStatus } from "@/generated/prisma/enums";

export class JobCanceledError extends Error {
  constructor(jobId: string) {
    super(`Job ${jobId} was canceled.`);
    this.name = "JobCanceledError";
  }
}

/** Updates the persisted job state shown on /jobs. Throws if the user canceled the job meanwhile. */
export async function setJobStage(jobId: string, status: JobStatus, stage: string, progress?: number) {
  const job = await db.job.findUnique({ where: { id: jobId }, select: { status: true } });
  if (job?.status === "CANCELED") throw new JobCanceledError(jobId);
  await db.job.update({
    where: { id: jobId },
    data: { status, stage, ...(progress !== undefined ? { progress: Math.max(0, Math.min(1, progress)) } : {}) },
  });
}

export async function setJobProgress(jobId: string, progress: number, stage?: string) {
  await db.job.update({ where: { id: jobId }, data: { progress: Math.max(0, Math.min(1, progress)), ...(stage ? { stage } : {}) } });
}

export async function assertNotCanceled(jobId: string) {
  const job = await db.job.findUnique({ where: { id: jobId }, select: { status: true } });
  if (job?.status === "CANCELED") throw new JobCanceledError(jobId);
}

export async function startJob(jobId: string, runId: string | undefined) {
  await db.job.update({
    where: { id: jobId },
    data: { startedAt: new Date(), completedAt: null, error: Prisma.DbNull, triggerRunId: runId ?? undefined, attempts: { increment: 1 } },
  });
}

export async function completeJob(jobId: string, output?: unknown) {
  await db.job.update({
    where: { id: jobId },
    data: { status: "COMPLETED", stage: "Completed", progress: 1, completedAt: new Date(), output: (output ?? {}) as object },
  });
}

export function serializeError(err: unknown) {
  if (err && typeof err === "object" && "toJSON" in err && typeof (err as { toJSON: unknown }).toJSON === "function") {
    return (err as { toJSON(): object }).toJSON();
  }
  if (err instanceof Error) return { name: err.name, message: err.message, stack: err.stack?.split("\n").slice(0, 6).join("\n") };
  return { name: "Error", message: String(err) };
}

export async function failJob(jobId: string, err: unknown) {
  const job = await db.job.findUnique({ where: { id: jobId }, select: { status: true } });
  if (job?.status === "CANCELED") return;
  await db.job.update({
    where: { id: jobId },
    data: { status: "FAILED", completedAt: new Date(), error: serializeError(err) as object },
  });
}

/**
 * Runs `fn` as the body of a Trigger.dev task, keeping the Job row in sync.
 * Cancellation surfaces as a CANCELED job, not a failure.
 */
export async function runTrackedJob<T>(jobId: string, runId: string | undefined, fn: () => Promise<T>): Promise<T> {
  await startJob(jobId, runId);
  try {
    const result = await fn();
    await completeJob(jobId, result);
    return result;
  } catch (err) {
    if (err instanceof JobCanceledError) {
      await db.job.update({ where: { id: jobId }, data: { completedAt: new Date() } });
      return undefined as T;
    }
    await failJob(jobId, err);
    throw err;
  }
}
