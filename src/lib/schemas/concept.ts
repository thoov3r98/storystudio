import { z } from "zod";

export const CRITERIA = [
  { key: "relatability", label: "Relatability", weight: 1.2 },
  { key: "curiosity", label: "Immediate curiosity", weight: 1.3 },
  { key: "hookStrength", label: "Opening hook strength", weight: 1.3 },
  { key: "storytellingPotential", label: "Storytelling potential", weight: 1.1 },
  { key: "seriesPotential", label: "Future episode capacity", weight: 1.2 },
  { key: "visualSimplicity", label: "Visual simplicity", weight: 0.8 },
  { key: "originality", label: "Originality vs. existing stories", weight: 1.0 },
  { key: "audienceAppeal", label: "Potential audience appeal", weight: 1.0 },
] as const;

export type CriterionKey = (typeof CRITERIA)[number]["key"];

const CriterionScore = z.object({
  score: z.number().describe("Integer 1–10."),
  rationale: z.string().describe("One sentence."),
});

export const CriteriaScoresSchema = z.object(
  Object.fromEntries(CRITERIA.map((c) => [c.key, CriterionScore])) as Record<CriterionKey, typeof CriterionScore>,
);

export type CriteriaScores = z.infer<typeof CriteriaScoresSchema>;

export const FactModeSchema = z.enum(["FACTUAL", "HYPOTHETICAL", "FICTIONAL", "MIXED"]);

export const ConceptCandidateSchema = z.object({
  title: z.string().describe("Plain title describing a recognizable situation or natural question, e.g. 'Your Suitcase Never Arrives at Baggage Claim'."),
  premise: z.string().describe("Two or three plain sentences explaining what happens. Do not advertise how surprising or clever it is."),
  logline: z.string().describe("The idea in one plain sentence, as you would tell a friend."),
  category: z.string(),
  keywords: z.array(z.string()).describe("4–8 lowercase topical keywords."),
  openingSituation: z.string().describe("The concrete, everyday second-person situation the first episode opens on."),
  seriesPotential: z.string().describe("How the story could naturally continue, if it does. Two strong episodes is fine; do not invent mysteries to stretch it."),
});

export type ConceptCandidate = z.infer<typeof ConceptCandidateSchema>;

export const ConceptBatchSchema = z.object({
  concepts: z.array(ConceptCandidateSchema),
});

export const ConceptEvaluationSchema = z.object({
  evaluations: z.array(
    z.object({
      conceptIndex: z.number().int().describe("Index of the concept in the list you were given."),
      scores: CriteriaScoresSchema,
      summary: z.string().describe("Two-sentence editorial verdict."),
    }),
  ),
});

export type ConceptEvaluation = z.infer<typeof ConceptEvaluationSchema>["evaluations"][number];

export function clampScore(n: number): number {
  if (!Number.isFinite(n)) return 1;
  return Math.min(10, Math.max(1, Math.round(n)));
}

export function normalizeScores(scores: CriteriaScores): CriteriaScores {
  return Object.fromEntries(
    Object.entries(scores).map(([k, v]) => [k, { score: clampScore(v.score), rationale: v.rationale }]),
  ) as CriteriaScores;
}

/** Weighted mean on the 1–10 scale. */
export function totalScore(scores: CriteriaScores): number {
  let sum = 0;
  let weights = 0;
  for (const c of CRITERIA) {
    const s = scores[c.key]?.score;
    if (typeof s !== "number") continue;
    sum += clampScore(s) * c.weight;
    weights += c.weight;
  }
  return weights === 0 ? 0 : Math.round((sum / weights) * 100) / 100;
}

export function validateScores(scores: CriteriaScores): string[] {
  const issues: string[] = [];
  for (const c of CRITERIA) {
    const s = scores[c.key]?.score;
    if (typeof s !== "number" || s < 1 || s > 10) issues.push(`${c.key} score must be between 1 and 10 (got ${s}).`);
  }
  return issues;
}
