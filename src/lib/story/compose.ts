import type { z } from "zod";
import { generateStructured, type StructuredTextClient } from "@/lib/ai/structured";
import type { Pricing } from "@/lib/costs/pricing";
import type { CostContext } from "@/lib/costs/record";
import type { WriterInput } from "@/lib/ai/prompts";
import {
  editorialPrompt,
  hookCandidatesPrompt,
  hookPickPrompt,
  narrationPrompt,
  plotAuditPrompt,
  plotCandidatesPrompt,
  plotPickPrompt,
  plotRepairPrompt,
  sceneBreakdownPrompt,
  scriptAuditPrompt,
  scriptRevisionPrompt,
  partBrief,
  type StorySeed,
} from "@/lib/ai/story-prompts";
import {
  type EditorialNote,
  type EditorialReview,
  EditorialReviewSchema,
  type HookCandidates,
  type HookPick,
  PartHookCandidatesSchema,
  PartHookPickSchema,
  LogicAuditSchema,
  type Plot,
  PlotCandidatesSchema,
  PlotPickSchema,
  PlotRepairSchema,
  type QualityRecord,
  type RecordedIssue,
  ScriptRevisionSchema,
  StoryNarrationSchema,
} from "@/lib/schemas/story-plan";
import { type EpisodeDraft, SceneBreakdownSchema } from "@/lib/schemas/episode";
import type { StoryBible } from "@/lib/schemas/story-bible";
import { MOTION_PRESETS, sceneCountRange, targetWordRange } from "@/lib/constants";
import { countWords, joinNarration, tokenize } from "@/lib/text";
import { validatePlot } from "./plot";
import { genericHookPhrase, issueBrief, needsRevision, qualityStatus, recordIssues, verifiedNotes } from "./review";
import { type ReferenceStory, selectReferences } from "./references";

/** Plot repairs before giving up on a plot with blocking holes. */
export const MAX_PLOT_REPAIRS = 2;
/** Targeted script revisions before the script goes to the producer with whatever is still open. */
export const MAX_SCRIPT_REVISIONS = 2;

/** The plot still has blocking holes after bounded repairs, so no narration was written. */
export class StoryQualityError extends Error {
  constructor(
    public readonly issues: RecordedIssue[],
    public readonly plot: Plot,
  ) {
    super(
      `The plot still had ${issues.length} blocking logic issue(s) after ${MAX_PLOT_REPAIRS} repairs, so no script was written and nothing was spent on media. ${issues
        .slice(0, 3)
        .map((i) => `${i.location}: ${i.problem}`)
        .join(" ")}`,
    );
    this.name = "StoryQualityError";
  }
  toJSON() {
    return { name: this.name, message: this.message, issues: this.issues };
  }
}

export type SeriesContext = { bible: StoryBible; previousSummaries: string[] };

/** `parts` > 1 plans one story told across that many videos (Part 1..N). */
export type ComposeInput = WriterInput & { seed?: StorySeed | null; series?: SeriesContext | null; parts?: number };

export type ComposeDeps = {
  text: StructuredTextClient;
  pricing: Pricing;
  /** Writes plots, hooks, narration and revisions. */
  writer: string;
  /** Picks, audits and edits; never grades its own writing. */
  reviewer: string;
  references: ReferenceStory[];
  cost?: CostContext;
  checkBudget?: (nextUsd: number) => Promise<void>;
  onStage?: (label: string, progress: number) => Promise<void> | void;
};

/** Everything one script carries between steps. The plot stays the source of truth. */
export type ScriptState = {
  plot: Plot;
  /** Which part of the plot this script tells (1 for single episodes), and that part's brief (see partBrief). */
  part: number;
  brief: string;
  hook: string;
  hookPromise: string;
  title: string;
  narration: string;
  summary: string;
  keyReveals: string[];
  unresolvedQuestions: string[];
};

type Round = QualityRecord["scriptRounds"][number];

