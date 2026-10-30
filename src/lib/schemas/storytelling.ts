import { z } from "zod";
import type { ResearchNotes } from "./process";
import { tokenize } from "@/lib/text";

/*
 * How a researched product is told: one of three storytelling patterns, the
 * featured stage, and an opening hook tied to research claims. Claims are
 * research steps, numbered "T2.1" (stage T2, step 1). See src/lib/process/creative.ts.
 */

export const PATTERNS = {
  TRANSFORMATION: {
    label: "Transformation",
    bestFor: "Recycling, forging, molding, material changes with a striking before and after.",
    structure: [
      "Open on the surprising start-to-finish transformation.",
      "Reveal the original material.",
      "Explain the critical operations in their real order.",
      "Show why the key transformation steps work.",
      "Finish with the verified end product.",
    ],
  },
  HIDDEN_PROBLEM: {
    label: "Hidden engineering problem",
    bestFor: "Precision manufacturing, engineered materials, electronics, tight tolerances.",
    structure: [
      "Open on an unexpected manufacturing challenge.",
      "Explain why it matters.",
      "Show the steps that address it, in order.",
      "Reveal the machinery or engineering solution.",
      "Finish on how the finished product meets the requirement.",
    ],
  },
  FACTORY_REVEAL: {
    label: "Factory reveal",
    bestFor: "Food, packaging, everyday household products, visually interesting automated lines.",
    structure: [
      "Open on the most interesting verified operation.",
      "Establish what is actually happening.",
      "Explain how the product reaches that stage.",
      "Continue through the remaining stages.",
      "End on the finished product and a meaningful process payoff.",
    ],
  },
} as const;
export type Pattern = keyof typeof PATTERNS;
export const PATTERN_KEYS = Object.keys(PATTERNS) as Pattern[];

export const HOOK_STRATEGIES = ["unexpected-transformation", "hidden-difficulty", "intriguing-operation", "counterintuitive-fact", "material-contrast"] as const;

/** Structured visual facts for the future visual engine. Only what the research supports. */
export const StageVisualSchema = z.object({
  stageId: z.string(),
  visualSubject: z.string().describe("What the shot is of."),
  operation: z.string().describe("The real operation happening, plainly."),
  materialBefore: z.string().describe("What the material looks like going in."),
  materialAfter: z.string().describe("What it looks like coming out."),
  machinery: z.string().describe("The machine doing it, only if the research names or describes one; otherwise empty."),
  visualMoment: z.string().describe("The single most watchable moment of this stage."),
  claimIds: z.array(z.string()).describe("Research claim ids this is based on."),
});
export type StageVisual = z.infer<typeof StageVisualSchema>;

export const StorytellingDecisionSchema = z.object({
  pattern: z.enum(PATTERN_KEYS as [Pattern, ...Pattern[]]),
  reason: z.string().describe("Why this pattern fits the researched process, in one or two plain sentences, citing what the research shows."),
  curiosityMechanism: z.string().describe("The question the viewer will want answered, in one plain sentence."),
  featuredStageId: z.string().describe("The stage id (T1..TN) with the most watchable verified operation."),
  visualPayoff: z.string().describe("The moment that pays off the curiosity, as the research describes it."),
  alternatives: z.array(z.enum(PATTERN_KEYS as [Pattern, ...Pattern[]])).describe("Other patterns that could also work, if any."),
  stageVisuals: z.array(StageVisualSchema).describe("One entry per research stage, in order."),
});
export type StorytellingDecision = z.infer<typeof StorytellingDecisionSchema>;

const HookVisualSchema = StageVisualSchema.omit({ stageId: true, claimIds: true });

