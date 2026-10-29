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
  type StorySeed,
} from "@/lib/ai/story-prompts";
import {
  type EditorialNote,
  type EditorialReview,
  EditorialReviewSchema,
  HookCandidatesSchema,
  type HookCandidates,
  type HookPick,
  HookPickSchema,
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

export type ComposeInput = WriterInput & { seed?: StorySeed | null; series?: SeriesContext | null };

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
  opts: { durationSec: number; wordsPerSecond: number; plot: Plot; hook: string | null },
): string[] {
  const issues = narrationLengthIssues(v.storyNarration, opts);
  if (opts.hook && !startsWith(v.storyNarration, opts.hook)) issues.push(`Open with the chosen hook word for word: "${opts.hook}"`);
  const covered = new Set(v.beatCoverage.map((b) => b.beat));
  const missing = opts.plot.beats.filter((b) => !covered.has(b.n)).map((b) => b.n);
  if (missing.length) issues.push(`Every beat must be told; beatCoverage is missing beat(s) ${missing.join(", ")}.`);
  return issues;
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
  let invalid: string[] = [];
  const { plots } = await run({
    prompt: plotCandidatesPrompt({ ...input, references: refs }, 2),
    schema: PlotCandidatesSchema,
    schemaName: "plot_candidates",
    role: "writer",
    operation: "plot-candidates",
    budget: 0.15,
    // At least one plot must pass the structure checks; failing ones are dropped.
    validate: (v) => {
      invalid = v.plots.map((p, i) => validatePlot(p, input).map((x) => `plots[${i}]: ${x}`)).flat();
      return v.plots.some((p) => validatePlot(p, input).length === 0) ? [] : invalid.length ? invalid : ["Plan at least one plot."];
    },
  });
  const valid = plots.filter((p) => validatePlot(p, input).length === 0);

  let plot = valid[0];
  let plotPick: QualityRecord["plotPick"] = null;
  if (valid.length > 1) {
    const pick = await run({
      prompt: plotPickPrompt({ plots: valid, premise: input.premise, partNumber: input.partNumber, durationSec: input.durationSec }),
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
      prompt: plotRepairPrompt({ plot, issues: previous, durationSec: input.durationSec }),
      schema: PlotRepairSchema,
      schemaName: "plot_repair",
      role: "writer",
      operation: "plot-repair",
      budget: 0.12,
      validate: (v) => [...validatePlot(v.plot, input), ...changeLogIssues(v.changeLog, ids)],
    });
    plot = repair.plot;
    changeLog = repair.changeLog;
  }
  const blocking = rounds.at(-1)!.issues.filter((i) => i.severity === "blocking");
  if (blocking.length) throw new StoryQualityError(blocking, plot);
  return { plot, plotPick, rounds };
}

// ── Hooks: candidates → pick against the plot ─────────────────────────

async function developHook(run: Run, input: ComposeInput, plot: Plot, deps: ComposeDeps) {
  const hero = input.narrator?.name ?? "the main character";
  const perspective = input.narrator ? (input.narrator.perspective === "FIRST_PERSON" ? `first person, as ${hero}` : `close third person, following ${hero}`) : "second person, present tense";
  const candidates: HookCandidates = await run({
    prompt: hookCandidatesPrompt({ plot, hero, perspective, references: selectReferences(deps.references, { archetype: plot.archetype }) }),
    schema: HookCandidatesSchema,
    schemaName: "hook_candidates",
    role: "writer",
    operation: "hook-candidates",
    budget: 0.06,
    validate: (v) => [
      ...(v.candidates.length < 4 ? ["Write at least 4 hooks."] : []),
      ...(new Set(v.candidates.map((c) => c.style)).size < 3 ? ["Use at least 3 different hook styles."] : []),
    ],
  });
  const pick: HookPick = await run({
    prompt: hookPickPrompt({ plot, candidates: candidates.candidates }),
    schema: HookPickSchema,
    schemaName: "hook_pick",
    role: "reviewer",
    operation: "hook-pick",
    validate: (v) => {
      const issues: string[] = [];
      if (v.chosenIndex < 0 || v.chosenIndex >= candidates.candidates.length) issues.push(`chosenIndex must be 0–${candidates.candidates.length - 1}.`);
      const chosen = v.reviews.find((r) => r.index === v.chosenIndex);
      if (chosen && !chosen.deliveredByPlot) issues.push("Choose a hook the plot fully delivers on.");
      const generic = genericHookPhrase(v.hook);
      if (generic) issues.push(`The hook uses a generic phrase ("${generic}"). Make it concrete.`);
      if (countWords(v.hook) > 35) issues.push("Keep the hook to one or two short spoken sentences (35 words at most).");
      return issues;
    },
  });
  return { candidates, pick };
}

