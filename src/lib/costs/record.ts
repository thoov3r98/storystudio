import { db } from "@/lib/db";
import type { Provider } from "@/generated/prisma/enums";

export type CostContext = {
  jobId?: string | null;
  storyId?: string | null;
  episodeId?: string | null;
  /** Hard ceiling for the job's spend. */
  budgetUsd?: number | null;
};

export class BudgetExceededError extends Error {
  constructor(public readonly spent: number, public readonly next: number, public readonly budget: number) {
    super(
      `Budget limit reached: $${spent.toFixed(2)} spent + ~$${next.toFixed(2)} for the next step would exceed the $${budget.toFixed(2)} budget.`,
    );
    this.name = "BudgetExceededError";
  }
}

export async function recordCost(
  ctx: CostContext,
  entry: { provider: Provider; model: string; operation: string; usage: Record<string, unknown>; costUsd: number; estimated: boolean },
) {
  await db.costEntry.create({
    data: {
      provider: entry.provider,
      model: entry.model,
      operation: entry.operation,
      usage: entry.usage as object,
      costUsd: entry.costUsd.toFixed(6),
      estimated: entry.estimated,
      jobId: ctx.jobId ?? null,
      storyId: ctx.storyId ?? null,
      episodeId: ctx.episodeId ?? null,
    },
  });
}

export async function spentFor(ctx: CostContext): Promise<number> {
  if (!ctx.jobId) return 0;
  const agg = await db.costEntry.aggregate({ where: { jobId: ctx.jobId }, _sum: { costUsd: true } });
  return Number(agg._sum.costUsd ?? 0);
}

/** Throws before a paid call if it would push spend over the configured budget. */
export async function assertWithinBudget(ctx: CostContext, nextEstimateUsd: number) {
  if (ctx.budgetUsd == null) return;
  const spent = await spentFor(ctx);
  if (spent + nextEstimateUsd > ctx.budgetUsd) throw new BudgetExceededError(spent, nextEstimateUsd, ctx.budgetUsd);
}
