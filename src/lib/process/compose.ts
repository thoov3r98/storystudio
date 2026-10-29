import type { ResearchClient } from "@/lib/ai/research";
import { recordCost } from "@/lib/costs/record";
import { textCost } from "@/lib/costs/pricing";
import {
  processAuditPrompt,
  processBreakdownPrompt,
  processNarrationPrompt,
  processPlanPrompt,
  type ProcessPromptInput,
  processRevisionPrompt,
  researchNotesPrompt,
  researchSearchPrompt,
} from "@/lib/ai/process-prompts";
import {
  type ProcessPlan,
  ProcessNarrationSchema,
  ProcessPlanSchema,
  ProcessRevisionSchema,
  type ResearchRecord,
  ResearchNotesSchema,
  validateProcessPlan,
} from "@/lib/schemas/process";
import { LogicAuditSchema, type QualityRecord, type RecordedIssue } from "@/lib/schemas/quality";
import { type EpisodeDraft, SceneBreakdownSchema } from "@/lib/schemas/episode";
import { changeLogIssues, firstSentence, makeRunner, MAX_SCRIPT_REVISIONS, narrationLengthIssues, type Run, type ScriptDeps, validateDraft } from "./script";
import { issueBrief, needsRevision, qualityStatus, recordIssues } from "./review";

/*
 * Process explainers ("How it's made"). Research first, then the plan and
 * every script are built only from the research notes, and each script is
 * fact-checked against them:
 *   web research → notes → plan (parts) → for each part: narration →
 *   fact/clarity audit (targeted revisions) → storyboard.
 * Never touches the database.
 */

export type ProcessInput = ProcessPromptInput & {
  /** The pitch's sketch of the stages; a lead for the researcher, never a source. */
  arc: string | null;
  parts: [number, number];
};

export type ProcessDeps = ScriptDeps & { research: ResearchClient };

export type ProcessResult = { draft: EpisodeDraft; plan: ProcessPlan; part: number; quality: QualityRecord };

type Round = QualityRecord["scriptRounds"][number];
type PartState = { part: number; title: string; narration: string; summary: string };

async function research(run: Run, input: ProcessInput, deps: ProcessDeps, spent: { usd: number }): Promise<ResearchRecord> {
  await deps.checkBudget?.(0.3);
  const found = await deps.research.search({ model: deps.writer, ...researchSearchPrompt({ product: input.title, premise: input.premise, arc: input.arc }) });
  const usd = textCost(deps.pricing, found.model, found.usage) + found.searches * deps.pricing.webSearchPerCall;
  spent.usd += usd;
  if (deps.cost) {
    await recordCost(deps.cost, { provider: "OPENAI_TEXT", model: found.model, operation: "research", usage: { ...found.usage, searches: found.searches }, costUsd: usd, estimated: false });
  }
  if (found.text.trim().length < 200) throw new Error(`Web research for "${input.title}" came back nearly empty, so nothing was written. Try again, or name the product more plainly.`);
  const sources = found.sources.map((s, i) => ({ n: String(i + 1), title: s.title, url: s.url }));
  const notes = await run({
    prompt: researchNotesPrompt({ product: input.title, text: found.text, sources, minStages: input.parts[0] }),
    schema: ResearchNotesSchema,
    schemaName: "research_notes",
    role: "writer",
    operation: "research-notes",
    validate: (v) => [
      ...(v.stages.length < input.parts[0] ? [`Split the process into at least ${input.parts[0]} stages.`] : []),
      ...v.stages.flatMap((s, i) => [...(s.id !== `T${i + 1}` ? [`Stage ids must be T1..TN in order; position ${i + 1} is ${s.id}.`] : []), ...(s.steps.length === 0 ? [`${s.id} has no steps.`] : [])]),
    ],
  });
  return { ...notes, sources, researchedAt: new Date().toISOString() };
}

async function plan(run: Run, input: ProcessInput, notes: ResearchRecord): Promise<ProcessPlan> {
  return run({
    prompt: processPlanPrompt({ ...input, research: notes }),
    schema: ProcessPlanSchema,
    schemaName: "process_plan",
    role: "writer",
    operation: "process-plan",
    validate: (v) => validateProcessPlan(v, notes, input.parts),
  });
}

function partInput(input: ProcessInput, notes: ResearchRecord, p: ProcessPlan, part: number, earlier: string[]) {
  return { ...input, research: notes, plan: p, part, earlier };
}

async function narrate(run: Run, input: ProcessInput, notes: ResearchRecord, p: ProcessPlan, part: number, earlier: string[]): Promise<PartState> {
  const v = await run({
    prompt: processNarrationPrompt(partInput(input, notes, p, part, earlier)),
    schema: ProcessNarrationSchema,
    schemaName: "process_narration",
    role: "writer",
    operation: "write-narration",
    budget: 0.12,
    validate: (x) => narrationLengthIssues(x.storyNarration, input),
  });
  return { part, title: v.title, narration: v.storyNarration, summary: v.summary };
}

