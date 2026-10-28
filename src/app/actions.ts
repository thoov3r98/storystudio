"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { cancelJob, enqueueEpisodeJob, enqueueIdeation, retryJob } from "@/lib/enqueue";
import { CATEGORIES, ILLUSTRATION_STYLES, MAX_BATCH_SIZE, TARGET_DURATIONS } from "@/lib/constants";
import { estimateBatchCost } from "@/lib/costs/estimate";
import { PricingSchema } from "@/lib/costs/pricing";
import {
  AudioMixSchema,
  DefaultsSchema,
  getPricing,
  getModels,
  ModelsSchema,
  VoiceSchema,
  VoiceSettingsSchema,
  writeSetting,
} from "@/lib/settings";
import { StoryBibleSchema } from "@/lib/schemas/story-bible";
import { emptyBible } from "@/lib/schemas/story-bible";
import { continuationBlockers, loadCanonicalBible } from "@/lib/pipeline/context";
import { approveEpisode as approve, ensureEditableVersion, forkVersion, refreshStoryStatus } from "@/lib/pipeline/versions";
import { listElevenLabsVoices } from "@/lib/providers/speech";
import { normalizeTitle } from "@/lib/text";
import { CharacterEditSchema } from "@/lib/schemas/character";
import { createCharacterFromBrief, drawCharacterSheet } from "@/lib/pipeline/characters";
import { productionDeps } from "@/lib/pipeline/deps";

export type ActionResult<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };

async function attempt<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    const data = await fn();
    refresh();
    return { ok: true, data };
  } catch (err) {
    if (err instanceof z.ZodError) return { ok: false, error: err.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ───────────────────────────── Characters ───────────────────────────

/** Designs a character from a brief, then opens it so the producer can edit and draw it. */
export async function createCharacter(brief: string): Promise<ActionResult<{ characterId: string }>> {
  let characterId = "";
  const result = await attempt(async () => {
    const text = z.string().trim().min(3, "Describe the character in a sentence or two.").max(1000).parse(brief);
    const character = await createCharacterFromBrief({ brief: text, deps: productionDeps });
    characterId = character.id;
    return { characterId };
  });
  if (result.ok) redirect(`/characters/${characterId}`);
  return result;
}

export async function updateCharacter(characterId: string, input: unknown) {
  return attempt(async () => {
    const data = CharacterEditSchema.parse(input);
    await db.character.update({ where: { id: characterId }, data });
  });
}

export async function drawCharacter(characterId: string) {
  return attempt(async () => {
    await drawCharacterSheet({ characterId, deps: productionDeps });
  });
}

export async function setCharacterArchived(characterId: string, archived: boolean) {
  return attempt(async () => {
    await db.character.update({ where: { id: characterId }, data: { archivedAt: archived ? new Date() : null } });
  });
}

// ───────────────────────────── Generate ─────────────────────────────

const GenerateSchema = z.object({
  mode: z.enum(["CONCEPT", "FULL_PRODUCTION"]),
  category: z.enum(CATEGORIES.map((c) => c.value) as [string, ...string[]]),
  customDirection: z.string().max(2000).optional().default(""),
  count: z.coerce.number().int().min(1).max(MAX_BATCH_SIZE),
  durationSec: z.coerce.number().refine((n) => (TARGET_DURATIONS as readonly number[]).includes(n), "Duration must be 60, 75 or 90"),
  styleKey: z.string().refine((s) => s in ILLUSTRATION_STYLES, "Unknown style"),
  voiceId: z.string().min(1, "Select a narrator voice"),
  quality: z.enum(["DRAFT", "STANDARD", "PREMIUM"]),
  maxBudgetUsd: z.coerce.number().positive().max(10_000),
  autoSelect: z.boolean().default(false),
  characterId: z.string().nullable().optional(),
});

export type GenerateInput = z.input<typeof GenerateSchema>;

export async function createBatch(input: GenerateInput): Promise<ActionResult<{ batchId: string }>> {
  let batchId = "";
  const result = await attempt(async () => {
    const data = GenerateSchema.parse(input);
    if (data.category === "custom" && !data.customDirection.trim()) throw new Error("Describe what the videos should be about.");
    const estimate = estimateBatchCost(await getPricing(), await getModels(), {
      requested: data.count,
      durationSec: data.durationSec,
      quality: data.quality,
      fullProduction: data.mode === "FULL_PRODUCTION" && data.autoSelect,
    });
    if (estimate.ideation.total > data.maxBudgetUsd) {
      throw new Error(`Even concept generation is estimated at $${estimate.ideation.total.toFixed(2)}, above the $${data.maxBudgetUsd} budget.`);
    }
    const batch = await db.batch.create({
      data: {
        mode: data.mode,
        category: data.category,
        customDirection: data.customDirection || null,
        requestedCount: data.count,
        targetDurationSec: data.durationSec,
        styleKey: data.styleKey,
        voiceId: data.voiceId,
        quality: data.quality,
        maxBudgetUsd: data.maxBudgetUsd.toFixed(2),
        autoSelect: data.mode === "FULL_PRODUCTION" && data.autoSelect,
        estimatedCostUsd: estimate.total.toFixed(6),
        characterId: data.characterId || null,
      },
    });
    batchId = batch.id;
    await enqueueIdeation(batch.id);
    return { batchId: batch.id };
  });
  if (result.ok) redirect(`/batches/${batchId}`);
  return result;
}

/** Approves selected concepts for video production (the Part 1 episode of each story). */
export async function produceEpisodes(episodeIds: string[], batchId?: string | null) {
  return attempt(async () => {
    const ids = z.array(z.string()).min(1).max(MAX_BATCH_SIZE).parse(episodeIds);
    const batch = batchId ? await db.batch.findUnique({ where: { id: batchId } }) : null;
    const queued: string[] = [];
    const errors: string[] = [];
    for (const episodeId of ids) {
      try {
        await enqueueEpisodeJob({
          episodeId,
          batchId: batch?.id ?? null,
          budgetUsd: batch ? Number(batch.maxBudgetUsd) : null,
          continueProduction: true,
          request: { action: "produce", allowContinuityConflicts: false },
        });
        queued.push(episodeId);
      } catch (err) {
        errors.push(err instanceof Error ? err.message : String(err));
      }
    }
    if (queued.length === 0) throw new Error(errors[0] ?? "Nothing was queued.");
    return { queued: queued.length, errors };
  });
}

export async function promoteConcept(conceptId: string) {
  return attempt(async () => {
    const concept = await db.concept.findUniqueOrThrow({ where: { id: conceptId }, include: { batch: true, story: true } });
    if (concept.story) return { storyId: concept.story.id };
    const story = await db.story.create({
      data: {
        title: concept.title,
        normalizedTitle: concept.normalizedTitle,
        category: concept.category,
        premise: concept.premise,
        logline: concept.logline,
        keywords: concept.keywords,
        factMode: concept.factMode,
        styleKey: concept.batch.styleKey,
        voiceId: concept.batch.voiceId,
        targetDurationSec: concept.batch.targetDurationSec,
        quality: concept.batch.quality,
        conceptId: concept.id,
        bibles: { create: { version: 1, source: "concept", data: emptyBible({ premise: concept.premise, styleKey: concept.batch.styleKey }) } },
        episodes: { create: { partNumber: 1, title: concept.title } },
      },
    });
    await db.concept.update({ where: { id: conceptId }, data: { status: "SELECTED" } });
    return { storyId: story.id };
  });
}

// ───────────────────────────── Stories ─────────────────────────────

export async function generateNextEpisode(storyId: string, direction?: string) {
  return attempt(async () => {
    const blockers = await continuationBlockers(storyId);
    if (blockers.length) throw new Error(blockers.join(" "));
    const last = await db.episode.findFirstOrThrow({ where: { storyId }, orderBy: { partNumber: "desc" } });
    const story = await db.story.findUniqueOrThrow({ where: { id: storyId } });
    const episode = await db.episode.create({ data: { storyId, partNumber: last.partNumber + 1, title: `${story.title} — Part ${last.partNumber + 1}` } });
    try {
      await enqueueEpisodeJob({
        episodeId: episode.id,
        type: "CONTINUATION",
        continueProduction: true,
        request: { action: "produce", direction: direction?.trim() || null, allowContinuityConflicts: false },
      });
    } catch (err) {
      await db.episode.delete({ where: { id: episode.id } });
      throw err;
    }
    await db.story.update({ where: { id: storyId }, data: { status: "CONTINUING", lastActivityAt: new Date() } });
    return { episodeId: episode.id };
  });
}

export async function updateStoryTitle(storyId: string, title: string) {
  return attempt(async () => {
    const t = z.string().trim().min(3).max(200).parse(title);
    await db.story.update({ where: { id: storyId }, data: { title: t, normalizedTitle: normalizeTitle(t), lastActivityAt: new Date() } });
  });
}

export async function updateStoryBible(storyId: string, json: string, note: string) {
  return attempt(async () => {
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(json);
    } catch {
      throw new Error("The story bible is not valid JSON.");
    }
    const data = StoryBibleSchema.parse(parsedJson);
    const current = await loadCanonicalBible(storyId);
    await db.storyBible.create({
      data: { storyId, version: current.version + 1, data, source: "manual-edit", note: note.trim() || "Manual edit" },
    });
    await db.story.update({
      where: { id: storyId },
      data: { premise: data.premise, hasUnresolvedThreads: data.unresolvedThreads.some((t) => t.status === "open"), lastActivityAt: new Date() },
    });
  });
}

export async function setArchived(storyId: string, archived: boolean) {
  return attempt(async () => {
    await db.story.update({ where: { id: storyId }, data: archived ? { status: "ARCHIVED", archivedAt: new Date() } : { status: "CONCEPT", archivedAt: null } });
    if (!archived) await refreshStoryStatus(storyId);
  });
}

export async function setArchivedMany(storyIds: string[], archived: boolean) {
  return attempt(async () => {
    const ids = z.array(z.string().min(1)).min(1).max(500).parse(storyIds);
    if (archived) {
      await db.story.updateMany({ where: { id: { in: ids } }, data: { status: "ARCHIVED", archivedAt: new Date() } });
    } else {
      await db.story.updateMany({ where: { id: { in: ids } }, data: { status: "CONCEPT", archivedAt: null } });
      for (const id of ids) await refreshStoryStatus(id);
    }
  });
}

// ───────────────────────────── Episodes ─────────────────────────────

export async function approveEpisodeAction(episodeId: string, applyProposal: boolean) {
  return attempt(() => approve(episodeId, { applyProposal }));
}

export async function markPublished(episodeId: string, input: { url?: string; platform?: string; publishedAt?: string }) {
  return attempt(async () => {
    const data = z
      .object({ url: z.string().url().optional().or(z.literal("")), platform: z.string().max(50).optional(), publishedAt: z.string().optional() })
      .parse(input);
    const episode = await db.episode.findUniqueOrThrow({ where: { id: episodeId } });
    if (episode.status !== "APPROVED" && episode.status !== "PUBLISHED") {
      throw new Error("Approve the episode before marking it published, so its continuity is locked in.");
    }
    await db.episode.update({
      where: { id: episodeId },
      data: {
        status: "PUBLISHED",
        publishedAt: data.publishedAt ? new Date(data.publishedAt) : new Date(),
        publishedUrl: data.url || null,
        publishedPlatform: data.platform || null,
      },
    });
    await refreshStoryStatus(episode.storyId);
  });
}

const MetricsSchema = z.object({
  platform: z.string().min(1).max(50),
  views: z.coerce.number().int().nonnegative().optional(),
  likes: z.coerce.number().int().nonnegative().optional(),
  comments: z.coerce.number().int().nonnegative().optional(),
  shares: z.coerce.number().int().nonnegative().optional(),
  saves: z.coerce.number().int().nonnegative().optional(),
  followersGained: z.coerce.number().int().optional(),
  avgWatchTimeSec: z.coerce.number().nonnegative().optional(),
  completionRate: z.coerce.number().min(0).max(100).optional(),
  notes: z.string().max(2000).optional(),
});

export async function addMetrics(episodeId: string, input: z.input<typeof MetricsSchema>) {
  return attempt(async () => {
    const cleaned = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== "" && v !== undefined && v !== null));
    const data = MetricsSchema.parse(cleaned);
    await db.performanceMetric.create({ data: { episodeId, ...data } });
  });
}