function makeRunner(deps: ComposeDeps, spent: { usd: number }) {
  return async function run<S extends z.ZodType>(args: {
    prompt: { system: string; user: string };
    schema: S;
    schemaName: string;
    role: "writer" | "reviewer";
    operation: string;
    validate?: (v: z.infer<S>) => string[];
    budget?: number;
  }): Promise<z.infer<S>> {
    if (args.budget) await deps.checkBudget?.(args.budget);
    return generateStructured({
      client: deps.text,
      pricing: deps.pricing,
      model: args.role === "writer" ? deps.writer : deps.reviewer,
      ...args.prompt,
      schema: args.schema,
      schemaName: args.schemaName,
      validate: args.validate,
      cost: deps.cost ? { ctx: deps.cost, operation: args.operation } : undefined,
      onCost: (usd) => (spent.usd += usd),
    });
  };
}

type Run = ReturnType<typeof makeRunner>;

// ── Deterministic checks ──────────────────────────────────────────────

/** Shots must be numbered, valid and an exact word-for-word cut of the story. */
export function validateDraft(draft: EpisodeDraft, opts: { durationSec: number; wordsPerSecond: number }): string[] {
  const issues: string[] = [];
  const [minScenes, maxScenes] = sceneCountRange(opts.durationSec);
  if (draft.scenes.length < minScenes || draft.scenes.length > maxScenes) {
    issues.push(`Use ${minScenes}–${maxScenes} scenes (you wrote ${draft.scenes.length}).`);
  }
  draft.scenes.forEach((s, i) => {
    if (s.sceneNumber !== i + 1) issues.push(`Scenes must be numbered 1..N in order; scene at position ${i + 1} is numbered ${s.sceneNumber}.`);
    if (!s.narration.trim()) issues.push(`Scene ${i + 1} has empty narration.`);
    if (!MOTION_PRESETS.includes(s.motionPreset)) issues.push(`Scene ${i + 1} has an invalid motionPreset.`);
  });
  issues.push(...narrationLengthIssues(draft.storyNarration, opts));
  const story = tokenize(draft.storyNarration);
  const cut = tokenize(joinNarration(draft.scenes));
  const at = story.findIndex((w, i) => cut[i] !== w);
  if (at >= 0 || cut.length !== story.length) {
    const where = at >= 0 ? at : Math.min(story.length, cut.length);
    issues.push(
      `The scenes' narration, joined in order, must reproduce the narration word for word. They diverge at word ${where + 1}: story has "${story.slice(where, where + 8).join(" ")}", scenes have "${cut.slice(where, where + 8).join(" ")}".`,
    );
  }
  if (!startsWith(draft.storyNarration, draft.selectedHook)) issues.push("selectedHook must be the opening line(s) of storyNarration, copied exactly.");
  return issues;
}

function startsWith(text: string, prefix: string): boolean {
  const p = tokenize(prefix).slice(0, 12);
  return p.length > 0 && tokenize(text).slice(0, p.length).join(" ") === p.join(" ");
}

function narrationLengthIssues(narration: string, opts: { durationSec: number; wordsPerSecond: number }): string[] {
  const [minWords, maxWords] = targetWordRange(opts.durationSec, opts.wordsPerSecond);
  const words = countWords(narration);
  if (words < Math.floor(minWords * 0.9) || words > Math.ceil(maxWords * 1.1)) {
    return [`The narration must be ${minWords}–${maxWords} words; it is ${words}. ${words > maxWords ? "Simplify how things are said; keep every cause the viewer needs." : "Develop the beats more."}`];
  }
  return [];
}