async function audit(run: Run, input: ProcessInput, notes: ResearchRecord, p: ProcessPlan, s: PartState, earlier: string[], previous: { id: string; text: string }[] | undefined, round: number) {
  const prompt = processAuditPrompt({ title: input.title, research: notes, plan: p, part: s.part, narration: s.narration, earlier, previous });
  const result = await run({ prompt, schema: LogicAuditSchema, schemaName: "process_audit", role: "reviewer", operation: "script-audit", budget: 0.08 });
  const issues = recordIssues(result.issues, { stage: "script", source: prompt.user, prefix: `S${round}.` }).map((i) => (i.category === "series-continuity" ? { ...i, stage: "continuity" as const } : i));
  return { issues, unresolvedPrevious: result.previousIssues.filter((x) => !x.resolved).map((x) => x.id) };
}

/** Audits a part and revises it with targeted fixes until it is clean or the revision limit is reached. */
async function refine(run: Run, input: ProcessInput, notes: ResearchRecord, p: ProcessPlan, start: PartState, earlier: string[], initial?: RecordedIssue[]) {
  let state = start;
  const rounds: Round[] = [];
  let revisions = 0;
  let pending = initial ? issueBrief(initial) : null;
  let changeLog: Round["changeLog"] = [];
  for (;;) {
    if (pending?.length) {
      const ids = pending.map((x) => x.id);
      const rev = await run({
        prompt: processRevisionPrompt({ ...partInput(input, notes, p, state.part, earlier), narration: state.narration, issues: pending }),
        schema: ProcessRevisionSchema,
        schemaName: "process_revision",
        role: "writer",
        operation: "revise-script",
        budget: 0.12,
        validate: (v) => [...narrationLengthIssues(v.storyNarration, input), ...changeLogIssues(v.changeLog, ids)],
      });
      state = { ...state, title: rev.title, narration: rev.storyNarration, summary: rev.summary };
      changeLog = rev.changeLog;
      revisions++;
    }
    const checked = await audit(run, input, notes, p, state, earlier, pending ?? undefined, rounds.length + 1);
    rounds.push({ issues: checked.issues, changeLog, unresolvedPrevious: checked.unresolvedPrevious });
    if (!needsRevision(checked.issues) || revisions >= MAX_SCRIPT_REVISIONS) break;
    pending = issueBrief(checked.issues);
  }
  return { state, rounds, revisions };
}

async function breakdown(run: Run, input: ProcessInput, notes: ResearchRecord, p: ProcessPlan, s: PartState): Promise<EpisodeDraft> {
  const fixed = { title: s.title, storyNarration: s.narration, selectedHook: firstSentence(s.narration), summary: s.summary };
  const b = await run({
    prompt: processBreakdownPrompt({ ...partInput(input, notes, p, s.part, []), narration: s.narration, title: s.title }),
    schema: SceneBreakdownSchema,
    schemaName: "scene_breakdown",
    role: "writer",
    operation: "scene-breakdown",
    budget: 0.15,
    validate: (v) => validateDraft({ ...fixed, ...v }, input),
  });
  return { ...fixed, ...b };
}

function quality(part: number, rounds: Round[], revisions: number, startedAt: number, costUsd: number): QualityRecord {
  const last = rounds.at(-1)!;
  const all = rounds.flatMap((r) => r.issues);
  return {
    pipelineVersion: 2,
    part,
    status: qualityStatus({ issues: last.issues }),
    scriptRounds: rounds,
    issues: last.issues,
    dismissed: [],
    override: null,
    metrics: {
      firstPass: rounds.length > 0 && !needsRevision(rounds[0].issues),
      scriptRevisions: revisions,
      blockingFound: all.filter((i) => i.severity === "blocking").length,
      significantFound: all.filter((i) => i.severity === "significant").length,
      unverifiedIssues: all.filter((i) => !i.verified).length,
      durationMs: Date.now() - startedAt,
      textCostUsd: Math.round(costUsd * 10000) / 10000,
    },
  };
}

/** Researches the product on the web and turns the report into checkable notes. */
export async function researchProcess(input: ProcessInput, deps: ProcessDeps): Promise<ResearchRecord> {
  const spent = { usd: 0 };
  await deps.onStage?.("Researching how it's made", 0.04);
  return research(makeRunner(deps, spent), input, deps, spent);
}

/**
 * Writes every part of a process explainer. Pass `saved.research` to reuse
 * earlier research (replanning) instead of searching again.
 */
