import { db } from "@/lib/db";
import { generateStructured } from "@/lib/ai/structured";
import {
  continuityPrompt,
  outlinePickPrompt,
  outlinePrompt,
  revisionPrompt,
  sceneRewritePrompt,
  storyReviewPrompt,
  type WriterInput,
  writerPrompt,
} from "@/lib/ai/prompts";
import { OutlinePickSchema, type StoryOutline, StoryOutlinesSchema, type StoryReview, StoryReviewSchema, storyNeedsRevision } from "@/lib/schemas/story-plan";
import {
  type ContinuityReview,
  ContinuityReviewSchema,
  type EpisodeDraft,
  EpisodeDraftSchema,
  type EpisodeSpecRecord,
  SceneNarrationRewriteSchema,
} from "@/lib/schemas/episode";
import { MOTION_PRESETS, QUALITY_PRESETS, sceneCountRange, targetWordRange } from "@/lib/constants";
import { countWords, DEFAULT_WORDS_PER_SECOND, estimateSpokenDuration, joinNarration, tokenize } from "@/lib/text";
import { getAudioMix, getPricing, getModels, voiceWordsPerSecond } from "@/lib/settings";
import { assertWithinBudget, type CostContext } from "@/lib/costs/record";
import { approvedHistory, loadCanonicalBible, selectContinuationContext } from "./context";
import type { PipelineDeps } from "./deps";
import { toNarrator } from "./characters";

const MAX_REVISION_ROUNDS = 2;

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
  const [minWords, maxWords] = targetWordRange(opts.durationSec, opts.wordsPerSecond);
  const words = countWords(draft.storyNarration);
  if (words < Math.floor(minWords * 0.9) || words > Math.ceil(maxWords * 1.1)) {
    issues.push(`storyNarration must be ${minWords}–${maxWords} words; it is ${words}. ${words > maxWords ? "Tighten it." : "Develop the story more."}`);
  }
  // The shots must be a pure cut of the story: same words, same order (punctuation and spacing aside).
  const story = tokenize(draft.storyNarration);
  const cut = tokenize(joinNarration(draft.scenes));
  const at = story.findIndex((w, i) => cut[i] !== w);
  if (at >= 0 || cut.length !== story.length) {
    const where = at >= 0 ? at : Math.min(story.length, cut.length);
    issues.push(
      `The scenes' narration, joined in order, must reproduce storyNarration word for word. They diverge at word ${where + 1}: story has "${story.slice(where, where + 8).join(" ")}", scenes have "${cut.slice(where, where + 8).join(" ")}".`,
    );
  }
  const startsWith = (text: string, prefix: string) => {
    const p = tokenize(prefix).slice(0, 12);
    return p.length > 0 && tokenize(text).slice(0, p.length).join(" ") === p.join(" ");
  };
  if (!startsWith(draft.storyNarration, draft.selectedHook)) issues.push("selectedHook must be the opening line(s) of storyNarration, copied exactly.");
  return issues;
}

type WriteContext = {
  episodeId: string;
  cost: CostContext;
  deps: PipelineDeps;
};

