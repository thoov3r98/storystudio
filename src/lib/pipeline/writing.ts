import { db } from "@/lib/db";
import { generateStructured } from "@/lib/ai/structured";
import { sceneRewritePrompt } from "@/lib/ai/process-prompts";
import type { QualityRecord } from "@/lib/schemas/quality";
import { type EpisodeDraft, type EpisodeSpecRecord, SceneNarrationRewriteSchema } from "@/lib/schemas/episode";
import { countWords, DEFAULT_WORDS_PER_SECOND, estimateSpokenDuration, joinNarration } from "@/lib/text";
import { getAudioMix, getPricing, getModels, scriptModels, voiceWordsPerSecond } from "@/lib/settings";
import { assertWithinBudget, type CostContext } from "@/lib/costs/record";
import { setJobStage } from "@/lib/jobs";
import { composeProcess, composeProcessPart, type ProcessDeps, type ProcessInput, type ProcessResult, recheckProcessPart, researchProcess, reviseProcessPart } from "@/lib/process/compose";
import { type ProcessSpec, type ResearchRecord, ResearchRecordSchema } from "@/lib/schemas/process";
import type { PipelineDeps } from "./deps";
import { channelGuide } from "./channels";

export { validateDraft } from "@/lib/process/script";

type WriteContext = {
  episodeId: string;
  jobId?: string;
  cost: CostContext;
  deps: PipelineDeps;
};

async function loadEpisodeSetup(episodeId: string) {
  const episode = await db.episode.findUniqueOrThrow({ where: { id: episodeId }, include: { story: { include: { channel: true } } } });
  const story = episode.story;
  if (!story.channel) throw new Error("This story belongs to no channel, so it can't be written.");
  const models = await getModels();
  const pricing = await getPricing();
  // The render-time speed-up shortens the video, so scripts are sized for the faster rate.
  const { narrationSpeed } = await getAudioMix();
  const wps = ((story.voiceId ? await voiceWordsPerSecond(story.voiceId) : null) ?? DEFAULT_WORDS_PER_SECOND) * narrationSpeed;
  return { episode, story, channel: story.channel, guide: channelGuide(story.channel), pricing, wps, ...scriptModels(story.quality, models) };
}

type Setup = Awaited<ReturnType<typeof loadEpisodeSetup>>;

export type WriteResult = { versionId: string; quality: QualityRecord; parts?: number };

/**
 * Once the planner has chosen how many parts a story has, its episodes match:
 * unproduced episodes beyond the new count (from an earlier, longer plan) are removed.
 */
async function settlePartCount(storyId: string, count: number) {
  await db.episode.deleteMany({ where: { storyId, partNumber: { gt: count }, status: { in: ["DRAFT", "SCRIPTED", "FAILED"] } } });
  await db.story.update({ where: { id: storyId }, data: { plannedParts: count } });
}

function processContext(ctx: WriteContext, setup: Setup): { input: ProcessInput; deps: ProcessDeps } {
  const { story, channel } = setup;
  const seed = (story.storySeed ?? null) as { beatSketch?: string | null } | null;
  return {
    input: {
      channel: setup.guide,
      title: story.title,
      premise: story.premise,
      durationSec: story.targetDurationSec,
      wordsPerSecond: setup.wps,
      arc: seed?.beatSketch ?? null,
      parts: [channel.minParts, channel.maxParts],
    },
    deps: {
      text: ctx.deps.text,
      research: ctx.deps.research,
      pricing: setup.pricing,
      writer: setup.writer,
      reviewer: setup.reviewer,
      cost: ctx.cost,
      checkBudget: (usd) => assertWithinBudget(ctx.cost, usd),
      onStage: ctx.jobId ? (label, progress) => setJobStage(ctx.jobId!, "WRITING_STORY", label, progress * 0.3) : undefined,
    },
  };
}

function storedResearch(story: { research: unknown }): ResearchRecord | null {
  const parsed = ResearchRecordSchema.safeParse(story.research);
  return parsed.success ? parsed.data : null;
}

/** The saved part plan of a process explainer and each part's current script. */
async function loadProcessPlan(storyId: string) {
  const episodes = await db.episode.findMany({ where: { storyId }, orderBy: { partNumber: "asc" }, include: { currentVersion: true } });
  const process = episodes.map((e) => (e.currentVersion?.spec as EpisodeSpecRecord | undefined)?.process).find(Boolean);
  return process ? { plan: process.plan, episodes } : null;
}

/**
 * Writes scripts and stops at the script gate. Part 1 researches the product
 * (once; the notes are kept on the story), plans every part and writes them
 * all, each its own episode. A later part, or Part 1 without replanning, is
 * rewritten from the saved research and plan.
 */