export async function composeProcess(input: ProcessInput, deps: ProcessDeps, saved?: { research?: ResearchRecord | null }): Promise<{ research: ResearchRecord; results: ProcessResult[] }> {
  const startedAt = Date.now();
  const shared = { usd: 0 };
  const run = makeRunner(deps, shared);
  const stage = (label: string, progress: number) => deps.onStage?.(label, progress);

  let notes = saved?.research ?? null;
  if (!notes) {
    await stage("Researching how it's made", 0.04);
    notes = await research(run, input, deps, shared);
  }
  await stage("Planning the parts", 0.2);
  const p = await plan(run, input, notes);
  const count = p.parts.length;

  const written: { state: PartState; rounds: Round[]; revisions: number; spent: { usd: number } }[] = [];
  for (const { part } of p.parts) {
    const spent = { usd: 0 };
    const partRun = makeRunner(deps, spent);
    const at = 0.25 + (0.6 * (part - 1)) / count;
    const earlier = written.map((w) => w.state.narration);
    await stage(`Writing Part ${part}`, at);
    const first = await narrate(partRun, input, notes, p, part, earlier);
    await stage(`Fact-checking Part ${part}`, at + 0.05);
    const refined = await refine(partRun, input, notes, p, first, earlier);
    written.push({ ...refined, spent });
  }

  await stage("Planning the shots for every part", 0.88);
  const drafts = await Promise.all(written.map((w) => breakdown(makeRunner(deps, w.spent), input, notes!, p, w.state)));
  return {
    research: notes,
    results: written.map((w, i) => ({
      draft: drafts[i],
      plan: p,
      part: w.state.part,
      // Research and planning are shared, so each part carries an equal share of them.
      quality: quality(w.state.part, w.rounds, w.revisions, startedAt, shared.usd / count + w.spent.usd),
    })),
  };
}

/** Rewrites one part from the saved research and plan. */
export async function composeProcessPart(input: ProcessInput, deps: ProcessDeps, saved: { research: ResearchRecord; plan: ProcessPlan; part: number; earlier: string[] }): Promise<ProcessResult> {
  const startedAt = Date.now();
  const spent = { usd: 0 };
  const run = makeRunner(deps, spent);
  await deps.onStage?.(`Writing Part ${saved.part}`, 0.2);
  const first = await narrate(run, input, saved.research, saved.plan, saved.part, saved.earlier);
  await deps.onStage?.(`Fact-checking Part ${saved.part}`, 0.5);
  const refined = await refine(run, input, saved.research, saved.plan, first, saved.earlier);
  await deps.onStage?.("Planning the shots", 0.85);
  const draft = await breakdown(run, input, saved.research, saved.plan, refined.state);
  return { draft, plan: saved.plan, part: saved.part, quality: quality(saved.part, refined.rounds, refined.revisions, startedAt, spent.usd) };
}

/** Fixes a saved part's open issues with targeted revisions, re-checks it and re-cuts the shots. */
export async function reviseProcessPart(
  input: ProcessInput,
  deps: ProcessDeps,
  saved: { research: ResearchRecord; plan: ProcessPlan; part: number; earlier: string[]; title: string; narration: string; summary: string; quality: QualityRecord },
): Promise<ProcessResult> {
  const startedAt = Date.now();
  const spent = { usd: 0 };
  const run = makeRunner(deps, spent);
  const dismissed = new Set(saved.quality.dismissed.map((d) => d.issueId));
  await deps.onStage?.("Fixing the flagged issues", 0.3);
  const refined = await refine(run, input, saved.research, saved.plan, { part: saved.part, title: saved.title, narration: saved.narration, summary: saved.summary }, saved.earlier, saved.quality.issues.filter((i) => !dismissed.has(i.id)));
  await deps.onStage?.("Planning the shots", 0.85);
  const draft = await breakdown(run, input, saved.research, saved.plan, refined.state);
  const q = quality(saved.part, [...saved.quality.scriptRounds, ...refined.rounds], saved.quality.metrics.scriptRevisions + refined.revisions, startedAt, spent.usd);
  return { draft, plan: saved.plan, part: saved.part, quality: { ...q, metrics: { ...q.metrics, firstPass: saved.quality.metrics.firstPass } } };
}

/** Re-checks a part after a hand edit (no automatic revision: the producer is editing). */
export async function recheckProcessPart(
  input: ProcessInput,
  deps: ProcessDeps,
  saved: { research: ResearchRecord; plan: ProcessPlan; part: number; earlier: string[]; title: string; narration: string; summary: string; quality: QualityRecord },
): Promise<QualityRecord> {
  const spent = { usd: 0 };
  const run = makeRunner(deps, spent);
  const checked = await audit(run, input, saved.research, saved.plan, { part: saved.part, title: saved.title, narration: saved.narration, summary: saved.summary }, saved.earlier, undefined, saved.quality.scriptRounds.length + 1);
  return {
    ...saved.quality,
    status: qualityStatus({ issues: checked.issues }),
    scriptRounds: [...saved.quality.scriptRounds, { issues: checked.issues, changeLog: [], unresolvedPrevious: [] }],
    issues: checked.issues,
    dismissed: [],
    override: null,
    metrics: { ...saved.quality.metrics, textCostUsd: Math.round((saved.quality.metrics.textCostUsd + spent.usd) * 10000) / 10000 },
  };
}
