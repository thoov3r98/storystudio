import { db } from "@/lib/db";
import { generateStructured } from "@/lib/ai/structured";
import { sceneRewritePrompt, type WriterInput } from "@/lib/ai/prompts";
import type { Plot, QualityRecord } from "@/lib/schemas/story-plan";
import { type EpisodeDraft, type EpisodeSpecRecord, SceneNarrationRewriteSchema } from "@/lib/schemas/episode";
import { countWords, DEFAULT_WORDS_PER_SECOND, estimateSpokenDuration, joinNarration } from "@/lib/text";
import { getAudioMix, getPricing, getModels, scriptModels, voiceWordsPerSecond } from "@/lib/settings";
import { assertWithinBudget, type CostContext } from "@/lib/costs/record";
import { setJobStage } from "@/lib/jobs";
import { type ComposeDeps, type ComposeInput, type ComposeResult, composeScript, recheckScript, reviseComposed, type ScriptState } from "@/lib/story/compose";
import { BUILT_IN_REFERENCES, type ReferenceStory } from "@/lib/story/references";
import { approvedHistory, loadCanonicalBible, selectContinuationContext } from "./context";
import type { PipelineDeps } from "./deps";
import { toNarrator } from "./characters";

export { validateDraft } from "@/lib/story/compose";

type WriteContext = {
  episodeId: string;
  jobId?: string;
  cost: CostContext;
  deps: PipelineDeps;
};

async function loadEpisodeSetup(episodeId: string) {
  const episode = await db.episode.findUniqueOrThrow({ where: { id: episodeId }, include: { story: { include: { character: true } } } });
  const story = episode.story;
  const bible = await loadCanonicalBible(story.id);
  const models = await getModels();
  const pricing = await getPricing();
  // The render-time speed-up shortens the video, so scripts are sized for the faster rate.
  const { narrationSpeed } = await getAudioMix();
  const wps = ((story.voiceId ? await voiceWordsPerSecond(story.voiceId) : null) ?? DEFAULT_WORDS_PER_SECOND) * narrationSpeed;
  return { episode, story, bible, pricing, wps, ...scriptModels(story.quality, models) };
}

type Setup = Awaited<ReturnType<typeof loadEpisodeSetup>>;

/** Built-in examples plus the producer's own active reference stories. */
export async function loadReferences(): Promise<ReferenceStory[]> {
  const rows = await db.referenceStory.findMany({ where: { active: true }, orderBy: { createdAt: "desc" }, take: 50 });
  return [
    ...rows.map((r) => ({ ...r, archetype: r.archetype as ReferenceStory["archetype"], source: "producer" as const })),
    ...BUILT_IN_REFERENCES,
  ];
}

async function composeContext(ctx: WriteContext, setup: Setup, direction?: string | null): Promise<{ input: ComposeInput; deps: ComposeDeps }> {
  const { episode, story, bible } = setup;
  const history = episode.partNumber > 1 ? await approvedHistory(story.id, episode.partNumber) : [];
  const selected = selectContinuationContext(history);
  const writerInput: WriterInput = {
    storyId: story.id,
    title: story.title,
    premise: story.premise,
    partNumber: episode.partNumber,
    durationSec: story.targetDurationSec,
    wordsPerSecond: setup.wps,
    narrator: story.character ? toNarrator(story.character) : null,
    bible: bible.data,
    previousEpisodes: selected.previousEpisodes,
    latestEpisode: selected.latestEpisode,
    direction,
  };
  return {
    input: {
      ...writerInput,
      seed: (story.storySeed ?? null) as ComposeInput["seed"],
      series: episode.partNumber > 1 ? { bible: bible.data, previousSummaries: history.map((h) => `Part ${h.partNumber}: ${h.summary}`) } : null,
    },
    deps: {
      text: ctx.deps.text,
      pricing: setup.pricing,
      writer: setup.writer,
      reviewer: setup.reviewer,
      references: await loadReferences(),
      cost: ctx.cost,
      checkBudget: (usd) => assertWithinBudget(ctx.cost, usd),
      onStage: ctx.jobId ? (label, progress) => setJobStage(ctx.jobId!, "WRITING_STORY", label, progress * 0.3) : undefined,
    },
  };
}

export type WriteResult = { versionId: string; quality: QualityRecord };

/**
 * Writes a complete new script version for an episode with the planned,
 * verified pipeline (see docs/story-quality.md) and stops at the script gate.
 * The proposed bible update is stored as a pending proposal, never applied here.
 */
