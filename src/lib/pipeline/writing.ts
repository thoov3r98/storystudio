import { db } from "@/lib/db";
import { generateStructured } from "@/lib/ai/structured";
import {
  continuityPrompt,
  factReviewPrompt,
  hooksPrompt,
  revisionPrompt,
  sceneRewritePrompt,
  writerPrompt,
} from "@/lib/ai/prompts";
import { HookCandidatesSchema, normalizeScores, totalScore, validateScores } from "@/lib/schemas/concept";
import {
  type ContinuityReview,
  ContinuityReviewSchema,
  type EpisodeDraft,
  EpisodeDraftSchema,
  type EpisodeSpecRecord,
  type FactReview,
  FactReviewSchema,
  SceneNarrationRewriteSchema,
} from "@/lib/schemas/episode";
import { MOTION_PRESETS, QUALITY_PRESETS, sceneCountRange, targetWordRange } from "@/lib/constants";
import { countWords, DEFAULT_WORDS_PER_SECOND, estimateSpokenDuration, joinNarration, tokenize } from "@/lib/text";
import { getPricing, getModels, voiceWordsPerSecond } from "@/lib/settings";
import { assertWithinBudget, type CostContext } from "@/lib/costs/record";
import { approvedHistory, loadCanonicalBible, selectContinuationContext } from "./context";
import type { PipelineDeps } from "./deps";
import type { ClaimClassification, ClaimStatus, FactCheckStatus } from "@/generated/prisma/enums";

const MAX_REVISION_ROUNDS = 2;

export function validateDraft(draft: EpisodeDraft, opts: { durationSec: number; wordsPerSecond: number; hook: string }): string[] {
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
  const [minWords, maxWords] = targetWordRange(opts.durationSec, opts.wordsPerSecond);
  const words = countWords(joinNarration(draft.scenes));
  if (words < Math.floor(minWords * 0.9) || words > Math.ceil(maxWords * 1.1)) {
    issues.push(`Total narration must be ${minWords}–${maxWords} words; it is ${words}. ${words > maxWords ? "Tighten it." : "Develop the beats more."}`);
  }
  const hookTokens = tokenize(opts.hook).slice(0, 8);
  const hookStart = hookTokens.join(" ");
  const sceneStart = tokenize(draft.scenes[0]?.narration ?? "").slice(0, hookTokens.length).join(" ");
  if (hookStart && sceneStart !== hookStart) issues.push("Scene 1 narration must begin with the selected hook verbatim.");
  return issues;
}

type WriteContext = {
  episodeId: string;
  cost: CostContext;
  deps: PipelineDeps;
};

async function loadEpisodeSetup(episodeId: string) {
  const episode = await db.episode.findUniqueOrThrow({ where: { id: episodeId }, include: { story: true } });
  const story = episode.story;
  const bible = await loadCanonicalBible(story.id);
  const preset = QUALITY_PRESETS[story.quality];
  const models = await getModels();
  const pricing = await getPricing();
  const wps = (story.voiceId ? await voiceWordsPerSecond(story.voiceId) : null) ?? DEFAULT_WORDS_PER_SECOND;
  return {
    episode,
    story,
    bible,
    pricing,
    wps,
    writerModel: preset.writerModel === "main" ? models.main : models.fast,
    reviewerModel: preset.reviewerModel === "main" ? models.main : models.fast,
  };
}

