import { z } from "zod";
import { db } from "@/lib/db";
import { generateStructured, StructuredOutputError } from "@/lib/ai/structured";
import { splitPrompt, storyboardPrompt } from "@/lib/ai/storyboard-prompts";
import { channelStyle } from "@/lib/ai/channel-styles";
import { channelGuide, type ChannelGuide } from "@/lib/schemas/channel";
import { type EpisodeDraft, type EpisodeSpecRecord, SceneBreakdownSchema, type VisualState } from "@/lib/schemas/episode";
import { assertWithinBudget, type CostContext } from "@/lib/costs/record";
import { setJobStage } from "@/lib/jobs";
import { getModels, getPricing, playbackWordsPerSecond, storyboardModel } from "@/lib/settings";
import { countWords, estimateSpokenDuration, joinNarration, normalizeTitle } from "@/lib/text";
import {
  cleanScript,
  cutParts,
  estimateParts,
  evenBreaks,
  firstSentence,
  MAX_PARTS,
  onScreenHookIssues,
  recutExactly,
  splitIssues,
  splitSentences,
  storyboardIssues,
} from "@/lib/script";
import type { PipelineDeps } from "./deps";

/*
 * Pasted scripts: the producer writes the narration; this turns it into
 * storyboarded episodes. Split into parts (one model call, cut by code), then
 * one storyboard call per part, then each part goes on to images, voice and render.
 */

export const ScriptInputSchema = z.object({
  channelId: z.string().min(1),
  script: z.string().trim().min(1, "Paste the script."),
  parts: z.number().int().min(1).max(MAX_PARTS),
  visualNotes: z.string().trim().max(2000).nullish(),
  /** Overrides for what the storyboard would otherwise draft. */
  title: z.string().trim().max(200).nullish(),
  hook: z.string().trim().max(80).nullish(),
});
export type ScriptInput = z.input<typeof ScriptInputSchema>;

export const ScriptJobPayloadSchema = z.object({
  jobId: z.string(),
  storyId: z.string(),
  /** Part 1's on-screen hook, typed by the producer. */
  hook: z.string().nullish(),
  /** The producer typed the series title; the drafted one is not used. */
  titleLocked: z.boolean().default(false),
  budgetUsd: z.number().nullish(),
});
export type ScriptJobPayload = z.infer<typeof ScriptJobPayloadSchema>;

/** Creates the story and its empty parts from a pasted script. The storyboard job fills them in. */
export async function createStoryFromScript(raw: ScriptInput) {
  const input = ScriptInputSchema.parse(raw);
  const channel = await db.channel.findUniqueOrThrow({ where: { id: input.channelId } });
  if (channel.archivedAt) throw new Error("This channel is archived.");
  const script = cleanScript(input.script);
  const words = countWords(script);
  if (words < 15) throw new Error("The script is too short to make a video from (at least 15 words).");
  const sentences = splitSentences(script);
  if (sentences.length < input.parts) throw new Error(`The script has ${sentences.length} sentence${sentences.length === 1 ? "" : "s"}, so it can't be split into ${input.parts} videos.`);
  const { perPartSec } = estimateParts(script, input.parts, await playbackWordsPerSecond(channel.voiceId));
  const title = input.title || "Untitled script";
  return db.story.create({
    data: {
      title,
      normalizedTitle: normalizeTitle(title),
      sourceScript: script,
      visualNotes: input.visualNotes || null,
      styleKey: channel.styleKey,
      voiceId: channel.voiceId,
      channelId: channel.id,
      targetDurationSec: Math.max(1, Math.round(perPartSec)),
      plannedParts: input.parts,
      quality: channel.quality,
      episodes: { create: Array.from({ length: input.parts }, (_, i) => ({ partNumber: i + 1, title: input.parts > 1 ? `Part ${i + 1}` : title })) },
    },
  });
}

type Setup = {
  story: { id: string; title: string; sourceScript: string; visualNotes: string | null; plannedParts: number; styleKey: string };
  guide: ChannelGuide;
  model: string;
  wps: number;
  cost: CostContext;
  deps: Pick<PipelineDeps, "text">;
  pricing: Awaited<ReturnType<typeof getPricing>>;
};

