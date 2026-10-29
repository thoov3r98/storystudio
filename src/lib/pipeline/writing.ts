import { db } from "@/lib/db";
import { generateStructured } from "@/lib/ai/structured";
import { sceneRewritePrompt, type WriterInput } from "@/lib/ai/prompts";
import type { Plot, QualityRecord } from "@/lib/schemas/story-plan";
import { type EpisodeDraft, type EpisodeSpecRecord, SceneNarrationRewriteSchema } from "@/lib/schemas/episode";
import { countWords, DEFAULT_WORDS_PER_SECOND, estimateSpokenDuration, joinNarration } from "@/lib/text";
import { getAudioMix, getPricing, getModels, scriptModels, voiceWordsPerSecond } from "@/lib/settings";
import { assertWithinBudget, type CostContext } from "@/lib/costs/record";
import { setJobStage } from "@/lib/jobs";
import { type ComposeDeps, type ComposeInput, type ComposeResult, composePart, composeScript, composeStory, recheckScript, reviseComposed, type ScriptState } from "@/lib/story/compose";
import { partBrief } from "@/lib/ai/story-prompts";
import { BUILT_IN_REFERENCES, type ReferenceStory } from "@/lib/story/references";
import { composeProcess, composeProcessPart, type ProcessDeps, type ProcessInput, type ProcessResult, recheckProcessPart, researchProcess, reviseProcessPart } from "@/lib/process/compose";
import { type ProcessSpec, type ResearchRecord, ResearchRecordSchema } from "@/lib/schemas/process";
import { approvedHistory, loadCanonicalBible, selectContinuationContext } from "./context";
import type { PipelineDeps } from "./deps";
import { toNarrator } from "./characters";
import { channelGuide } from "./channels";

export { validateDraft } from "@/lib/story/compose";

type WriteContext = {
  episodeId: string;
  jobId?: string;
  cost: CostContext;
  deps: PipelineDeps;
};