// ── Checks and targeted revisions ─────────────────────────────────────

async function checkScript(run: Run, input: ComposeInput, s: ScriptState, previous?: { id: string; text: string }[], round = 1) {
  const auditPrompt = scriptAuditPrompt({ plot: s.plot, narration: s.narration, premise: input.premise, previous, series: input.series });
  const [audit, editorial] = await Promise.all([
    run({ prompt: auditPrompt, schema: LogicAuditSchema, schemaName: "script_audit", role: "reviewer", operation: "script-audit", budget: 0.08 }),
    run({
      prompt: editorialPrompt({ narration: s.narration, dramaticQuestion: s.plot.dramaticQuestion, hookPromise: s.hookPromise, partNumber: input.partNumber, durationSec: input.durationSec }),
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
    prompt: scriptRevisionPrompt({ ...input, plot: s.plot, narration: s.narration, hook: s.hook, issues: toFix, hookIssue }),
    schema: ScriptRevisionSchema,
    schemaName: "script_revision",
    role: "writer",
    operation: "revise-script",
    budget: 0.15,
    validate: (v) => [
      ...narrationIssues(v, { ...input, plot: v.plot, hook: hookIssue ? null : s.hook }),
      ...validatePlot(v.plot, input),
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
    prompt: sceneBreakdownPrompt({ ...input, plot: s.plot, narration: s.narration, title: s.title }),
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
 * Writes one episode script: causal plot → logic audit (repairs) → hooks →
 * narration → logic + editorial checks (targeted revisions) → storyboard.
 * Never touches the database, so it can run in evaluations.
 */
export async function composeScript(input: ComposeInput, deps: ComposeDeps): Promise<ComposeResult> {
  const startedAt = Date.now();
  const spent = { usd: 0 };
  const run = makeRunner(deps, spent);

  await deps.onStage?.("Planning the plot", 0.06);
  const planned = await planPlot(run, input, deps);

  await deps.onStage?.("Developing the hook", 0.3);
  const hooks = await developHook(run, input, planned.plot, deps);

  await deps.onStage?.("Writing the narration", 0.4);
  const chosenStyle = hooks.candidates.candidates[hooks.pick.chosenIndex]?.style;
  const refs = selectReferences(deps.references, { archetype: planned.plot.archetype, hookStyle: chosenStyle, endingType: planned.plot.resolution.endingType });
  const written = await run({
    prompt: narrationPrompt({ ...input, plot: planned.plot, hook: hooks.pick, references: refs }),
    schema: StoryNarrationSchema,
    schemaName: "story_narration",
    role: "writer",
    operation: "write-narration",
    budget: 0.12,
    validate: (v) => narrationIssues(v, { ...input, plot: planned.plot, hook: hooks.pick.hook }),
  });

  const refined = await refineScript(
    run,
    input,
    {
      plot: planned.plot,
      hook: hooks.pick.hook,
      hookPromise: hooks.pick.promise,
      title: written.title,
      narration: written.storyNarration,
      summary: written.summary,
      keyReveals: written.keyReveals,
      unresolvedQuestions: written.unresolvedQuestions,
    },
    { onStage: deps.onStage },
  );

  await deps.onStage?.("Planning the shots", 0.85);
  const draft = await breakdown(run, input, refined.state);

  return {
    draft,
    plot: refined.state.plot,
    quality: qualityRecord({
      plotRounds: planned.rounds,
      scriptRounds: refined.rounds,
      revisions: refined.revisions,
      editorial: refined.editorial,
      hooks: { candidates: hooks.candidates, pick: hooks.pick },
      plotPick: planned.plotPick,
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