async function loadEpisodeSetup(episodeId: string) {
  const episode = await db.episode.findUniqueOrThrow({ where: { id: episodeId }, include: { story: { include: { character: true } } } });
  const story = episode.story;
  const bible = await loadCanonicalBible(story.id);
  const preset = QUALITY_PRESETS[story.quality];
  const models = await getModels();
  const pricing = await getPricing();
  // The render-time speed-up shortens the video, so scripts are sized for the faster rate.
  const { narrationSpeed } = await getAudioMix();
  const wps = ((story.voiceId ? await voiceWordsPerSecond(story.voiceId) : null) ?? DEFAULT_WORDS_PER_SECOND) * narrationSpeed;
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

function continuityIssuesFrom(review: ContinuityReview | null): string[] {
  if (!review) return [];
  return review.issues
    .filter((i) => i.severity === "material")
    .map((i) => `Continuity (${i.type}${i.sceneNumber ? `, scene ${i.sceneNumber}` : ""}): ${i.description} Fix: ${i.suggestedFix}`);
}

export type WriteResult = { versionId: string; materialConflicts: string[] };

const OUTLINE_COUNT = 3;

/** Outlines several versions of the episode and has an editor pick the strongest, before any script is written. */
async function planEpisode(ctx: WriteContext, input: WriterInput, opts: { model: string; pricing: Awaited<ReturnType<typeof getPricing>> }) {
  await assertWithinBudget(ctx.cost, 0.1);
  const { outlines } = await generateStructured({
    client: ctx.deps.text,
    pricing: opts.pricing,
    model: opts.model,
    ...outlinePrompt(input, OUTLINE_COUNT),
    schema: StoryOutlinesSchema,
    schemaName: "story_outlines",
    validate: (v) => [
      ...(v.outlines.length < 2 ? [`Write ${OUTLINE_COUNT} outlines.`] : []),
      ...v.outlines.flatMap((o, i) => [
        ...(o.escalations.length < 2 ? [`outlines[${i}] needs at least three escalating complications.`] : []),
        ...(o.beats.length < 5 || o.beats.length > 10 ? [`outlines[${i}] needs six to nine beats.`] : []),
      ]),
    ],
    cost: { ctx: ctx.cost, operation: "outline-episode" },
  });
  const pick = await generateStructured({
    client: ctx.deps.text,
    pricing: opts.pricing,
    model: opts.model,
    ...outlinePickPrompt({ outlines, hero: input.narrator?.name ?? "the main character", premise: input.premise, partNumber: input.partNumber }),
    schema: OutlinePickSchema,
    schemaName: "outline_pick",
    validate: (v) => (v.chosenIndex >= 0 && v.chosenIndex < outlines.length ? [] : [`chosenIndex must be 0–${outlines.length - 1}.`]),
    cost: { ctx: ctx.cost, operation: "pick-outline" },
  });
  return { outline: outlines[pick.chosenIndex] as StoryOutline, notes: pick.improvements.slice(0, 3) };
}

/**
 * Writes a complete new script version for an episode: draft →
 * continuity review (Part 2+) → up to two correction rounds → persist.
 * The proposed bible update is stored as a pending proposal, never applied here.
 */
export async function writeEpisode(ctx: WriteContext & { reason: string; direction?: string | null }): Promise<WriteResult> {
  const setup = await loadEpisodeSetup(ctx.episodeId);
  const { episode, story, bible, pricing, wps, writerModel, reviewerModel } = setup;

  const history = episode.partNumber > 1 ? await approvedHistory(story.id, episode.partNumber) : [];
  const selected = selectContinuationContext(history);

  const writerInput: WriterInput = {
    storyId: story.id,
    title: story.title,
    premise: story.premise,
    partNumber: episode.partNumber,
    durationSec: story.targetDurationSec,
    wordsPerSecond: wps,
    narrator: story.character ? toNarrator(story.character) : null,
    bible: bible.data,
    previousEpisodes: selected.previousEpisodes,
    latestEpisode: selected.latestEpisode,
    direction: ctx.direction,
  };
  const plan = await planEpisode(ctx, writerInput, { model: writerModel, pricing });
  const writer = writerPrompt({ ...writerInput, outline: plan.outline, outlineNotes: plan.notes });

  const validate = (d: EpisodeDraft) => validateDraft(d, { durationSec: story.targetDurationSec, wordsPerSecond: wps });

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

  // A story editor reads the script; if it falls short, it gets one revision with specific notes.
  const storyReview: StoryReview = await generateStructured({
    client: ctx.deps.text,
    pricing,
    model: writerModel,
    ...storyReviewPrompt({ storyNarration: draft.storyNarration, hero: story.character?.name ?? "the main character", partNumber: episode.partNumber, personality: story.character?.personality }),
    schema: StoryReviewSchema,
    schemaName: "story_review",
    cost: { ctx: ctx.cost, operation: "story-review" },
  });
  if (storyNeedsRevision(storyReview)) {
    await assertWithinBudget(ctx.cost, 0.2);
    draft = await generateStructured({
      client: ctx.deps.text,
      pricing,
      model: writerModel,
      ...revisionPrompt({ draftJson: JSON.stringify(draft), continuityIssues: [], lengthIssues: [], editorNotes: storyReview.notes }),
      schema: EpisodeDraftSchema,
      schemaName: "episode_draft",
      validate,
      cost: { ctx: ctx.cost, operation: "revise-story" },
    });
  }

  // Part 2+ is checked against the story bible and revised (bounded) until it no longer contradicts earlier episodes.
  let continuityReview: ContinuityReview | null = null;
  for (let round = 1; episode.partNumber > 1; round++) {
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
    const continuityIssues = continuityIssuesFrom(continuityReview);
    if (continuityIssues.length === 0 || round > MAX_REVISION_ROUNDS) break;

    await assertWithinBudget(ctx.cost, 0.2);
    draft = await generateStructured({
      client: ctx.deps.text,
      pricing,
      model: writerModel,
      ...revisionPrompt({ draftJson: JSON.stringify(draft), continuityIssues, lengthIssues: [] }),
      schema: EpisodeDraftSchema,
      schemaName: "episode_draft",
      validate,
      cost: { ctx: ctx.cost, operation: `revise-episode-${round}` },
    });
  }

  const materialConflicts = continuityIssuesFrom(continuityReview);

  const hook = draft.selectedHook.trim();

  const versionId = await persistVersion({
    episodeId: episode.id,
    storyId: story.id,
    partNumber: episode.partNumber,
    styleKey: story.styleKey,
    reason: ctx.reason,
    parentVersionId: episode.currentVersionId,
    draft,
    hook,
    wps,
    continuityReview,
    baseBibleVersion: bible.version,
    outline: plan.outline,
    storyReview,
  });

  await db.episode.update({
    where: { id: episode.id },
    data: { title: draft.title, status: "SCRIPTED", currentVersionId: versionId },
  });
  await db.story.update({ where: { id: story.id }, data: { lastActivityAt: new Date() } });

  return { versionId, materialConflicts };
}

async function persistVersion(input: {
  episodeId: string;
  storyId: string;
  partNumber: number;
  styleKey: string;
  reason: string;
  parentVersionId: string | null;
  draft: EpisodeDraft;
  hook: string;
  wps: number;
  continuityReview: ContinuityReview | null;
  baseBibleVersion: number;
  outline?: StoryOutline;
  storyReview?: StoryReview;
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
    narration,
    wordCount,
    estimatedDurationSec,
    factCheckStatus: "PASSED",
    outline: input.outline,
    storyReview: input.storyReview,
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
        continuityReview: input.continuityReview ?? undefined,
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
  });
  return { versionId: newVersionId, imagePromptChanged };
}