/** Narration checks: length, the chosen opening, and every plot beat told. */
export function narrationIssues(
  v: { storyNarration: string; beatCoverage: { beat: number }[] },
  opts: { durationSec: number; wordsPerSecond: number; plot: Plot; hook: string | null; part?: number },
): string[] {
  const issues = narrationLengthIssues(v.storyNarration, opts);
  if (opts.hook && !startsWith(v.storyNarration, opts.hook)) issues.push(`Open with the chosen hook word for word: "${opts.hook}"`);
  const covered = new Set(v.beatCoverage.map((b) => b.beat));
  const missing = partBeats(opts.plot, opts.part ?? 1).filter((n) => !covered.has(n));
  if (missing.length) issues.push(`Every beat must be told; beatCoverage is missing beat(s) ${missing.join(", ")}.`);
  return issues;
}

/** The beat numbers a part tells; every beat when the plot is one part. */
export function partBeats(plot: Plot, part: number): number[] {
  const parts = plot.parts ?? [];
  return parts.length > 1 ? (parts.find((p) => p.part === part)?.beats ?? []) : plot.beats.map((b) => b.n);
}

function changeLogIssues(changeLog: { issueId: string }[], ids: string[]): string[] {
  const logged = new Set(changeLog.map((c) => c.issueId));
  const missing = ids.filter((id) => !logged.has(id));
  return missing.length ? [`Add a changeLog entry for each issue id; missing ${missing.join(", ")}.`] : [];
}

function firstSentence(text: string): string {
  return (/^.*?[.!?](?=\s|$)/.exec(text.trim())?.[0] ?? text.trim()).trim();
}

// ── Plot: candidates → pick → audit/repair ────────────────────────────

async function planPlot(run: Run, input: ComposeInput, deps: ComposeDeps) {
  const refs = selectReferences(deps.references, { archetype: input.seed?.archetype });
  const parts = input.parts ?? 1;
  const check = { durationSec: input.durationSec, parts };
  let invalid: string[] = [];
  const { plots } = await run({
    prompt: plotCandidatesPrompt({ ...input, references: refs, parts }, 2),
    schema: PlotCandidatesSchema,
    schemaName: "plot_candidates",
    role: "writer",
    operation: "plot-candidates",
    budget: 0.15 * Math.max(1, parts / 2),
    // At least one plot must pass the structure checks; failing ones are dropped.
    validate: (v) => {
      invalid = v.plots.map((p, i) => validatePlot(p, check).map((x) => `plots[${i}]: ${x}`)).flat();
      return v.plots.some((p) => validatePlot(p, check).length === 0) ? [] : invalid.length ? invalid : ["Plan at least one plot."];
    },
  });
  const valid = plots.filter((p) => validatePlot(p, check).length === 0);

  let plot = valid[0];
  let plotPick: QualityRecord["plotPick"] = null;
  if (valid.length > 1) {
    const pick = await run({
      prompt: plotPickPrompt({ plots: valid, premise: input.premise, partNumber: input.partNumber, durationSec: input.durationSec, parts }),
      schema: PlotPickSchema,
      schemaName: "plot_pick",
      role: "reviewer",
      operation: "plot-pick",
      validate: (v) => (v.chosenIndex >= 0 && v.chosenIndex < valid.length ? [] : [`chosenIndex must be 0–${valid.length - 1}.`]),
    });
    plot = valid[pick.chosenIndex];
    const rejected = pick.reviews.filter((r) => r.index !== pick.chosenIndex).map((r) => r.weaknesses);
    plotPick = { reason: pick.reason, rejected: rejected.join(" ") };
  }

  const rounds: QualityRecord["plotRounds"] = [];
  let changeLog: { issueId: string; change: string }[] = [];
  let previous: { id: string; text: string }[] | undefined;
  for (let round = 0; ; round++) {
    const prompt = plotAuditPrompt({ plot, premise: input.premise, previous, series: input.series });
    const audit = await run({ prompt, schema: LogicAuditSchema, schemaName: "plot_audit", role: "reviewer", operation: "plot-audit", budget: 0.08 });
    const issues = recordIssues(audit.issues, { stage: "plot", source: prompt.user, prefix: `P${round + 1}.` });
    rounds.push({ issues, changeLog });
    const serious = issues.filter((i) => i.severity !== "minor");
    if (serious.length === 0 || round >= MAX_PLOT_REPAIRS) break;

    previous = issueBrief(serious, []);
    const ids = previous.map((p) => p.id);
    const repair = await run({
      prompt: plotRepairPrompt({ plot, issues: previous, durationSec: input.durationSec, parts }),
      schema: PlotRepairSchema,
      schemaName: "plot_repair",
      role: "writer",
      operation: "plot-repair",
      budget: 0.12,
      validate: (v) => [...validatePlot(v.plot, check), ...changeLogIssues(v.changeLog, ids)],
    });
    plot = repair.plot;
    changeLog = repair.changeLog;
  }
  const blocking = rounds.at(-1)!.issues.filter((i) => i.severity === "blocking");
  if (blocking.length) throw new StoryQualityError(blocking, plot);
  return { plot, plotPick, rounds };
}