export async function writeEpisode(ctx: WriteContext & { reason: string; replanStory?: boolean }): Promise<WriteResult> {
  const setup = await loadEpisodeSetup(ctx.episodeId);
  const { episode, story } = setup;
  const { input, deps } = processContext(ctx, setup);
  const saved = await loadProcessPlan(story.id);
  let research = storedResearch(story);

  if (saved && research && !(episode.partNumber === 1 && ctx.replanStory) && episode.partNumber <= saved.plan.parts.length) {
    const earlier = saved.episodes.filter((e) => e.partNumber < episode.partNumber).map((e) => e.currentVersion?.narration ?? "");
    const result = await composeProcessPart(input, deps, { research, plan: saved.plan, part: episode.partNumber, earlier });
    return saveProcessPart(setup, episode, result, ctx.reason);
  }
  if (episode.partNumber !== 1) throw new Error("Write Part 1 first: it researches the product and plans every part.");
  const produced = saved?.episodes.filter((e) => !["DRAFT", "SCRIPTED", "FAILED"].includes(e.status)) ?? [];
  if (produced.length) throw new Error(`Part ${produced[0].partNumber} has already been produced, so the series can't be replanned. Rewrite individual parts instead.`);

  if (!research) {
    research = await researchProcess(input, deps);
    // Kept even if writing fails, so a retry doesn't pay for the search again.
    await db.story.update({ where: { id: story.id }, data: { research } });
  }
  const { results } = await composeProcess(input, deps, { research });
  await settlePartCount(story.id, results.length);
  let first: WriteResult | null = null;
  for (const result of results) {
    const target =
      result.part === 1
        ? episode
        : ((await db.episode.findFirst({ where: { storyId: story.id, partNumber: result.part } })) ??
          (await db.episode.create({ data: { storyId: story.id, partNumber: result.part, title: result.draft.title } })));
    const saved = await saveProcessPart(setup, target, result, ctx.reason);
    first ??= saved;
  }
  return { ...first!, parts: results.length };
}

function saveProcessPart(setup: Setup, episode: { id: string; partNumber: number; currentVersionId: string | null }, result: ProcessResult, reason: string) {
  return saveComposed(setup, episode, { draft: result.draft, quality: result.quality, process: { plan: result.plan, part: result.part } }, reason);
}

/** What revising or re-checking a saved process part needs. */
async function processPartState(setup: Setup, spec: EpisodeSpecRecord, narration: string) {
  const research = storedResearch(setup.story);
  if (!research || !spec.process || !spec.quality) throw new Error("This script has no saved research. Regenerate it instead.");
  const { part, plan } = spec.process;
  const eps = await db.episode.findMany({ where: { storyId: setup.story.id, partNumber: { lt: part } }, orderBy: { partNumber: "asc" }, include: { currentVersion: { select: { narration: true } } } });
  return { research, plan, part, earlier: eps.map((e) => e.currentVersion?.narration ?? ""), title: spec.title, narration, summary: spec.summary, quality: spec.quality };
}

/** Fixes the open issues flagged on the current script with targeted revisions, as a new version. */
export async function reviseEpisode(ctx: WriteContext): Promise<WriteResult> {
  const setup = await loadEpisodeSetup(ctx.episodeId);
  const version = await db.episodeVersion.findUniqueOrThrow({ where: { id: setup.episode.currentVersionId ?? "" } });
  const spec = version.spec as EpisodeSpecRecord;
  const { input, deps } = processContext(ctx, setup);
  const result = await reviseProcessPart(input, deps, await processPartState(setup, spec, version.narration));
  return saveProcessPart(setup, setup.episode, result, "revise-issues");
}

type Composed = Pick<ProcessResult, "draft" | "quality"> & { process: ProcessSpec };

async function saveComposed(setup: Setup, episode: { id: string; partNumber: number; currentVersionId: string | null }, result: Composed, reason: string): Promise<WriteResult> {
  const { story } = setup;
  const versionId = await persistVersion({
    episodeId: episode.id,
    storyId: story.id,
    partNumber: episode.partNumber,
    styleKey: story.styleKey,
    reason,
    parentVersionId: episode.currentVersionId,
    draft: result.draft,
    wps: setup.wps,
    process: result.process,
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
  process: ProcessSpec;
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
    process: input.process,
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
      channel: setup.guide,
      title: setup.episode.title,
      sceneNumber: scene.sceneNumber,
      before: version.scenes[idx - 1]?.narration ?? "",
      current: scene.narration,
      after: version.scenes[idx + 1]?.narration ?? "",
      instruction: ctx.instruction,
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

/** A hand edit can introduce a mistake, so the edited script is fact-checked again and its gate status updated. */
async function recheckVersion(ctx: WriteContext, setup: Setup, versionId: string) {
  const version = await db.episodeVersion.findUniqueOrThrow({ where: { id: versionId } });
  const spec = version.spec as EpisodeSpecRecord;
  if (!spec.process || !spec.quality) return;
  const { input, deps } = processContext(ctx, setup);
  const quality = await recheckProcessPart(input, deps, await processPartState(setup, spec, version.narration));
  await db.episodeVersion.update({ where: { id: versionId }, data: { spec: { ...spec, quality }, qualityStatus: quality.status } });
}