export const HookCandidateSchema = z.object({
  line: z.string().describe("The spoken opening line(s): at most two short sentences, under 25 words."),
  strategy: z.enum(HOOK_STRATEGIES),
  claimIds: z.array(z.string()).describe("The research claim ids every fact in the line comes from."),
  featuredStageId: z.string(),
  firstFrameVisual: z.string().describe("What the very first frame shows."),
  whyItWorks: z.string().describe("Why a scrolling viewer might stop, in one plain sentence."),
  uncertainty: z.string().describe("Anything in the line the research is unsure about; empty if none."),
  visual: HookVisualSchema,
});
export type HookCandidate = z.infer<typeof HookCandidateSchema>;

export const HookBatchSchema = z.object({ hooks: z.array(HookCandidateSchema) });

export const HOOK_CRITERIA = ["clarity", "curiosity", "specificity", "connection", "factualSupport", "visualPotential", "naturalLanguage"] as const;
export type HookCriterion = (typeof HOOK_CRITERIA)[number];
export const HOOK_CRITERIA_LABELS: Record<HookCriterion, string> = {
  clarity: "Immediately clear",
  curiosity: "Curiosity",
  specificity: "Specific",
  connection: "Tied to the real process",
  factualSupport: "Supported by research",
  visualPotential: "Visual potential",
  naturalLanguage: "Sounds natural",
};

const score = z.number().int().describe("1–5");
export const HookReviewSchema = z.object({
  reviews: z.array(
    z.object({
      index: z.number().int(),
      clarity: score.describe("A viewer instantly knows what product and what moment this is."),
      curiosity: score.describe("Creates a specific reason to keep watching."),
      specificity: score.describe("Concrete, not generic."),
      connection: score.describe("About the real manufacturing process, not a gimmick."),
      factualSupport: score.describe("Every fact is in the cited research claims."),
      visualPotential: score.describe("The first frame can show it."),
      naturalLanguage: score.describe("Sounds like a person talking."),
      supported: z.boolean().describe("Every fact in the line is in the cited claims."),
      unsupportedDetail: z.string().describe("If not supported: exactly what isn't. Otherwise empty."),
      note: z.string().describe("One plain sentence."),
    }),
  ),
});
export type HookReview = z.infer<typeof HookReviewSchema>["reviews"][number];

/** A hook with its deterministic checks and review, as compose returns it and the database stores it. */
export type ReviewedHook = HookCandidate & { pattern: Pattern; flags: string[]; review: Omit<HookReview, "index"> | null; total: number | null; rank: number | null };

/** What a script is written with: the pattern, featured stage and (Part 1) its approved opening. */
export type Creative = {
  decision: StorytellingDecision;
  hook: { id?: string; line: string; claimIds: string[]; featuredStageId: string; firstFrameVisual?: string } | null;
  /** The approved topic's angle from discovery, a hint the research must back. */
  topic?: { curiosityAngle: string; visualPayoff: string; featuredStage: string } | null;
};

// ── Claims ────────────────────────────────────────────────────────────

/** Every research step as a numbered claim: "T2.1" is stage T2, step 1. */
export function researchClaims(r: Pick<ResearchNotes, "stages">): Map<string, { stageId: string; text: string; sources: string[] }> {
  const claims = new Map<string, { stageId: string; text: string; sources: string[] }>();
  for (const s of r.stages) {
    s.steps.forEach((st, i) => claims.set(`${s.id}.${i + 1}`, { stageId: s.id, text: `${st.what}${st.details ? ` (${st.details})` : ""}`, sources: st.sources }));
  }
  return claims;
}

