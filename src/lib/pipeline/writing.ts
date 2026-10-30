import { db } from "@/lib/db";
import { generateStructured } from "@/lib/ai/structured";
import { sceneRewritePrompt } from "@/lib/ai/process-prompts";
import type { QualityRecord } from "@/lib/schemas/quality";
import { type EpisodeDraft, type EpisodeSpecRecord, SceneNarrationRewriteSchema } from "@/lib/schemas/episode";
import { countWords, DEFAULT_WORDS_PER_SECOND, estimateSpokenDuration, joinNarration } from "@/lib/text";
import { getAudioMix, getPricing, getModels, scriptModels, voiceWordsPerSecond } from "@/lib/settings";
import { assertWithinBudget, type CostContext } from "@/lib/costs/record";
import { setJobStage } from "@/lib/jobs";
import {
  composeProcess,
  composeProcessPart,
  createCreativePlan,
  type ProcessDeps,
  type ProcessInput,
  type ProcessResult,
  recheckProcessPart,
  researchProcess,
  reviseProcessPart,
} from "@/lib/process/compose";
import { type CreativePlan, creativeFor } from "@/lib/process/creative";
import type { Creative, Pattern, ReviewedHook } from "@/lib/schemas/storytelling";
import { DiscoverySnapshotSchema } from "@/lib/schemas/topics";
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
      topic: topicHint(story.discovery),
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

/** The approved topic's angle from discovery, when the story came from it. */
function topicHint(discovery: unknown): Creative["topic"] {
  const d = DiscoverySnapshotSchema.safeParse(discovery);
  if (!d.success || !d.data.curiosityAngle) return null;
  return { curiosityAngle: d.data.curiosityAngle, visualPayoff: d.data.visualPayoff, featuredStage: d.data.featuredStage };
}

// ── Storytelling decision and hooks (stored per story) ────────────────

/** The story's saved storytelling decision and selected hook, as the writer uses them. Null for stories written before them. */
async function savedCreative(storyId: string, topic: Creative["topic"]): Promise<Creative | null> {
  const d = await db.manufacturingStorytellingDecision.findUnique({ where: { storyId }, include: { selectedHook: true } });
  if (!d) return null;
  const decision = {
    pattern: d.pattern,
    reason: d.reason,
    curiosityMechanism: d.curiosityMechanism,
    featuredStageId: d.featuredStageId,
    visualPayoff: d.visualPayoff,
    alternatives: d.alternatives,
    stageVisuals: d.stageVisuals as Creative["decision"]["stageVisuals"],
  };
  const h = d.selectedHook;
  return creativeFor({ decision }, h ? { id: h.id, line: h.line, claimIds: h.claimIds, featuredStageId: h.featuredStageId } : null, topic);
}

/** Saves a creative plan: the decision (replacing any earlier one) and every hook, selecting the recommended one. */
async function persistCreative(storyId: string, research: ResearchRecord, plan: CreativePlan, source: "recommended" | "producer"): Promise<string | null> {
  return db.$transaction(async (tx) => {
    const rows = [];
    for (const h of plan.hooks) rows.push(await tx.manufacturingHookCandidate.create({ data: hookRow(storyId, h) }));
    const selectedHookId = plan.recommended === null ? null : rows[plan.recommended].id;
    const d = plan.decision;
    const data = {
      pattern: d.pattern,
      patternSource: source,
      reason: d.reason,
      curiosityMechanism: d.curiosityMechanism,
      featuredStageId: d.featuredStageId,
      visualPayoff: d.visualPayoff,
      alternatives: d.alternatives,
      stageVisuals: d.stageVisuals,
      selectedHookId,
      researchedAt: research.researchedAt,
    };
    await tx.manufacturingStorytellingDecision.upsert({ where: { storyId }, create: { storyId, ...data }, update: data });
    return selectedHookId;
  });
}