// ── Hooks: candidates → pick against the plot, for every part at once ──

type PartHooks = { candidates: HookCandidates; pick: HookPick };

async function developHooks(run: Run, input: ComposeInput, plot: Plot, deps: ComposeDeps, parts: number[]): Promise<Map<number, PartHooks>> {
  const hero = input.narrator?.name ?? "the main character";
  const perspective = input.narrator ? (input.narrator.perspective === "FIRST_PERSON" ? `first person, as ${hero}` : `close third person, following ${hero}`) : "second person, present tense";
  const missing = (got: { part: number }[]) => parts.filter((n) => !got.some((g) => g.part === n));
  const { parts: candidates } = await run({
    prompt: hookCandidatesPrompt({ plot, hero, perspective, references: selectReferences(deps.references, { archetype: plot.archetype }), parts }),
    schema: PartHookCandidatesSchema,
    schemaName: "hook_candidates",
    role: "writer",
    operation: "hook-candidates",
    budget: 0.06 * parts.length,
    validate: (v) => [
      ...missing(v.parts).map((n) => `Write hooks for part ${n}.`),
      ...v.parts.flatMap((p) => [
        ...(p.candidates.length < 4 ? [`Part ${p.part}: write at least 4 hooks.`] : []),
        ...(new Set(p.candidates.map((c) => c.style)).size < 3 ? [`Part ${p.part}: use at least 3 different hook styles.`] : []),
      ]),
    ],
  });
  const forPart = (n: number) => candidates.find((c) => c.part === n)!;
  const { parts: picks } = await run({
    prompt: hookPickPrompt({ plot, parts: parts.map((n) => ({ part: n, candidates: forPart(n).candidates })) }),
    schema: PartHookPickSchema,
    schemaName: "hook_pick",
    role: "reviewer",
    operation: "hook-pick",
    validate: (v) => [
      ...missing(v.parts).map((n) => `Choose a hook for part ${n}.`),
      ...v.parts.flatMap((p) => {
        const issues: string[] = [];
        const options = forPart(p.part)?.candidates ?? [];
        if (p.chosenIndex < 0 || p.chosenIndex >= options.length) issues.push(`Part ${p.part}: chosenIndex must be 0–${options.length - 1}.`);
        const chosen = p.reviews.find((r) => r.index === p.chosenIndex);
        if (chosen && !chosen.deliveredByPlot) issues.push(`Part ${p.part}: choose a hook the plot fully delivers on.`);
        const generic = genericHookPhrase(p.hook);
        if (generic) issues.push(`Part ${p.part}: the hook uses a generic phrase ("${generic}"). Make it concrete.`);
        if (countWords(p.hook) > 35) issues.push(`Part ${p.part}: keep the hook to one or two short spoken sentences (35 words at most).`);
        return issues;
      }),
    ],
  });
  return new Map(
    parts.map((n) => {
      const { part: _c, ...c } = forPart(n);
      const { part: _p, ...pick } = picks.find((p) => p.part === n)!;
      return [n, { candidates: c, pick }];
    }),
  );
}