type EpisodeRequest = Parameters<typeof enqueueEpisodeJob>[0]["request"];

export async function runEpisodeAction(episodeId: string, request: EpisodeRequest, continueProduction = true) {
  return attempt(async () => {
    const episode = await db.episode.findUniqueOrThrow({ where: { id: episodeId }, include: { story: true } });
    if (episode.story.status === "ARCHIVED") throw new Error("Unarchive the story first.");
    const jobId = await enqueueEpisodeJob({ episodeId, request, continueProduction });
    return { jobId };
  });
}

/** Makes a previous image of a scene current again (forks a locked version first). */
export async function selectSceneImage(episodeId: string, sceneNumber: number, imageId: string) {
  return attempt(async () => {
    const versionId = await ensureEditableVersion(episodeId, "select-image");
    const image = await db.sceneImage.findUniqueOrThrow({ where: { id: imageId } });
    if (image.status !== "SUCCEEDED") throw new Error("That image did not generate successfully.");
    await db.scene.update({ where: { episodeVersionId_sceneNumber: { episodeVersionId: versionId, sceneNumber } }, data: { currentImageId: imageId } });
  });
}

/** Restores an older script version by forking it as the new current version. */
export async function restoreVersion(episodeId: string, versionId: string) {
  return attempt(async () => {
    const v = await db.episodeVersion.findUniqueOrThrow({ where: { id: versionId } });
    if (v.episodeId !== episodeId) throw new Error("Version does not belong to this episode.");
    await forkVersion(versionId, { reason: `restore-v${v.version}`, keepVoiceover: true });
    await db.episode.update({ where: { id: episodeId }, data: { status: "SCRIPTED" } });
  });
}