export async function writeEpisode(ctx: WriteContext & { reason: string; direction?: string | null }): Promise<WriteResult> {
  const setup = await loadEpisodeSetup(ctx.episodeId);
  const { input, deps } = await composeContext(ctx, setup, ctx.direction);
  const result = await composeScript(input, deps);
  return saveComposed(ctx, setup, result, ctx.reason);
}

/** Fixes the open issues flagged on the current script with targeted revisions, as a new version. */
export async function reviseEpisode(ctx: WriteContext): Promise<WriteResult> {
  const setup = await loadEpisodeSetup(ctx.episodeId);
  const version = await db.episodeVersion.findUniqueOrThrow({ where: { id: setup.episode.currentVersionId ?? "" } });
  const spec = version.spec as EpisodeSpecRecord;
  if (!spec.plot || !spec.quality) throw new Error("This script was written before the quality checks. Regenerate it instead.");
  const { input, deps } = await composeContext(ctx, setup);
  const result = await reviseComposed(input, deps, { state: scriptState(spec, version.narration), quality: spec.quality });
  return saveComposed(ctx, setup, result, "revise-issues");
}

function scriptState(spec: EpisodeSpecRecord, narration: string): ScriptState {
  return {
    plot: spec.plot!,
    hook: spec.selectedHook,
    hookPromise: spec.quality?.hooks?.pick.promise ?? "",
    title: spec.title,
    narration,
    summary: spec.summary,
    keyReveals: spec.keyReveals,
    unresolvedQuestions: spec.unresolvedQuestions,
  };
}

async function saveComposed(ctx: WriteContext, setup: Setup, result: ComposeResult, reason: string): Promise<WriteResult> {
  const { episode, story } = setup;
  const versionId = await persistVersion({
    episodeId: episode.id,
    storyId: story.id,
    partNumber: episode.partNumber,
    styleKey: story.styleKey,
    reason,
    parentVersionId: episode.currentVersionId,
    draft: result.draft,
    wps: setup.wps,
    baseBibleVersion: setup.bible.version,
    plot: result.plot,
    quality: result.quality,
  });
  await db.episode.update({ where: { id: episode.id }, data: { title: result.draft.title, status: "SCRIPTED", currentVersionId: versionId } });
  await db.story.update({ where: { id: story.id }, data: { lastActivityAt: new Date() } });
  return { versionId, quality: result.quality };
}

async function persistVersion(input: {
  episodeId: string;
  storyId: string;
  partNumber: number;
  styleKey: string;
  reason: string;
  parentVersionId: string | null;
  draft: EpisodeDraft;
  wps: number;
  baseBibleVersion: number;
  plot: Plot;
  quality: QualityRecord;
}): Promise<string> {
  const narration = joinNarration(input.draft.scenes);
  const wordCount = countWords(narration);
  const estimatedDurationSec = estimateSpokenDuration(narration, input.wps);
  const { scenes, ...rest } = input.draft;
  const spec: EpisodeSpecRecord = {
    ...rest,
    storyId: input.storyId,
    partNumber: input.partNumber,
    narration,
    wordCount,
    estimatedDurationSec,
    factCheckStatus: "PASSED",
    plot: input.plot,
    quality: input.quality,
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
        // Fact checking is off; versions are written as passed so nothing waits on it.
        factCheckStatus: "PASSED",
        qualityStatus: input.quality.status,
        styleKey: input.styleKey,
        scenes: {
          create: scenes.map((s) => ({
            sceneNumber: s.sceneNumber,
            narration: s.narration.trim(),
            imagePrompt: s.imagePrompt,
            composition: s.composition,
            continuity: s.continuity,
            characters: s.characters,
            objects: s.objects,
            // Planned length from the word count; real timing comes from the voiceover.
            intendedDurationSec: estimateSpokenDuration(s.narration, input.wps),
            motionPreset: s.motionPreset,
          })),
        },
      },
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
    model: setup.writer,
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
  });
  await recheckVersion(ctx, setup, newVersionId);
  return { versionId: newVersionId, imagePromptChanged };
}

/** A hand edit can open a plot hole, so the edited script is checked again (logic and editorial) and its gate status updated. */
async function recheckVersion(ctx: WriteContext, setup: Setup, versionId: string) {
  const version = await db.episodeVersion.findUniqueOrThrow({ where: { id: versionId } });
  const spec = version.spec as EpisodeSpecRecord;
  if (!spec.plot || !spec.quality) return;
  const { input, deps } = await composeContext(ctx, setup);
  const quality = await recheckScript(input, deps, scriptState(spec, version.narration), spec.quality);
  await db.episodeVersion.update({ where: { id: versionId }, data: { spec: { ...spec, quality }, qualityStatus: quality.status } });
}