// ── Checks and targeted revisions ─────────────────────────────────────

async function checkScript(run: Run, input: ComposeInput, s: ScriptState, previous?: { id: string; text: string }[], round = 1) {
  const auditPrompt = scriptAuditPrompt({ plot: s.plot, narration: s.narration, premise: input.premise, previous, series: input.series, brief: s.brief });
  const [audit, editorial] = await Promise.all([
    run({ prompt: auditPrompt, schema: LogicAuditSchema, schemaName: "script_audit", role: "reviewer", operation: "script-audit", budget: 0.08 }),
    run({
      prompt: editorialPrompt({ narration: s.narration, dramaticQuestion: s.plot.dramaticQuestion, hookPromise: s.hookPromise, partNumber: input.partNumber + s.part - 1, durationSec: input.durationSec, brief: s.brief }),
      schema: EditorialReviewSchema,
      schemaName: "editorial_review",
      role: "reviewer",
      operation: "editorial-review",
    }),
  ]);
  const issues = recordIssues(audit.issues, { stage: "script", source: auditPrompt.user, prefix: `S${round}.` }).map((i) =>
    i.category === "series-continuity" ? { ...i, stage: "continuity" as const } : i,
  );
  const mustFix = verifiedNotes(editorial.mustFix, s.narration);
  const unresolvedPrevious = audit.previousIssues.filter((p) => !p.resolved).map((p) => p.id);
  return { issues, mustFix, editorial, unresolvedPrevious };
}

async function reviseScript(run: Run, input: ComposeInput, s: ScriptState, toFix: { id: string; text: string }[], hookIssue: boolean): Promise<{ state: ScriptState; changeLog: Round["changeLog"] }> {
  const ids = toFix.map((t) => t.id);
  const rev = await run({
    prompt: scriptRevisionPrompt({ ...input, plot: s.plot, narration: s.narration, hook: s.hook, issues: toFix, hookIssue, brief: s.brief }),
    schema: ScriptRevisionSchema,
    schemaName: "script_revision",
    role: "writer",
    operation: "revise-script",
    budget: 0.15,
    validate: (v) => [
      ...narrationIssues(v, { ...input, plot: v.plot, hook: hookIssue ? null : s.hook, part: s.part }),
      ...validatePlot(v.plot, { durationSec: input.durationSec, parts: input.parts ?? 1 }),
      ...changeLogIssues(v.changeLog, ids),
    ],
  });
  const hook = startsWith(rev.storyNarration, s.hook) ? s.hook : firstSentence(rev.storyNarration);
  return {
    state: { ...s, plot: rev.plot, hook, title: rev.title, narration: rev.storyNarration, summary: rev.summary, keyReveals: rev.keyReveals, unresolvedQuestions: rev.unresolvedQuestions },
    changeLog: rev.changeLog,
  };
}

/**
 * Checks a script (logic audit + editorial review) and revises it with
 * targeted fixes until it is clean or the revision limit is reached. With
 * `initial`, the given open items are fixed first ("Fix flagged issues").
 */
export async function refineScript(
  run: Run,
  input: ComposeInput,
  start: ScriptState,
  opts: { initial?: { issues: RecordedIssue[]; mustFix: EditorialNote[] }; onStage?: ComposeDeps["onStage"] } = {},
) {
  let state = start;
  const rounds: Round[] = [];
  let revisions = 0;
  let pending = opts.initial ? issueBrief(opts.initial.issues, opts.initial.mustFix) : null;
  let changeLog: Round["changeLog"] = [];
  let editorial: EditorialReview | null = null;
  for (;;) {
    if (pending?.length) {
      await opts.onStage?.(`Revising the script (round ${revisions + 1})`, 0.6 + revisions * 0.08);
      const hookIssue = pending.some((p) => /\b(hook|first-line|opening)\b/i.test(p.text));
      const revised = await reviseScript(run, input, state, pending, hookIssue);
      state = revised.state;
      changeLog = revised.changeLog;
      revisions++;
    }
    await opts.onStage?.("Checking logic, story and hook", 0.55 + revisions * 0.08);
    const checked = await checkScript(run, input, state, pending ?? undefined, rounds.length + 1);
    editorial = checked.editorial;
    rounds.push({ issues: checked.issues, mustFix: checked.mustFix, changeLog, unresolvedPrevious: checked.unresolvedPrevious });
    if (!needsRevision(checked.issues, checked.mustFix) || revisions >= MAX_SCRIPT_REVISIONS) break;
    pending = issueBrief(checked.issues, checked.mustFix);
  }
  return { state, rounds, revisions, editorial };
}

