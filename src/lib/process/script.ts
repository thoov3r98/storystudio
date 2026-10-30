import type { z } from "zod";
import { generateStructured, type StructuredTextClient } from "@/lib/ai/structured";
import type { Pricing } from "@/lib/costs/pricing";
import type { CostContext } from "@/lib/costs/record";
import type { EpisodeDraft } from "@/lib/schemas/episode";
import { MOTION_PRESETS, sceneCountRange, targetWordRange } from "@/lib/constants";
import { countWords, joinNarration, tokenize } from "@/lib/text";

/** Targeted script revisions before the script goes to the producer with whatever is still open. */
export const MAX_SCRIPT_REVISIONS = 2;

export type ScriptDeps = {
  text: StructuredTextClient;
  pricing: Pricing;
  /** Writes notes, plans, narration and revisions. */
  writer: string;
  /** Checks the scripts; never grades its own writing. */
  reviewer: string;
  cost?: CostContext;
  checkBudget?: (nextUsd: number) => Promise<void>;
  onStage?: (label: string, progress: number) => Promise<void> | void;
};

export function makeRunner(deps: Pick<ScriptDeps, "text" | "pricing" | "writer" | "reviewer" | "cost" | "checkBudget">, spent: { usd: number }) {
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

export type Run = ReturnType<typeof makeRunner>;

// ── Deterministic checks ──────────────────────────────────────────────

/** Shots must be numbered, valid and an exact word-for-word cut of the script. */
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
  const script = tokenize(draft.storyNarration);
  const cut = tokenize(joinNarration(draft.scenes));
  const at = script.findIndex((w, i) => cut[i] !== w);
  if (at >= 0 || cut.length !== script.length) {
    const where = at >= 0 ? at : Math.min(script.length, cut.length);
    issues.push(
      `The scenes' narration, joined in order, must reproduce the narration word for word. They diverge at word ${where + 1}: script has "${script.slice(where, where + 8).join(" ")}", scenes have "${cut.slice(where, where + 8).join(" ")}".`,
    );
  }
  if (!startsWith(draft.storyNarration, draft.selectedHook)) issues.push("selectedHook must be the opening line(s) of storyNarration, copied exactly.");
  if (draft.onScreenHook !== undefined) issues.push(...onScreenHookIssues(draft.onScreenHook, draft.storyNarration));
  return issues;
}

/** The on-screen hook is read in a glance and may only repeat what the narration says. */
export function onScreenHookIssues(text: string, narration: string): string[] {
  const issues: string[] = [];
  const words = countWords(text);
  if (words < 2 || words > 7) issues.push(`onScreenHook must be 3–6 words (it is ${words}).`);
  if (text.includes("?")) issues.push("onScreenHook must be a plain statement, not a question.");
  const said = new Set(narration.match(/\d[\d,.]*\d|\d/g) ?? []);
  const unsaid = (text.match(/\d[\d,.]*\d|\d/g) ?? []).filter((n) => !said.has(n));
  if (unsaid.length) issues.push(`onScreenHook says ${unsaid.join(", ")}, which the narration doesn't.`);
  return issues;
}

export function startsWith(text: string, prefix: string): boolean {
  const p = tokenize(prefix).slice(0, 12);
  return p.length > 0 && tokenize(text).slice(0, p.length).join(" ") === p.join(" ");
}

export function narrationLengthIssues(narration: string, opts: { durationSec: number; wordsPerSecond: number }): string[] {
  const [minWords, maxWords] = targetWordRange(opts.durationSec, opts.wordsPerSecond);
  const words = countWords(narration);
  if (words < Math.floor(minWords * 0.9) || words > Math.ceil(maxWords * 1.1)) {
    return [`The narration must be ${minWords}–${maxWords} words; it is ${words}. ${words > maxWords ? "Simplify how things are said; keep every step the viewer needs." : "Develop the steps more."}`];
  }
  return [];
}

export function changeLogIssues(changeLog: { issueId: string }[], ids: string[]): string[] {
  const logged = new Set(changeLog.map((c) => c.issueId));
  const missing = ids.filter((id) => !logged.has(id));
  return missing.length ? [`Add a changeLog entry for each issue id; missing ${missing.join(", ")}.`] : [];
}

export function firstSentence(text: string): string {
  return (/^.*?[.!?](?=\s|$)/.exec(text.trim())?.[0] ?? text.trim()).trim();
}