/** Generates (or adds a new round of) scored hook candidates for an episode. */
export async function generateHooks(ctx: WriteContext & { count?: number }) {
  const { episode, story, bible, pricing, writerModel } = await loadEpisodeSetup(ctx.episodeId);
  const history = episode.partNumber > 1 ? await approvedHistory(story.id, episode.partNumber) : [];
  const concept = story.conceptId ? await db.concept.findUnique({ where: { id: story.conceptId } }) : null;
  const prompt = hooksPrompt({
    title: story.title,
    premise: story.premise,
    openingSituation: concept?.logline ?? story.logline ?? story.premise,
    factMode: story.factMode,
    partNumber: episode.partNumber,
    previously: episode.partNumber > 1 ? `${bible.data.arcSummary}\nLast episode: ${history.at(-1)?.summary ?? ""}` : undefined,
    count: ctx.count,
  });
  await assertWithinBudget(ctx.cost, 0.05);
  const result = await generateStructured({
    client: ctx.deps.text,
    pricing,
    model: writerModel,
    ...prompt,
    schema: HookCandidatesSchema,
    schemaName: "hook_candidates",
    validate: (v) => {
      const issues = v.hooks.flatMap((h, i) => validateScores(h.scores).map((s) => `hooks[${i}]: ${s}`));
      if (v.hooks.length < 3) issues.push("Write at least three hooks.");
      const types = new Set(v.hooks.map((h) => h.type));
      for (const t of ["RELATABLE", "SURPRISING_FACT", "IMMEDIATE_DANGER"] as const) if (!types.has(t)) issues.push(`Include a ${t} hook.`);
      return issues;
    },
    cost: { ctx: ctx.cost, operation: "hooks" },
  });

  const prevRound = await db.hook.aggregate({ where: { episodeId: episode.id }, _max: { round: true } });
  const round = (prevRound._max.round ?? 0) + 1;
  const ranked = result.hooks
    .map((h) => ({ ...h, scores: normalizeScores(h.scores) }))
    .map((h) => ({ ...h, total: totalScore(h.scores) }))
    .sort((a, b) => b.total - a.total);
  const hasPrimary = (await db.hook.count({ where: { episodeId: episode.id, isPrimary: true } })) > 0;

  await db.hook.createMany({
    data: ranked.map((h, i) => ({
      episodeId: episode.id,
      type: h.type,
      text: h.text.trim(),
      scores: h.scores,
      totalScore: h.total,
      rationale: h.rationale,
      isPrimary: !hasPrimary && i === 0,
      round,
    })),
  });
  return { round, count: ranked.length };
}

async function primaryHook(episodeId: string): Promise<string | null> {
  const hook = await db.hook.findFirst({ where: { episodeId, isPrimary: true } });
  return hook?.text ?? null;
}

function claimStatusFor(assessment: FactReview["claims"][number]["assessment"]): ClaimStatus {
  switch (assessment) {
    case "widely-documented":
      return "SUPPORTED";
    case "fictional-framed":
      return "SUPPORTED";
    case "plausible-unverified":
      return "FLAGGED";
    case "dubious":
    case "presented-as-fact-but-unsupported":
      return "FLAGGED";
  }
}

function factIssuesFrom(review: FactReview): string[] {
  return review.claims
    .filter((c) => c.assessment === "dubious" || c.assessment === "presented-as-fact-but-unsupported")
    .map((c) => `Scene ${c.sceneNumber}: unsupported claim "${c.claim}". ${c.suggestedRevision ? `Suggested: ${c.suggestedRevision}` : "Remove the unsupported specificity."}`);
}

function continuityIssuesFrom(review: ContinuityReview | null): string[] {
  if (!review) return [];
  return review.issues
    .filter((i) => i.severity === "material")
    .map((i) => `Continuity (${i.type}${i.sceneNumber ? `, scene ${i.sceneNumber}` : ""}): ${i.description} Fix: ${i.suggestedFix}`);
}

export type WriteResult = { versionId: string; materialConflicts: string[]; factCheckStatus: FactCheckStatus };

/**
 * Writes a complete new script version for an episode: draft → fact review →
 * continuity review (Part 2+) → up to two correction rounds → persist.
 * The proposed bible update is stored as a pending proposal, never applied here.
 */
