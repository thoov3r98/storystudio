import { db } from "@/lib/db";
import { generateStructured } from "@/lib/ai/structured";
import { evaluationPrompt, ideationPrompt } from "@/lib/ai/prompts";
import {
  type ConceptCandidate,
  ConceptBatchSchema,
  ConceptEvaluationSchema,
  type ConceptEvaluation,
  normalizeScores,
  totalScore,
  validateScores,
} from "@/lib/schemas/concept";
import { emptyBible } from "@/lib/schemas/story-bible";
import { CANDIDATE_MULTIPLIER, QUALITY_PRESETS } from "@/lib/constants";
import { toNarrator, withCharacter } from "./characters";
import { normalizeTitle } from "@/lib/text";
import { dedupeCandidates } from "@/lib/similarity";
import { chunk, mapSettled } from "@/lib/async";
import { getDefaults, getPricing, getModels } from "@/lib/settings";
import { assertWithinBudget, type CostContext } from "@/lib/costs/record";
import { setJobStage, assertNotCanceled } from "@/lib/jobs";
import type { PipelineDeps } from "./deps";

const IDEATION_CHUNK = 10;
const EVALUATION_CHUNK = 8;

/** Below this, a concept can't become a coherent episode and ranks after every workable one. */
export const MIN_FEASIBILITY = 5;

/** Ranks evaluated concepts: workable episodes first, then by weighted total score (ties: curiosity, then hook strength). */
export function rankConcepts<T extends { total: number; evaluation: ConceptEvaluation }>(items: T[]): T[] {
  const workable = (x: T) => ((x.evaluation.scores.episodeFeasibility?.score ?? MIN_FEASIBILITY) >= MIN_FEASIBILITY ? 1 : 0);
  return [...items].sort(
    (a, b) =>
      workable(b) - workable(a) ||
      b.total - a.total ||
      b.evaluation.scores.curiosity.score - a.evaluation.scores.curiosity.score ||
      b.evaluation.scores.hookStrength.score - a.evaluation.scores.hookStrength.score,
  );
}

