import { hookPrompt, hookReviewPrompt, storytellingPrompt } from "@/lib/ai/process-prompts";
import type { ResearchNotes } from "@/lib/schemas/process";
import {
  type Creative,
  HookBatchSchema,
  hookSupportFlags,
  hookTotal,
  HookReviewSchema,
  HOOK_CRITERIA,
  type Pattern,
  recommendHook,
  researchClaims,
  type ReviewedHook,
  type StorytellingDecision,
  StorytellingDecisionSchema,
} from "@/lib/schemas/storytelling";
import { countWords } from "@/lib/text";
import type { Run } from "./script";
import type { ProcessInput } from "./compose";

/*
 * The creative stage between research/plan and narration. Facts and their
 * order come from the research; this only chooses emphasis:
 *   storytelling decision (pattern, featured stage, stage visuals)
 *   → 5 hook candidates citing research claims → deterministic support checks
 *   → independent hook review (reviewer model) → recommended hook.
 * Never touches the database.
 */

export const HOOKS_WRITTEN = 5;

export type CreativePlan = { decision: StorytellingDecision; hooks: ReviewedHook[]; recommended: number | null };

function decisionIssues(v: StorytellingDecision, research: ResearchNotes, forced?: Pattern | null): string[] {
  const stageIds = research.stages.map((s) => s.id);
  const claims = researchClaims(research);
  const issues: string[] = [];
  if (forced && v.pattern !== forced) issues.push(`Use the producer's pattern, ${forced}.`);
  if (!stageIds.includes(v.featuredStageId)) issues.push(`featuredStageId must be one of ${stageIds.join(", ")}.`);
  if (v.alternatives.includes(v.pattern)) issues.push("alternatives must not include the chosen pattern.");
  if (v.stageVisuals.map((s) => s.stageId).join(",") !== stageIds.join(",")) issues.push(`stageVisuals needs one entry per stage, in order: ${stageIds.join(", ")}.`);
  const unknown = v.stageVisuals.flatMap((s) => s.claimIds.filter((id) => !claims.has(id)));
  if (unknown.length) issues.push(`stageVisuals cite claim ids that don't exist: ${[...new Set(unknown)].join(", ")}.`);
  return issues;
}

/** Recommends (or, with `pattern`, applies) a storytelling pattern from the researched facts. */
export async function decideStorytelling(run: Run, input: ProcessInput, research: ResearchNotes, opts: { pattern?: Pattern | null; topic?: Creative["topic"] } = {}): Promise<StorytellingDecision> {
  return run({
    prompt: storytellingPrompt({ ...input, research, topic: opts.topic, pattern: opts.pattern }),
    schema: StorytellingDecisionSchema,
    schemaName: "storytelling_decision",
    role: "writer",
    operation: "storytelling-decision",
    budget: 0.05,
    validate: (v) => decisionIssues(v, research, opts.pattern),
  });
}

/** Writes hook candidates for the decided pattern and has an independent reviewer score them. */
export async function writeAndReviewHooks(run: Run, input: ProcessInput, research: ResearchNotes, decision: StorytellingDecision): Promise<{ hooks: ReviewedHook[]; recommended: number | null }> {
  const stageIds = research.stages.map((s) => s.id);
  const { hooks } = await run({
    prompt: hookPrompt({ ...input, research, decision, count: HOOKS_WRITTEN }),
    schema: HookBatchSchema,
    schemaName: "hook_candidates",
    role: "writer",
    operation: "hook-candidates",
    budget: 0.04,
    validate: (v) => [
      ...(v.hooks.length < 4 || v.hooks.length > 6 ? [`Write ${HOOKS_WRITTEN} openings (4–6; got ${v.hooks.length}).`] : []),
      ...(new Set(v.hooks.map((h) => h.strategy)).size < 3 ? ["Use at least three different strategies."] : []),
      ...v.hooks.flatMap((h, i) => [
        ...(countWords(h.line) > 30 ? [`Opening ${i + 1} is ${countWords(h.line)} words; keep it under 25.`] : []),
        ...(!stageIds.includes(h.featuredStageId) ? [`Opening ${i + 1}: featuredStageId must be one of ${stageIds.join(", ")}.`] : []),
      ]),
    ],
  });

  const { reviews } = await run({
    prompt: hookReviewPrompt({ title: input.title, research, hooks }),
    schema: HookReviewSchema,
    schemaName: "hook_review",
    role: "reviewer",
    operation: "hook-review",
    budget: 0.03,
    validate: (v) => {
      const ids = v.reviews.map((r) => r.index).sort((a, b) => a - b);
      return ids.join(",") !== hooks.map((_, i) => i).join(",") ? [`Review every opening exactly once, indexes 0–${hooks.length - 1}.`] : [];
    },
  });

  const reviewed: ReviewedHook[] = hooks.map((h, i) => {
    const r = reviews.find((x) => x.index === i);
    const review = r ? (({ index: _index, ...rest }) => rest)(r) : null;
    const flags = hookSupportFlags(h, research);
    if (review && !review.supported) flags.push(`Reviewer: ${review.unsupportedDetail || "not supported by the research."}`);
    const total = review ? hookTotal(Object.fromEntries(HOOK_CRITERIA.map((c) => [c, review[c]])) as Parameters<typeof hookTotal>[0]) : null;
    return { ...h, pattern: decision.pattern, flags, review, total, rank: null };
  });
  // Ranked by editorial total; flagged hooks always rank below supported ones.
  const order = reviewed.map((_, i) => i).sort((a, b) => Number(reviewed[a].flags.length > 0) - Number(reviewed[b].flags.length > 0) || (reviewed[b].total ?? -1) - (reviewed[a].total ?? -1));
  order.forEach((idx, rank) => (reviewed[idx].rank = rank + 1));
  return { hooks: reviewed, recommended: recommendHook(reviewed) };
}

/** The whole creative stage: decision, then hooks for it. */
export async function planCreative(run: Run, input: ProcessInput, research: ResearchNotes, opts: { pattern?: Pattern | null; topic?: Creative["topic"] } = {}): Promise<CreativePlan> {
  const decision = await decideStorytelling(run, input, research, opts);
  const { hooks, recommended } = await writeAndReviewHooks(run, input, research, decision);
  return { decision, hooks, recommended };
}

/** What the writer receives from a creative plan and the chosen hook. */
export function creativeFor(plan: Pick<CreativePlan, "decision">, hook: ReviewedHook | NonNullable<Creative["hook"]> | null, topic?: Creative["topic"]): Creative {
  return {
    decision: plan.decision,
    hook: hook ? { id: "id" in hook ? hook.id : undefined, line: hook.line, claimIds: hook.claimIds, featuredStageId: hook.featuredStageId, firstFrameVisual: hook.firstFrameVisual } : null,
    topic: topic ?? null,
  };
}