/** Split, then storyboard every part that has no version yet. Safe to retry: finished work is kept. */
export async function runScriptJob(payload: ScriptJobPayload, deps: Pick<PipelineDeps, "text">): Promise<{ episodeIds: string[] }> {
  const story = await db.story.findUniqueOrThrow({ where: { id: payload.storyId }, include: { channel: true, episodes: { orderBy: { partNumber: "asc" } } } });
  if (!story.channel) throw new Error("This story belongs to no channel.");
  if (!story.sourceScript) throw new Error("This story has no pasted script.");
  const [pricing, models, wps] = await Promise.all([getPricing(), getModels(), playbackWordsPerSecond(story.voiceId)]);
  const setup: Setup = {
    story: { ...story, sourceScript: story.sourceScript },
    guide: channelGuide(story.channel),
    model: storyboardModel(story.quality, models),
    wps,
    cost: { jobId: payload.jobId, storyId: story.id, budgetUsd: payload.budgetUsd ?? null },
    deps,
    pricing,
  };

  // 1. Split into parts (code cuts at the chosen sentences, so the words never change).
  let episodes = story.episodes;
  if (episodes.some((e) => !e.script)) {
    await setJobStage(payload.jobId, "STORYBOARDING", story.plannedParts > 1 ? `Splitting the script into ${story.plannedParts} videos` : "Reading the script", 0.05);
    const { texts, seriesTitle } = await splitScript(setup);
    await db.$transaction(episodes.map((e, i) => db.episode.update({ where: { id: e.id }, data: { script: texts[i] } })));
    if (seriesTitle && !payload.titleLocked) await db.story.update({ where: { id: story.id }, data: { title: seriesTitle, normalizedTitle: normalizeTitle(seriesTitle) } });
    episodes = await db.episode.findMany({ where: { storyId: story.id }, orderBy: { partNumber: "asc" } });
  }

  // 2. Storyboard: Part 1 first, so the others keep its look; then the rest together.
  const [first, ...rest] = episodes;
  let done = 0;
  const step = async (label: string) => setJobStage(payload.jobId, "STORYBOARDING", label, 0.15 + (0.8 * done) / episodes.length);
  let seriesLook: VisualState | null = null;
  if (!first.currentVersionId) {
    await step(episodes.length > 1 ? "Storyboarding Part 1" : "Storyboarding");
    const draft = await storyboardPart(setup, { episode: first, hook: payload.hook ?? null, seriesVisualState: null });
    seriesLook = draft.visualState;
    if (episodes.length === 1 && !payload.titleLocked) await db.story.update({ where: { id: story.id }, data: { title: draft.title, normalizedTitle: normalizeTitle(draft.title) } });
  } else {
    const v = await db.episodeVersion.findUniqueOrThrow({ where: { id: first.currentVersionId } });
    seriesLook = (v.spec as EpisodeSpecRecord).visualState ?? null;
  }
  done++;
  const todo = rest.filter((e) => !e.currentVersionId);
  if (todo.length) {
    await step(`Storyboarding ${todo.length === 1 ? `Part ${todo[0].partNumber}` : `Parts ${todo.map((e) => e.partNumber).join(", ")}`}`);
    // Every part finishes or fails on its own; a retry only redoes the failed ones.
    const settled = await Promise.allSettled(todo.map((e) => storyboardPart(setup, { episode: e, hook: null, seriesVisualState: seriesLook })));
    const failed = settled.find((r) => r.status === "rejected");
    if (failed) throw failed.reason;
  }
  await db.story.update({ where: { id: story.id }, data: { lastActivityAt: new Date() } });
  return { episodeIds: episodes.map((e) => e.id) };
}