const BANNED_OPENERS = [/^have you ever wondered/i, /^ever wondered/i, /^today,? we/i, /^in this video/i, /^(hi|hey|hello|welcome)\b/i, /^did you know/i];
const SUPERLATIVES = /\b(biggest|largest|fastest|smallest|best|worst|most|world'?s|only|secret|never before|record)\b/i;

/** Numbers as said in a line ("140", "1,500", "0.1"). */
export function numbersIn(text: string): string[] {
  return [...text.matchAll(/\b\d[\d,]*(?:\.\d+)?\b/g)].map((m) => m[0].replace(/,/g, ""));
}

/**
 * Deterministic support checks on a hook against the research: it must cite
 * real claims, every number it says must appear in those claims, and a
 * superlative needs a claim that says so. Problems are flags; a flagged hook
 * is never recommended.
 */
export function hookSupportFlags(hook: Pick<HookCandidate, "line" | "claimIds" | "featuredStageId">, research: Pick<ResearchNotes, "stages">): string[] {
  const claims = researchClaims(research);
  const flags: string[] = [];
  const unknown = hook.claimIds.filter((id) => !claims.has(id));
  if (unknown.length) flags.push(`Cites claims that don't exist: ${unknown.join(", ")}.`);
  const cited = hook.claimIds.filter((id) => claims.has(id)).map((id) => claims.get(id)!.text);
  if (!cited.length) flags.push("Cites no research claim.");
  const citedText = cited.join(" ");
  const citedNumbers = new Set(numbersIn(citedText));
  const missing = numbersIn(hook.line).filter((n) => !citedNumbers.has(n));
  if (missing.length) flags.push(`Says ${missing.join(", ")}, which the cited claims don't contain.`);
  const sup = SUPERLATIVES.exec(hook.line);
  if (sup && !new RegExp(`\\b${sup[0]}\\b`, "i").test(citedText)) flags.push(`"${sup[0]}" isn't supported by the cited claims.`);
  if (!research.stages.some((s) => s.id === hook.featuredStageId)) flags.push(`Featured stage ${hook.featuredStageId} doesn't exist.`);
  if (BANNED_OPENERS.some((r) => r.test(hook.line.trim()))) flags.push("Opens with a stock phrase.");
  return flags;
}

/** Editorial total out of 100 from the reviewer's 1–5 scores; factual support counts double. */
export function hookTotal(review: Record<HookCriterion, number>): number {
  const weights: Record<HookCriterion, number> = { clarity: 1, curiosity: 1, specificity: 1, connection: 1, factualSupport: 2, visualPotential: 1, naturalLanguage: 1 };
  const sum = HOOK_CRITERIA.reduce((t, c) => t + (Math.max(1, Math.min(5, review[c])) - 1) * weights[c], 0);
  const max = HOOK_CRITERIA.reduce((t, c) => t + 4 * weights[c], 0);
  return Math.round((sum / max) * 1000) / 10;
}

/** The best hook that passed every check, or null when none did (the script then opens plainly). */
export function recommendHook<T extends { flags: string[]; review: { supported: boolean } | null; total: number | null }>(hooks: T[]): number | null {
  let best: number | null = null;
  hooks.forEach((h, i) => {
    if (h.flags.length || !h.review?.supported || h.total === null) return;
    if (best === null || h.total > hooks[best].total!) best = i;
  });
  return best;
}

/**
 * Whether a narration opens with the approved hook, or a tight refinement of
 * it: the first sentences must carry most of the hook's words and add no number.
 */
export function hookOpeningIssues(narration: string, hook: string): string[] {
  const hookWords = tokenize(hook);
  const opening = tokenize(narration).slice(0, Math.ceil(hookWords.length * 1.4) + 2);
  const content = [...new Set(hookWords.filter((w) => w.length > 3))];
  const kept = content.filter((w) => opening.includes(w)).length;
  const issues: string[] = [];
  if (content.length && kept / content.length < 0.7) issues.push(`Open with the approved hook (you may tighten its wording, not replace it): "${hook}"`);
  // Only the sentences standing in for the hook; the explanation after it may give researched numbers.
  const hookSentences = Math.max(1, hook.split(/(?<=[.!?])\s+/).filter(Boolean).length);
  const openingText = narration.split(/(?<=[.!?])\s+/).slice(0, hookSentences).join(" ");
  const extra = numbersIn(openingText).filter((n) => !numbersIn(hook).includes(n));
  if (extra.length && kept / Math.max(1, content.length) >= 0.7) issues.push(`The opening adds ${extra.join(", ")}, which the approved hook doesn't say. Keep the hook's facts.`);
  return issues;
}