// ── Storyboard ────────────────────────────────────────────────────────

async function breakdown(run: Run, input: ComposeInput, s: ScriptState): Promise<EpisodeDraft> {
  const fixed = { title: s.title, storyNarration: s.narration, selectedHook: s.hook, summary: s.summary, keyReveals: s.keyReveals, unresolvedQuestions: s.unresolvedQuestions };
  const b = await run({
    prompt: sceneBreakdownPrompt({ ...input, plot: s.plot, narration: s.narration, title: s.title, brief: s.brief }),
    schema: SceneBreakdownSchema,
    schemaName: "scene_breakdown",
    role: "writer",
    operation: "scene-breakdown",
    budget: 0.15,
    validate: (v) => validateDraft({ ...fixed, ...v }, input),
  });
  return { ...fixed, ...b };
}

export type ComposeResult = { draft: EpisodeDraft; plot: Plot; quality: QualityRecord };

function qualityRecord(input: {
  part: number;
  plotRounds: QualityRecord["plotRounds"];
  scriptRounds: Round[];
  revisions: number;
  editorial: EditorialReview | null;
  hooks: QualityRecord["hooks"];
  plotPick: QualityRecord["plotPick"];
  references: string[];
  startedAt: number;
  costUsd: number;
}): QualityRecord {
  const last = input.scriptRounds.at(-1)!;
  const all = [...input.plotRounds, ...input.scriptRounds].flatMap((r) => r.issues);
  const firstScript = input.scriptRounds[0];
  return {
    pipelineVersion: 2,
    part: input.part,
    status: qualityStatus({ issues: last.issues, mustFix: last.mustFix }),
    plotRounds: input.plotRounds,
    scriptRounds: input.scriptRounds,
    issues: last.issues,
    mustFix: last.mustFix,
    editorial: input.editorial,
    hooks: input.hooks,
    plotPick: input.plotPick,
    references: input.references,
    dismissed: [],
    override: null,
    metrics: {
      firstPass: input.plotRounds.length <= 1 && Boolean(firstScript) && !needsRevision(firstScript.issues, firstScript.mustFix),
      plotRepairs: input.plotRounds.length - 1,
      scriptRevisions: input.revisions,
      blockingFound: all.filter((i) => i.severity === "blocking").length,
      significantFound: all.filter((i) => i.severity === "significant").length,
      unverifiedIssues: all.filter((i) => !i.verified).length,
      durationMs: Date.now() - input.startedAt,
      textCostUsd: Math.round(input.costUsd * 10000) / 10000,
    },
  };
}

/**
 * Writes a story's scripts: causal plot (split into parts) → logic audit
 * (repairs) → hooks for every part → for each part in order: narration →
 * logic + editorial checks (targeted revisions) → storyboard. Never touches
 * the database, so it can run in evaluations.
 */