async function splitScript(setup: Setup): Promise<{ texts: string[]; seriesTitle: string | null }> {
  const sentences = splitSentences(setup.story.sourceScript);
  const parts = setup.story.plannedParts;
  if (parts === 1) return { texts: [sentences.join(" ")], seriesTitle: null };
  await assertWithinBudget(setup.cost, 0.05);
  try {
    const split = await generateStructured({
      client: setup.deps.text,
      pricing: setup.pricing,
      model: setup.model,
      ...splitPrompt({ channel: setup.guide, sentences, parts }),
      schema: SplitSchema,
      schemaName: "script_split",
      validate: (v) => splitIssues(sentences, v.breaks, parts),
      cost: { ctx: setup.cost, operation: "script-split" },
    });
    return { texts: cutParts(sentences, split.breaks), seriesTitle: split.seriesTitle.trim() || null };
  } catch (err) {
    // The split is a convenience: an even split by length still makes good videos.
    if (!(err instanceof StructuredOutputError)) throw err;
    console.warn(`Split fell back to even lengths: ${err.message}`);
    return { texts: cutParts(sentences, evenBreaks(sentences, parts)), seriesTitle: null };
  }
}

const SplitSchema = z.object({
  seriesTitle: z.string(),
  breaks: z.array(z.number().int()).describe("Sentence numbers where Parts 2..N begin, increasing."),
});

async function storyboardPart(
  setup: Setup,
  input: { episode: { id: string; partNumber: number; script: string | null; currentVersionId: string | null }; hook: string | null; seriesVisualState: VisualState | null },
): Promise<EpisodeDraft> {
  const narration = input.episode.script;
  if (!narration) throw new Error(`Part ${input.episode.partNumber} has no script.`);
  const durationSec = estimateSpokenDuration(narration, setup.wps);
  const allowQuestion = channelStyle(setup.guide.format).allowsQuestions;
  await assertWithinBudget(setup.cost, 0.15);
  const b = await generateStructured({
    client: setup.deps.text,
    pricing: setup.pricing,
    model: setup.model,
    ...storyboardPrompt({
      channel: setup.guide,
      part: input.episode.partNumber,
      parts: setup.story.plannedParts,
      narration,
      durationSec,
      fullScript: setup.story.sourceScript,
      visualNotes: setup.story.visualNotes,
      seriesVisualState: input.seriesVisualState,
    }),
    schema: SceneBreakdownSchema,
    schemaName: "storyboard",
    validate: (v) => [
      ...storyboardIssues(narration, v.scenes, { format: setup.guide.format, durationSec }),
      // The producer's own hook text is theirs to word.
      ...(input.hook ? [] : onScreenHookIssues(v.onScreenHook, narration, { allowQuestion })),
    ],
    cost: { ctx: { ...setup.cost, episodeId: input.episode.id }, operation: "storyboard" },
  });
  const draft: EpisodeDraft = {
    title: b.title.trim(),
    storyNarration: narration,
    selectedHook: firstSentence(narration),
    summary: b.summary,
    onScreenHook: input.hook || b.onScreenHook,
    visualState: b.visualState,
    // The producer's punctuation and capitals, not the model's copy of them.
    scenes: recutExactly(narration, b.scenes),
  };
  const versionId = await persistVersion({
    episodeId: input.episode.id,
    storyId: setup.story.id,
    partNumber: input.episode.partNumber,
    styleKey: setup.story.styleKey,
    reason: "pasted",
    parentVersionId: input.episode.currentVersionId,
    draft,
    wps: setup.wps,
  });
  await db.episode.update({ where: { id: input.episode.id }, data: { title: draft.title, status: "SCRIPTED", currentVersionId: versionId } });
  return draft;
}

export async function persistVersion(input: {
  episodeId: string;
  storyId: string;
  partNumber: number;
  styleKey: string;
  reason: string;
  parentVersionId: string | null;
  draft: EpisodeDraft;
  wps: number;
}): Promise<string> {
  const narration = joinNarration(input.draft.scenes);
  const wordCount = countWords(narration);
  const estimatedDurationSec = estimateSpokenDuration(narration, input.wps);
  const { scenes, ...rest } = input.draft;
  const spec: EpisodeSpecRecord = { ...rest, storyId: input.storyId, partNumber: input.partNumber, narration, wordCount, estimatedDurationSec };

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
            soundEffect: s.soundEffect,
            stepLabel: s.stepLabel,
          })),
        },
      },
    });
    return version.id;
  });
}