export async function writeEpisode(ctx: WriteContext & { reason: string; hookText?: string | null; direction?: string | null }): Promise<WriteResult> {
  const setup = await loadEpisodeSetup(ctx.episodeId);
  const { episode, story, bible, pricing, wps, writerModel, reviewerModel } = setup;

  let hook = ctx.hookText ?? (await primaryHook(episode.id));
  if (!hook) {
    await generateHooks(ctx);
    hook = await primaryHook(episode.id);
  }
  if (!hook) throw new Error("No opening hook available for this episode.");

  const history = episode.partNumber > 1 ? await approvedHistory(story.id, episode.partNumber) : [];
  const selected = selectContinuationContext(history);

  const writer = writerPrompt({
    storyId: story.id,
    title: story.title,
    premise: story.premise,
    factMode: story.factMode,
    partNumber: episode.partNumber,
    durationSec: story.targetDurationSec,
    wordsPerSecond: wps,
    hook,
    bible: bible.data,
    previousEpisodes: selected.previousEpisodes,
    latestEpisode: selected.latestEpisode,
    direction: ctx.direction,
  });

  const validate = (d: EpisodeDraft) => validateDraft(d, { durationSec: story.targetDurationSec, wordsPerSecond: wps, hook: hook! });

  await assertWithinBudget(ctx.cost, 0.25);
  let draft = await generateStructured({
    client: ctx.deps.text,
    pricing,
    model: writerModel,
    ...writer,
    schema: EpisodeDraftSchema,
    schemaName: "episode_draft",
    validate,
    cost: { ctx: ctx.cost, operation: "write-episode" },
  });

  let factReview: FactReview;
  let continuityReview: ContinuityReview | null = null;
  let round = 0;

  for (;;) {
    factReview = await generateStructured({
      client: ctx.deps.text,
      pricing,
      model: reviewerModel,
      ...factReviewPrompt({
        title: draft.title,
        factMode: story.factMode,
        narrationByScene: draft.scenes.map((s) => ({ sceneNumber: s.sceneNumber, narration: s.narration })),
        declaredClaims: draft.claims,
      }),
      schema: FactReviewSchema,
      schemaName: "fact_review",
      cost: { ctx: ctx.cost, operation: "fact-review" },
    });

    if (episode.partNumber > 1) {
      continuityReview = await generateStructured({
        client: ctx.deps.text,
        pricing,
        model: reviewerModel,
        ...continuityPrompt({
          bible: bible.data,
          previousSummaries: history.map((h) => `Part ${h.partNumber}: ${h.summary}`),
          draftSummary: draft.summary,
          narrationByScene: draft.scenes.map((s) => ({ sceneNumber: s.sceneNumber, narration: s.narration })),
          partNumber: episode.partNumber,
        }),
        schema: ContinuityReviewSchema,
        schemaName: "continuity_review",
        cost: { ctx: ctx.cost, operation: "continuity-review" },
      });
    }

    const factIssues = factIssuesFrom(factReview);
    const continuityIssues = continuityIssuesFrom(continuityReview);
    if ((factIssues.length === 0 && continuityIssues.length === 0) || round >= MAX_REVISION_ROUNDS) break;

    round++;
    await assertWithinBudget(ctx.cost, 0.2);
    draft = await generateStructured({
      client: ctx.deps.text,
      pricing,
      model: writerModel,
      ...revisionPrompt({ draftJson: JSON.stringify(draft), factIssues, continuityIssues, lengthIssues: [] }),
      schema: EpisodeDraftSchema,
      schemaName: "episode_draft",
      validate,
      cost: { ctx: ctx.cost, operation: `revise-episode-${round}` },
    });
  }

  const materialConflicts = continuityIssuesFrom(continuityReview);
  const unresolvedFacts = factReview.claims.filter((c) => c.assessment !== "widely-documented" && c.assessment !== "fictional-framed");
  const factCheckStatus: FactCheckStatus = unresolvedFacts.length === 0 ? "PASSED" : "NEEDS_REVIEW";

  const alternativeHooks = (await db.hook.findMany({ where: { episodeId: episode.id }, orderBy: { totalScore: "desc" } }))
    .map((h) => h.text)
    .filter((t) => t !== hook);

  const versionId = await persistVersion({
    episodeId: episode.id,
    storyId: story.id,
    partNumber: episode.partNumber,
    styleKey: story.styleKey,
    reason: ctx.reason,
    parentVersionId: episode.currentVersionId,
    draft,
    hook,
    alternativeHooks,
    wps,
    factReview,
    factCheckStatus,
    continuityReview,
    baseBibleVersion: bible.version,
  });

  await db.episode.update({
    where: { id: episode.id },
    data: { title: draft.title, status: "SCRIPTED", currentVersionId: versionId },
  });
  await db.story.update({ where: { id: story.id }, data: { lastActivityAt: new Date() } });

  return { versionId, materialConflicts, factCheckStatus };
}