export async function composeStory(input: ComposeInput, deps: ComposeDeps): Promise<ComposeResult[]> {
  const startedAt = Date.now();
  const shared = { usd: 0 };
  const run = makeRunner(deps, shared);
  const count = input.parts ?? 1;
  const partNumbers = Array.from({ length: count }, (_, i) => i + 1);
  const stage = (label: string, progress: number) => deps.onStage?.(label, progress);

  await stage(count > 1 ? `Planning all ${count} parts` : "Planning the plot", 0.06);
  const planned = await planPlot(run, input, deps);

  await stage("Developing the hooks", 0.25);
  const hooks = await developHooks(run, input, planned.plot, deps, partNumbers);

  let plot = planned.plot;
  const written: { state: ScriptState; rounds: Round[]; revisions: number; editorial: EditorialReview | null; refs: string[]; spent: { usd: number } }[] = [];
  for (const part of partNumbers) {
    const spent = { usd: 0 };
    const partRun = makeRunner(deps, spent);
    const at = 0.3 + (0.55 * (part - 1)) / count;
    const label = count > 1 ? ` Part ${part}` : "";
    await stage(`Writing${label || " the narration"}`, at);
    const h = hooks.get(part)!;
    const brief = partBrief(plot, part, written.map((w) => w.state.narration));
    const refs = selectReferences(deps.references, { archetype: plot.archetype, hookStyle: h.candidates.candidates[h.pick.chosenIndex]?.style, endingType: plot.resolution.endingType });
    const narration = await partRun({
      prompt: narrationPrompt({ ...input, plot, hook: h.pick, references: refs, brief, beats: partBeats(plot, part) }),
      schema: StoryNarrationSchema,
      schemaName: "story_narration",
      role: "writer",
      operation: "write-narration",
      budget: 0.12,
      validate: (v) => narrationIssues(v, { ...input, plot, hook: h.pick.hook, part }),
    });
    const refined = await refineScript(
      partRun,
      input,
      {
        plot,
        part,
        brief,
        hook: h.pick.hook,
        hookPromise: h.pick.promise,
        title: narration.title,
        narration: narration.storyNarration,
        summary: narration.summary,
        keyReveals: narration.keyReveals,
        unresolvedQuestions: narration.unresolvedQuestions,
      },
      { onStage: (l) => stage(`${l}${label ? ` (${label.trim()})` : ""}`, at + 0.05) },
    );
    // A revision may repair this part's beats; later parts are told from the repaired plot.
    plot = refined.state.plot;
    written.push({ ...refined, refs: refs.map((r) => r.title), spent });
  }

  await stage(count > 1 ? "Planning the shots for every part" : "Planning the shots", 0.88);
  const drafts = await Promise.all(written.map((w) => breakdown(makeRunner(deps, w.spent), input, { ...w.state, plot })));

  return written.map((w, i) => ({
    draft: drafts[i],
    plot,
    quality: qualityRecord({
      part: w.state.part,
      plotRounds: planned.rounds,
      scriptRounds: w.rounds,
      revisions: w.revisions,
      editorial: w.editorial,
      hooks: hooks.get(w.state.part)!,
      plotPick: planned.plotPick,
      references: w.refs,
      startedAt,
      // Planning is shared, so each part carries an equal share of it.
      costUsd: shared.usd / count + w.spent.usd,
    }),
  }));
}

/** One episode (a single part): the common case and the evaluation entry point. */
export async function composeScript(input: ComposeInput, deps: ComposeDeps): Promise<ComposeResult> {
  const [result] = await composeStory({ ...input, parts: 1 }, deps);
  return result;
}