export async function runIdeation(input: { batchId: string; jobId: string; deps: PipelineDeps }) {
  const batch = await db.batch.findUniqueOrThrow({ where: { id: input.batchId }, include: { character: true } });
  const character = batch.character;
  const pricing = await getPricing();
  const models = await getModels();
  const preset = QUALITY_PRESETS[batch.quality];
  const writerModel = preset.writerModel === "main" ? models.main : models.fast;
  const reviewerModel = preset.reviewerModel === "main" ? models.main : models.fast;
  const parts = (await getDefaults()).partsPerStory;
  const cost: CostContext = { jobId: input.jobId, batchId: batch.id, budgetUsd: Number(batch.maxBudgetUsd), budgetScope: "batch" };

  // Retry safety: concepts already selected (and their stories) are kept.
  const alreadySelected = await db.concept.findMany({ where: { batchId: batch.id, status: "SELECTED" }, include: { story: { include: { episodes: true } } } });
  if (alreadySelected.length > 0) {
    const episodes = alreadySelected.flatMap((c) => c.story?.episodes ?? []).filter((e) => e.partNumber === 1);
    return { candidates: 0, duplicates: 0, evaluated: 0, selected: alreadySelected.length, episodeIds: episodes.map((e) => e.id), generationFailures: 0, resumed: true };
  }

  // ── 1. Generate candidates ───────────────────────────────────────────
  await setJobStage(input.jobId, "GENERATING_IDEAS", "Generating candidate concepts", 0.02);
  const existingStories = await db.story.findMany({ select: { title: true, premise: true, keywords: true }, orderBy: { createdAt: "desc" }, take: 500 });
  const target = batch.requestedCount * CANDIDATE_MULTIPLIER;
  const chunkSizes = chunk(Array.from({ length: target }), IDEATION_CHUNK).map((c) => c.length);
  const avoidTitles = existingStories.slice(0, 120).map((s) => s.title);

  let done = 0;
  const generated = await mapSettled(chunkSizes, 3, async (count) => {
    await assertNotCanceled(input.jobId);
    await assertWithinBudget(cost, 0.05);
    const result = await generateStructured({
      client: input.deps.text,
      pricing,
      model: writerModel,
      ...ideationPrompt({ category: batch.category, customDirection: batch.customDirection, count, avoidTitles, character: character ? toNarrator(character) : null, parts }),
      schema: ConceptBatchSchema,
      schemaName: "concept_batch",
      validate: (v) => (v.concepts.length < Math.ceil(count * 0.8) ? [`Return ${count} concepts (got ${v.concepts.length}).`] : []),
      cost: { ctx: cost, operation: "ideation" },
    });
    done += count;
    await setJobStage(input.jobId, "GENERATING_IDEAS", `Generated ${done} of ${target} candidates`, 0.02 + 0.3 * (done / target));
    return result.concepts;
  });
  const failures = generated.filter((r) => r.status === "rejected");
  const candidates: ConceptCandidate[] = generated.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
  if (candidates.length === 0) throw failures[0]?.reason ?? new Error("No concepts were generated.");

  // ── 2. Duplicate prevention ──────────────────────────────────────────
  const { unique, duplicates } = dedupeCandidates(candidates, existingStories);
  await db.concept.createMany({
    data: duplicates.map((d) => ({
      batchId: batch.id,
      title: d.candidate.title,
      normalizedTitle: normalizeTitle(d.candidate.title),
      premise: d.candidate.premise,
      logline: d.candidate.logline,
      category: d.candidate.category,
      keywords: d.candidate.keywords,
      seriesPotential: d.candidate.seriesPotential,
      status: "DUPLICATE" as const,
      duplicateOfTitle: d.duplicateOf.title,
      similarity: d.score,
    })),
  });

  // ── 3. Evaluate and rank ─────────────────────────────────────────────
  await setJobStage(input.jobId, "EVALUATING_CONCEPTS", `Scoring ${unique.length} unique concepts`, 0.35);
  const evalChunks = chunk(unique, EVALUATION_CHUNK);
  let scored = 0;
  const evaluations = await mapSettled(evalChunks, 3, async (group) => {
    await assertNotCanceled(input.jobId);
    await assertWithinBudget(cost, 0.05);
    const result = await generateStructured({
      client: input.deps.text,
      pricing,
      model: reviewerModel,
      ...evaluationPrompt({ concepts: group, existingTitles: avoidTitles, premise: batch.customDirection, parts }),
      schema: ConceptEvaluationSchema,
      schemaName: "concept_evaluation",
      validate: (v) => {
        const issues = v.evaluations.flatMap((e) => validateScores(e.scores).map((s) => `conceptIndex ${e.conceptIndex}: ${s}`));
        const seen = new Set(v.evaluations.map((e) => e.conceptIndex));
        for (let i = 0; i < group.length; i++) if (!seen.has(i)) issues.push(`Missing evaluation for conceptIndex ${i}.`);
        return issues;
      },
      cost: { ctx: cost, operation: "evaluation" },
    });
    scored += group.length;
    await setJobStage(input.jobId, "EVALUATING_CONCEPTS", `Scored ${scored} of ${unique.length}`, 0.35 + 0.3 * (scored / unique.length));
    return group.map((concept, i) => {
      const evaluation = result.evaluations.find((e) => e.conceptIndex === i)!;
      const scores = normalizeScores(evaluation.scores);
      return { concept, evaluation: { ...evaluation, scores }, total: totalScore(scores) };
    });
  });
  const evaluated = rankConcepts(evaluations.flatMap((r) => (r.status === "fulfilled" ? r.value : [])));
  if (evaluated.length === 0) {
    throw evaluations.find((r) => r.status === "rejected")?.reason ?? new Error("Concept evaluation failed.");
  }

  // ── 4. Persist ranking; selected concepts become stories ─────────────
  const selectedCount = Math.min(batch.requestedCount, evaluated.length);
  const conceptRows = await db.$transaction(
    evaluated.map((e, rank) =>
      db.concept.create({
        data: {
          batchId: batch.id,
          title: e.concept.title,
          normalizedTitle: normalizeTitle(e.concept.title),
          premise: e.concept.premise,
          logline: e.concept.logline,
          category: e.concept.category || batch.category,
          keywords: e.concept.keywords.map((k) => k.toLowerCase()),
          seriesPotential: e.concept.seriesPotential,
          storySeed: { archetype: e.concept.archetype, dramaticQuestion: e.concept.dramaticQuestion, beatSketch: e.concept.beatSketch },
          scores: { ...e.evaluation.scores, summary: e.evaluation.summary },
          totalScore: e.total,
          rank: rank + 1,
          status: rank < selectedCount ? "SELECTED" : "REJECTED",
        },
      }),
    ),
  );

  const selected = conceptRows.filter((c) => c.status === "SELECTED");
  const episodeIds: string[] = [];
  for (const c of selected) {
    const source = evaluated.find((e) => e.concept.title === c.title)?.concept;
    const story = await db.story.create({
      data: {
        title: c.title,
        normalizedTitle: c.normalizedTitle,
        category: c.category,
        premise: c.premise,
        logline: source?.openingSituation ? `${c.logline} Opening: ${source.openingSituation}` : c.logline,
        storySeed: c.storySeed ?? undefined,
        keywords: c.keywords,
        styleKey: batch.styleKey,
        voiceId: character?.voiceId ?? batch.voiceId,
        characterId: character?.id ?? null,
        targetDurationSec: batch.targetDurationSec,
        plannedParts: parts,
        quality: batch.quality,
        conceptId: c.id,
        bibles: {
          create: {
            version: 1,
            source: "concept",
            data: (() => {
              const bible = { ...emptyBible({ premise: c.premise, styleKey: batch.styleKey }), mysteries: source?.seriesPotential ? [source.seriesPotential] : [] };
              return character ? withCharacter(bible, character) : bible;
            })(),
          },
        },
        episodes: { create: { partNumber: 1, title: c.title } },
      },
      include: { episodes: true },
    });
    episodeIds.push(story.episodes[0].id);
  }

  return {
    candidates: candidates.length,
    duplicates: duplicates.length,
    evaluated: evaluated.length,
    selected: selected.length,
    episodeIds,
    generationFailures: failures.length,
    resumed: false,
  };
}