const classificationMap: Record<string, ClaimClassification> = {
  ESTABLISHED_FACT: "ESTABLISHED_FACT",
  PLAUSIBLE_EXAMPLE: "PLAUSIBLE_EXAMPLE",
  FICTIONAL: "FICTIONAL",
  NEEDS_VERIFICATION: "NEEDS_VERIFICATION",
};

async function persistVersion(input: {
  episodeId: string;
  storyId: string;
  partNumber: number;
  styleKey: string;
  reason: string;
  parentVersionId: string | null;
  draft: EpisodeDraft;
  hook: string;
  alternativeHooks: string[];
  wps: number;
  factReview: FactReview;
  factCheckStatus: FactCheckStatus;
  continuityReview: ContinuityReview | null;
  baseBibleVersion: number;
}): Promise<string> {
  const narration = joinNarration(input.draft.scenes);
  const wordCount = countWords(narration);
  const estimatedDurationSec = estimateSpokenDuration(narration, input.wps);
  const { scenes, ...rest } = input.draft;
  const spec: EpisodeSpecRecord = {
    ...rest,
    selectedHook: input.hook,
    storyId: input.storyId,
    partNumber: input.partNumber,
    alternativeHooks: input.alternativeHooks,
    narration,
    wordCount,
    estimatedDurationSec,
    factCheckStatus: input.factCheckStatus,
  };

  return db.$transaction(async (tx) => {
    const last = await tx.episodeVersion.aggregate({ where: { episodeId: input.episodeId }, _max: { version: true } });
    if (input.parentVersionId) {
      await tx.episodeVersion.updateMany({ where: { id: input.parentVersionId, status: "DRAFT" }, data: { status: "SUPERSEDED" } });
    }
    const version = await tx.episodeVersion.create({
      data: {
        episodeId: input.episodeId,
        version: (last._max.version ?? 0) + 1,
        parentVersionId: input.parentVersionId,
        reason: input.reason,
        spec,
        narration,
        wordCount,
        estimatedDurationSec,
        summary: input.draft.summary,
        factCheckStatus: input.factCheckStatus,
        factReview: input.factReview,
        continuityReview: input.continuityReview ?? undefined,
        styleKey: input.styleKey,
        scenes: {
          create: scenes.map((s) => ({
            sceneNumber: s.sceneNumber,
            narration: s.narration.trim(),
            imagePrompt: s.imagePrompt,
            composition: s.composition,
            characters: s.characters,
            objects: s.objects,
            intendedDurationSec: s.intendedDurationSec,
            motionPreset: s.motionPreset,
          })),
        },
      },
    });

    await tx.factClaim.createMany({
      data: input.factReview.claims.map((c) => ({
        storyId: input.storyId,
        episodeVersionId: version.id,
        claim: c.claim,
        classification: classificationMap[c.classification] ?? "NEEDS_VERIFICATION",
        status: claimStatusFor(c.assessment),
        reasoning: `${c.assessment}: ${c.reasoning}${c.suggestedRevision ? ` Suggested revision: ${c.suggestedRevision}` : ""}`,
        references: c.verificationHints,
      })),
    });

    await tx.bibleUpdateProposal.updateMany({
      where: { storyId: input.storyId, status: "PENDING", episodeVersion: { episodeId: input.episodeId } },
      data: { status: "SUPERSEDED", resolvedAt: new Date() },
    });
    await tx.bibleUpdateProposal.create({
      data: { storyId: input.storyId, episodeVersionId: version.id, baseBibleVersion: input.baseBibleVersion, update: input.draft.bibleUpdate },
    });

    return version.id;
  });
}