/** Rewrites one part of a planned multi-part story from its saved plot: new hooks, narration, checks and shots. */
export async function composePart(input: ComposeInput, deps: ComposeDeps, saved: { plot: Plot; part: number; earlier: string[]; plotRounds: QualityRecord["plotRounds"] }): Promise<ComposeResult> {
  const startedAt = Date.now();
  const spent = { usd: 0 };
  const run = makeRunner(deps, spent);
  const { plot, part } = saved;
  await deps.onStage?.(`Developing the hook for Part ${part}`, 0.1);
  const h = (await developHooks(run, input, plot, deps, [part])).get(part)!;
  const brief = partBrief(plot, part, saved.earlier);
  const refs = selectReferences(deps.references, { archetype: plot.archetype, hookStyle: h.candidates.candidates[h.pick.chosenIndex]?.style, endingType: plot.resolution.endingType });
  await deps.onStage?.(`Writing Part ${part}`, 0.3);
  const narration = await run({
    prompt: narrationPrompt({ ...input, plot, hook: h.pick, references: refs, brief, beats: partBeats(plot, part) }),
    schema: StoryNarrationSchema,
    schemaName: "story_narration",
    role: "writer",
    operation: "write-narration",
    budget: 0.12,
    validate: (v) => narrationIssues(v, { ...input, plot, hook: h.pick.hook, part }),
  });
  const refined = await refineScript(
    run,
    input,
    {
      plot,
      part,
      brief,
      hook: h.pick.hook,
      hookPromise: h.pick.promise,
      title: narration.title,
      narration: narration.storyNarration,
      summary: narration.summary,
      keyReveals: narration.keyReveals,
      unresolvedQuestions: narration.unresolvedQuestions,
    },
    { onStage: deps.onStage },
  );
  await deps.onStage?.("Planning the shots", 0.85);
  const draft = await breakdown(run, input, refined.state);
  return {
    draft,
    plot: refined.state.plot,
    quality: qualityRecord({
      part,
      plotRounds: saved.plotRounds,
      scriptRounds: refined.rounds,
      revisions: refined.revisions,
      editorial: refined.editorial,
      hooks: h,
      plotPick: null,
      references: refs.map((r) => r.title),
      startedAt,
      costUsd: spent.usd,
    }),
  };
}

/** Fixes a saved script's open issues with targeted revisions, re-checks it and re-cuts the shots. */
export async function reviseComposed(input: ComposeInput, deps: ComposeDeps, saved: { state: ScriptState; quality: QualityRecord }): Promise<ComposeResult> {
  const startedAt = Date.now();
  const spent = { usd: 0 };
  const run = makeRunner(deps, spent);
  const dismissed = new Set(saved.quality.dismissed.map((d) => d.issueId));
  const refined = await refineScript(run, input, saved.state, {
    initial: { issues: saved.quality.issues.filter((i) => !dismissed.has(i.id)), mustFix: saved.quality.mustFix },
    onStage: deps.onStage,
  });
  await deps.onStage?.("Planning the shots", 0.85);
  const draft = await breakdown(run, input, refined.state);
  return {
    draft,
    plot: refined.state.plot,
    quality: qualityRecord({
      part: saved.quality.part ?? 1,
      plotRounds: saved.quality.plotRounds,
      scriptRounds: [...saved.quality.scriptRounds, ...refined.rounds],
      revisions: saved.quality.metrics.scriptRevisions + refined.revisions,
      editorial: refined.editorial,
      hooks: saved.quality.hooks,
      plotPick: saved.quality.plotPick,
      references: saved.quality.references,
      startedAt,
      costUsd: spent.usd,
    }),
  };
}

/** Re-checks a script after a hand edit (no automatic revision: the producer is editing). */
export async function recheckScript(input: ComposeInput, deps: ComposeDeps, s: ScriptState, quality: QualityRecord): Promise<QualityRecord> {
  const spent = { usd: 0 };
  const run = makeRunner(deps, spent);
  const checked = await checkScript(run, input, s, undefined, quality.scriptRounds.length + 1);
  const round: Round = { issues: checked.issues, mustFix: checked.mustFix, changeLog: [], unresolvedPrevious: [] };
  return {
    ...quality,
    status: qualityStatus({ issues: checked.issues, mustFix: checked.mustFix }),
    scriptRounds: [...quality.scriptRounds, round],
    issues: checked.issues,
    mustFix: checked.mustFix,
    editorial: checked.editorial,
    dismissed: [],
    override: null,
    metrics: { ...quality.metrics, textCostUsd: Math.round((quality.metrics.textCostUsd + spent.usd) * 10000) / 10000 },
  };
}