// ───────────────────────────── Jobs ─────────────────────────────

export async function cancelJobAction(jobId: string) {
  return attempt(() => cancelJob(jobId));
}

export async function retryJobAction(jobId: string) {
  return attempt(() => retryJob(jobId));
}

// ───────────────────────────── Settings ─────────────────────────────

export async function saveModelsAndPricing(models: unknown, pricing: unknown) {
  return attempt(async () => {
    const m = ModelsSchema.parse(models);
    const p = PricingSchema.parse(pricing);
    await writeSetting("models", m);
    await writeSetting("pricing", p);
  });
}

export async function saveVoices(voices: unknown) {
  return attempt(async () => writeSetting("voices", z.array(VoiceSchema).parse(voices)));
}

export async function importElevenLabsVoices() {
  return attempt(async () => {
    const voices = await listElevenLabsVoices();
    return voices;
  });
}

export async function saveVoiceSettings(input: unknown) {
  return attempt(async () => writeSetting("voiceSettings", VoiceSettingsSchema.parse(input)));
}

export async function saveAudioMix(input: unknown) {
  return attempt(async () => writeSetting("audioMix", AudioMixSchema.parse(input)));
}

export async function saveDefaults(input: unknown) {
  return attempt(async () => writeSetting("defaults", DefaultsSchema.parse(input)));
}

const AudioAssetInput = z.object({
  name: z.string().min(1).max(200),
  kind: z.enum(["MUSIC", "SFX"]),
  url: z.string().url(),
  license: z.string().min(2).max(500),
  source: z.string().min(2).max(500),
  attribution: z.string().max(500).optional(),
});

export async function addAudioAsset(input: z.input<typeof AudioAssetInput>) {
  return attempt(async () => {
    const data = AudioAssetInput.parse(input);
    await db.audioAsset.create({ data });
  });
}