/** Rewrites one scene's narration (and image prompt) into a new forked version. */
export async function rewriteScene(ctx: WriteContext & { sceneNumber: number; instruction?: string | null }) {
  const setup = await loadEpisodeSetup(ctx.episodeId);
  const version = await db.episodeVersion.findUniqueOrThrow({
    where: { id: setup.episode.currentVersionId ?? "" },
    include: { scenes: { orderBy: { sceneNumber: "asc" } } },
  });
  const idx = version.scenes.findIndex((s) => s.sceneNumber === ctx.sceneNumber);
  if (idx < 0) throw new Error(`Scene ${ctx.sceneNumber} not found.`);
  const scene = version.scenes[idx];

  await assertWithinBudget(ctx.cost, 0.05);
  const rewrite = await generateStructured({
    client: ctx.deps.text,
    pricing: setup.pricing,
    model: setup.writerModel,
    ...sceneRewritePrompt({
      title: setup.episode.title,
      sceneNumber: scene.sceneNumber,
      before: version.scenes[idx - 1]?.narration ?? "",
      current: scene.narration,
      after: version.scenes[idx + 1]?.narration ?? "",
      instruction: ctx.instruction,
      bible: setup.bible.data,
    }),
    schema: SceneNarrationRewriteSchema,
    schemaName: "scene_rewrite",
    validate: (v) => {
      const before = countWords(scene.narration);
      const after = countWords(v.narration);
      return after > before * 1.3 + 3 || after < before * 0.6 ? [`Keep the scene within ±15% of ${before} words (got ${after}).`] : [];
    },
    cost: { ctx: ctx.cost, operation: "rewrite-scene" },
  });

  const { forkVersion } = await import("./versions");
  const imagePromptChanged = rewrite.imagePrompt.trim() !== scene.imagePrompt.trim();
  const newVersionId = await forkVersion(version.id, {
    reason: `edit-scene-${scene.sceneNumber}`,
    keepVoiceover: false,
    sceneOverrides: {
      [scene.sceneNumber]: {
        narration: rewrite.narration.trim(),
        imagePrompt: rewrite.imagePrompt,
        composition: rewrite.composition,
        dropImage: imagePromptChanged,
      },
    },
    resetFactCheck: true,
  });
  return { versionId: newVersionId, imagePromptChanged };
}

/** Re-runs the fact review on an existing version (used after hook swaps and scene rewrites). */
export async function reviewVersionFacts(ctx: WriteContext & { versionId: string }) {
  const setup = await loadEpisodeSetup(ctx.episodeId);
  const version = await db.episodeVersion.findUniqueOrThrow({
    where: { id: ctx.versionId },
    include: { scenes: { orderBy: { sceneNumber: "asc" } } },
  });
  const spec = version.spec as Partial<EpisodeSpecRecord>;
  const review = await generateStructured({
    client: ctx.deps.text,
    pricing: setup.pricing,
    model: setup.reviewerModel,
    ...factReviewPrompt({
      title: setup.episode.title,
      factMode: setup.story.factMode,
      narrationByScene: version.scenes.map((s) => ({ sceneNumber: s.sceneNumber, narration: s.narration })),
      declaredClaims: spec.claims ?? [],
    }),
    schema: FactReviewSchema,
    schemaName: "fact_review",
    cost: { ctx: ctx.cost, operation: "fact-review" },
  });
  const unresolved = review.claims.filter((c) => c.assessment !== "widely-documented" && c.assessment !== "fictional-framed");
  const factCheckStatus: FactCheckStatus = unresolved.length === 0 ? "PASSED" : "NEEDS_REVIEW";
  await db.$transaction([
    db.factClaim.deleteMany({ where: { episodeVersionId: version.id } }),
    db.factClaim.createMany({
      data: review.claims.map((c) => ({
        storyId: setup.story.id,
        episodeVersionId: version.id,
        claim: c.claim,
        classification: classificationMap[c.classification] ?? "NEEDS_VERIFICATION",
        status: claimStatusFor(c.assessment),
        reasoning: `${c.assessment}: ${c.reasoning}${c.suggestedRevision ? ` Suggested revision: ${c.suggestedRevision}` : ""}`,
        references: c.verificationHints,
      })),
    }),
    db.episodeVersion.update({ where: { id: version.id }, data: { factReview: review, factCheckStatus, spec: { ...spec, factCheckStatus } } }),
  ]);
  return factCheckStatus;
}