async function loadEpisodeSetup(episodeId: string) {
  const episode = await db.episode.findUniqueOrThrow({ where: { id: episodeId }, include: { story: { include: { character: true, channel: true } } } });
  const story = episode.story;
  const bible = await loadCanonicalBible(story.id);
  const models = await getModels();
  const pricing = await getPricing();
  // The render-time speed-up shortens the video, so scripts are sized for the faster rate.
  const { narrationSpeed } = await getAudioMix();
  const wps = ((story.voiceId ? await voiceWordsPerSecond(story.voiceId) : null) ?? DEFAULT_WORDS_PER_SECOND) * narrationSpeed;
  const channel = story.channel ? channelGuide(story.channel) : null;
  return { episode, story, bible, pricing, wps, channel, ...scriptModels(story.quality, models) };
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
    // The channel decides who narrates, whatever the character's own default is.
    narrator: story.character ? { ...toNarrator(story.character), perspective: story.channel?.perspective ?? story.character.perspective } : null,
    bible: bible.data,
    previousEpisodes: selected.previousEpisodes,
    latestEpisode: selected.latestEpisode,
    direction,
    channel: setup.channel,
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

export type WriteResult = { versionId: string; quality: QualityRecord; parts?: number };

/** The saved multi-part plan for this story, if Part 1 was written as one: the plot and each part's current script. */
async function loadStoryPlan(storyId: string) {
  const episodes = await db.episode.findMany({ where: { storyId }, orderBy: { partNumber: "asc" }, include: { currentVersion: true } });
  const plot = episodes.map((e) => (e.currentVersion?.spec as EpisodeSpecRecord | undefined)?.plot).find((p) => (p?.parts?.length ?? 0) > 1);
  return plot ? { plot, episodes } : null;
}

/**
 * Writes a complete new script version for an episode with the planned,
 * verified pipeline (see docs/story-quality.md) and stops at the script gate.
 * For a multi-part story, writing Part 1 plans the whole story and writes
 * every part (each its own episode, each stopping at the gate); rewriting a
 * later part keeps the plan. Bible updates are stored as pending proposals.
 */
export async function writeEpisode(ctx: WriteContext & { reason: string; direction?: string | null; replanStory?: boolean }): Promise<WriteResult> {
  const setup = await loadEpisodeSetup(ctx.episodeId);
  if (setup.story.channel?.format === "PROCESS_EXPLAINER") return writeProcess(ctx, setup);
  const { episode, story } = setup;
  const parts = story.plannedParts;
  // Channel stories: the planner picks how many parts within the channel's range.
  const partsRange: [number, number] | undefined = story.channel && story.channel.maxParts > 1 ? [story.channel.minParts, story.channel.maxParts] : undefined;
  const { input, deps } = await composeContext(ctx, setup, ctx.direction);
  const plan = parts > 1 ? await loadStoryPlan(story.id) : null;

  // One part of an already planned story: rewrite it from the saved plan.
  if (plan && !(episode.partNumber === 1 && ctx.replanStory) && episode.partNumber <= (plan.plot.parts?.length ?? 0)) {
    const earlier = plan.episodes.filter((e) => e.partNumber < episode.partNumber).map((e) => e.currentVersion?.narration ?? "");
    const saved = plan.episodes.find((e) => e.currentVersion)?.currentVersion?.spec as EpisodeSpecRecord;
    const result = await composePart({ ...input, partNumber: 1, parts: plan.plot.parts.length }, deps, {
      plot: plan.plot,
      part: episode.partNumber,
      earlier,
      plotRounds: saved.quality?.plotRounds ?? [],
    });
    return saveComposed(setup, episode, result, ctx.reason);
  }

  // A new story, or replanning one: plan every part together.
  if (parts > 1 && episode.partNumber === 1) {
    const produced = plan?.episodes.filter((e) => !["DRAFT", "SCRIPTED", "FAILED"].includes(e.status)) ?? [];
    if (produced.length) throw new Error(`Part ${produced[0].partNumber} has already been produced, so the story can't be replanned. Rewrite individual parts instead.`);
    const results = await composeStory({ ...input, parts, partsRange }, deps);
    await settlePartCount(story.id, results.length);
    let first: WriteResult | null = null;
    for (const result of results) {
      const n = result.quality.part;
      const target =
        n === 1
          ? episode
          : ((await db.episode.findFirst({ where: { storyId: story.id, partNumber: n } })) ?? (await db.episode.create({ data: { storyId: story.id, partNumber: n, title: result.draft.title } })));
      const saved = await saveComposed(setup, target, result, ctx.reason);
      first ??= saved;
    }
    return { ...first!, parts: results.length };
  }

  const result = await composeScript(input, deps);
  return saveComposed(setup, episode, result, ctx.reason);
}

/**
 * Once the planner has chosen how many parts a story has, its episodes match:
 * unproduced episodes beyond the new count (from an earlier, longer plan) are removed.
 */
async function settlePartCount(storyId: string, count: number) {
  await db.episode.deleteMany({ where: { storyId, partNumber: { gt: count }, status: { in: ["DRAFT", "SCRIPTED", "FAILED"] } } });
  await db.story.update({ where: { id: storyId }, data: { plannedParts: count } });
}

// ── Process explainers ────────────────────────────────────────────────

function processContext(ctx: WriteContext, setup: Setup): { input: ProcessInput; deps: ProcessDeps } {
  const { story } = setup;
  const channel = story.channel!;
  const seed = (story.storySeed ?? null) as { beatSketch?: string | null } | null;
  return {
    input: {
      channel: setup.channel!,
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
 * Process explainers: Part 1 researches the product (once; the notes are kept
 * on the story), plans every part and writes them all. A later part, or Part 1
 * without replanning, is rewritten from the saved research and plan.
 */
async function writeProcess(ctx: WriteContext & { reason: string; replanStory?: boolean }, setup: Setup): Promise<WriteResult> {
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
  if (spec.process) {
    const { input, deps } = processContext(ctx, setup);
    const result = await reviseProcessPart(input, deps, await processPartState(setup, spec, version.narration));
    return saveProcessPart(setup, setup.episode, result, "revise-issues");
  }
  if (!spec.plot || !spec.quality) throw new Error("This script was written before the quality checks. Regenerate it instead.");
  const { input, deps } = await composeContext(ctx, setup);
  const state = await scriptState(setup.story.id, spec, version.narration);
  const result = await reviseComposed({ ...input, parts: spec.plot.parts?.length ?? 1 }, deps, { state, quality: spec.quality });
  return saveComposed(setup, setup.episode, result, "revise-issues");
}

/** Rebuilds a saved script's working state, including what earlier parts of the story told. */
async function scriptState(storyId: string, spec: EpisodeSpecRecord, narration: string): Promise<ScriptState> {
  const plot = spec.plot!;
  const part = spec.quality?.part ?? 1;
  let earlier: string[] = [];
  if ((plot.parts?.length ?? 0) > 1 && part > 1) {
    const eps = await db.episode.findMany({ where: { storyId, partNumber: { lt: part } }, orderBy: { partNumber: "asc" }, include: { currentVersion: { select: { narration: true } } } });
    earlier = eps.map((e) => e.currentVersion?.narration ?? "");
  }
  return {
    plot,
    part,
    brief: partBrief(plot, part, earlier),
    hook: spec.selectedHook,
    hookPromise: spec.quality?.hooks?.pick.promise ?? "",
    title: spec.title,
    narration,
    summary: spec.summary,
    keyReveals: spec.keyReveals,
    unresolvedQuestions: spec.unresolvedQuestions,
  };
}

type Composed = Pick<ComposeResult, "draft" | "quality"> & { plot?: Plot; process?: ProcessSpec };

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
    baseBibleVersion: setup.bible.version,
    plot: result.plot,
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
  baseBibleVersion: number;
  plot?: Plot;
  process?: ProcessSpec;
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
  if (spec.process && spec.quality) {
    const { input, deps } = processContext(ctx, setup);
    const quality = await recheckProcessPart(input, deps, await processPartState(setup, spec, version.narration));
    await db.episodeVersion.update({ where: { id: versionId }, data: { spec: { ...spec, quality }, qualityStatus: quality.status } });
    return;
  }
  if (!spec.plot || !spec.quality) return;
  const { input, deps } = await composeContext(ctx, setup);
  const quality = await recheckScript({ ...input, parts: spec.plot.parts?.length ?? 1 }, deps, await scriptState(setup.story.id, spec, version.narration), spec.quality);
  await db.episodeVersion.update({ where: { id: versionId }, data: { spec: { ...spec, quality }, qualityStatus: quality.status } });
}