function hookRow(storyId: string, h: ReviewedHook) {
  return {
    storyId,
    pattern: h.pattern,
    line: h.line,
    strategy: h.strategy,
    claimIds: h.claimIds,
    featuredStageId: h.featuredStageId,
    firstFrameVisual: h.firstFrameVisual,
    whyItWorks: h.whyItWorks,
    uncertainty: h.uncertainty,
    visual: h.visual,
    flags: h.flags,
    review: h.review ?? undefined,
    total: h.total,
    rank: h.rank,
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
    const creative = await ensureCreative(setup, input, deps, research, episode.partNumber);
    const result = await composeProcessPart(input, deps, { research, plan: saved.plan, part: episode.partNumber, earlier, creative });
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
  // A replan keeps the producer's storytelling choices; a first write makes them.
  const kept = await savedCreative(story.id, input.topic);
  const { results, creative } = await composeProcess(input, deps, { research, creative: kept ? { plan: kept, hook: kept.hook } : null });
  if (creative) {
    const hookId = await persistCreative(story.id, research, creative, "recommended");
    for (const r of results) if (r.creative?.hook) r.creative.hook.id = hookId ?? undefined;
  }
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

/**
 * The creative choices a part is written with. Stories written before them get
 * a decision and hooks the first time Part 1 is rewritten (cheap: no research).
 */
async function ensureCreative(setup: Setup, input: ProcessInput, deps: ProcessDeps, research: ResearchRecord, part: number): Promise<Creative | null> {
  const kept = await savedCreative(setup.story.id, input.topic);
  if (kept || part !== 1) return kept;
  await persistCreative(setup.story.id, research, await createCreativePlan(input, deps, research), "recommended");
  return savedCreative(setup.story.id, input.topic);
}

function saveProcessPart(setup: Setup, episode: { id: string; partNumber: number; currentVersionId: string | null }, result: ProcessResult, reason: string) {
  const c = result.creative;
  const hook = result.part === 1 ? (c?.hook ?? null) : null;
  return saveComposed(
    setup,
    episode,
    {
      draft: result.draft,
      quality: result.quality,
      process: { plan: result.plan, part: result.part, ...(c ? { creative: { pattern: c.decision.pattern, hookId: hook?.id ?? null, hookLine: hook?.line ?? null } } : {}) },
    },
    reason,
  );
}

/**
 * The producer picks another opening for Part 1. Only Part 1 is rewritten,
 * from the saved research and plan: nothing is researched again.
 */
export async function chooseHook(ctx: WriteContext & { hookId: string }): Promise<WriteResult> {
  const setup = await loadEpisodeSetup(ctx.episodeId);
  if (setup.episode.partNumber !== 1) throw new Error("The opening hook belongs to Part 1.");
  const decision = await db.manufacturingStorytellingDecision.findUniqueOrThrow({ where: { storyId: setup.story.id } });
  const hook = await db.manufacturingHookCandidate.findUniqueOrThrow({ where: { id: ctx.hookId } });
  if (hook.storyId !== setup.story.id) throw new Error("That opening belongs to another story.");
  if (hook.pattern !== decision.pattern) throw new Error("That opening was written for another storytelling pattern. Switch pattern first.");
  await db.manufacturingStorytellingDecision.update({ where: { id: decision.id }, data: { selectedHookId: hook.id } });
  return rewriteFromSaved(ctx, setup, [1], "choose-hook");
}

/**
 * The producer switches storytelling pattern: a new decision and openings are
 * made from the saved research, and every part not yet produced is rewritten
 * with them. The research and the part plan are reused as they are.
 */
export async function switchPattern(ctx: WriteContext & { pattern: Pattern }): Promise<WriteResult> {
  const setup = await loadEpisodeSetup(ctx.episodeId);
  const { input, deps } = processContext(ctx, setup);
  const research = storedResearch(setup.story);
  const saved = await loadProcessPlan(setup.story.id);
  if (!research || !saved) throw new Error("Write the scripts first: switching pattern reuses their research and plan.");
  const open = saved.episodes.filter((e) => ["DRAFT", "SCRIPTED", "FAILED"].includes(e.status)).map((e) => e.partNumber);
  if (!open.length) throw new Error("Every part has been produced, so there is nothing left to rewrite.");
  await persistCreative(setup.story.id, research, await createCreativePlan(input, deps, research, { pattern: ctx.pattern }), "producer");
  return rewriteFromSaved(ctx, setup, open, `pattern-${ctx.pattern.toLowerCase()}`);
}

/** Rewrites the given parts, in order, from the saved research, plan and creative choices. */
async function rewriteFromSaved(ctx: WriteContext, setup: Setup, parts: number[], reason: string): Promise<WriteResult> {
  const { input, deps } = processContext(ctx, setup);
  const research = storedResearch(setup.story);
  const saved = await loadProcessPlan(setup.story.id);
  if (!research || !saved) throw new Error("This story has no saved research and plan. Write the scripts first.");
  const creative = await savedCreative(setup.story.id, input.topic);
  const narrations = new Map(saved.episodes.map((e) => [e.partNumber, e.currentVersion?.narration ?? ""]));
  let first: WriteResult | null = null;
  for (const part of [...parts].sort((a, b) => a - b)) {
    const episode = saved.episodes.find((e) => e.partNumber === part);
    if (!episode) continue;
    const earlier = saved.episodes.filter((e) => e.partNumber < part).map((e) => narrations.get(e.partNumber) ?? "");
    const result = await composeProcessPart(input, deps, { research, plan: saved.plan, part, earlier, creative });
    const written = await saveProcessPart(setup, episode, result, reason);
    narrations.set(part, result.draft.storyNarration);
    first ??= written;
  }
  return { ...first!, parts: parts.length };
}

/** What revising or re-checking a saved process part needs. */
async function processPartState(setup: Setup, spec: EpisodeSpecRecord, narration: string) {
  const research = storedResearch(setup.story);
  if (!research || !spec.process || !spec.quality) throw new Error("This script has no saved research. Regenerate it instead.");
  const { part, plan } = spec.process;
  const eps = await db.episode.findMany({ where: { storyId: setup.story.id, partNumber: { lt: part } }, orderBy: { partNumber: "asc" }, include: { currentVersion: { select: { narration: true } } } });
  const creative = await savedCreative(setup.story.id, topicHint(setup.story.discovery));
  return { research, plan, part, earlier: eps.map((e) => e.currentVersion?.narration ?? ""), title: spec.title, narration, summary: spec.summary, quality: spec.quality, creative };
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
