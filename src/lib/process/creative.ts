import { creativePrompt } from "@/lib/ai/process-prompts";
import { openingStageIds, type ResearchNotes } from "@/lib/schemas/process";
import {
  type Creative,
  CreativePlanSchema,
  hookSupportFlags,
  type Pattern,
  recommendHook,
  researchClaims,
  type ReviewedHook,
  type StorytellingDecision,
} from "@/lib/schemas/storytelling";
import { countWords } from "@/lib/text";
import type { Run } from "./script";
import { writingStyle } from "@/lib/ai/writing-styles";
import type { ProcessInput } from "./compose";

/*
 * The creative stage between research and narration, in one call. Facts and
 * their order come from the research; this only chooses emphasis: the pattern,
 * featured stage and stage visuals, plus a few openings (strongest first),
 * each checked deterministically against the claims it cites. The first clean
 * opening is recommended. Never touches the database.
 */

export const HOOKS_WRITTEN = 4;

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

function hookIssues(hooks: { line: string; strategy: string; featuredStageId: string }[], stageIds: string[], early: string[], strategies: readonly string[]): string[] {
  return [
    ...(hooks.length < 3 || hooks.length > 6 ? [`Write ${HOOKS_WRITTEN} openings (3–6; got ${hooks.length}).`] : []),
    ...(new Set(hooks.map((h) => h.strategy)).size < Math.min(3, hooks.length) ? ["Use at least three different strategies."] : []),
    ...hooks.flatMap((h, i) => [
      ...(!strategies.includes(h.strategy) ? [`Opening ${i + 1}: strategy must be one of ${strategies.join(", ")}.`] : []),
      ...(countWords(h.line) > 30 ? [`Opening ${i + 1} is ${countWords(h.line)} words; keep it under 25.`] : []),
      ...(!stageIds.includes(h.featuredStageId) ? [`Opening ${i + 1}: featuredStageId must be one of ${stageIds.join(", ")}.`] : []),
      ...(stageIds.includes(h.featuredStageId) && !early.includes(h.featuredStageId)
        ? [`Opening ${i + 1} promises ${h.featuredStageId}, which the first video doesn't reach; feature one of ${early.join(", ")}.`]
        : []),
    ]),
  ];
}

/** Decides how to tell it (or applies the producer's pattern) and writes the openings for it, in one call. */
export async function planCreative(run: Run, input: ProcessInput, research: ResearchNotes, opts: { pattern?: Pattern | null; topic?: Creative["topic"] } = {}): Promise<CreativePlan> {
  const stageIds = research.stages.map((s) => s.id);
  const singleVideo = input.parts[1] === 1;
  const early = openingStageIds(research, { singleVideo });
  const strategies: readonly string[] = writingStyle(input.channel.format).hookStrategies;
  const { hooks, ...decision } = await run({
    prompt: creativePrompt({ ...input, research, topic: opts.topic, pattern: opts.pattern, count: HOOKS_WRITTEN, singleVideo }),
    schema: CreativePlanSchema,
    schemaName: "creative_plan",
    role: "writer",
    operation: "creative-plan",
    budget: 0.08,
    validate: (v) => [...decisionIssues(v, research, opts.pattern), ...hookIssues(v.hooks, stageIds, early, strategies)],
  });
  const reviewed: ReviewedHook[] = hooks.map((h) => ({ ...h, pattern: decision.pattern, flags: hookSupportFlags(h, research), review: null, total: null, rank: null }));
  // Written strongest first; flagged hooks always rank below clean ones.
  const order = reviewed.map((_, i) => i).sort((a, b) => Number(reviewed[a].flags.length > 0) - Number(reviewed[b].flags.length > 0) || a - b);
  order.forEach((idx, rank) => (reviewed[idx].rank = rank + 1));
  return { decision, hooks: reviewed, recommended: recommendHook(reviewed) };
}

/** What the writer receives from a creative plan and the chosen hook. */
export function creativeFor(plan: Pick<CreativePlan, "decision">, hook: ReviewedHook | NonNullable<Creative["hook"]> | null, topic?: Creative["topic"]): Creative {
  return {
    decision: plan.decision,
    hook: hook
      ? { id: "id" in hook ? hook.id : undefined, line: hook.line, claimIds: hook.claimIds, featuredStageId: hook.featuredStageId, firstFrameVisual: hook.firstFrameVisual, strategy: hook.strategy }
      : null,
    topic: topic ?? null,
  };
}
