"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { cancelJob, enqueueEpisodeJob, enqueueIdeation, retryJob } from "@/lib/enqueue";
import { ILLUSTRATION_STYLES, TARGET_DURATIONS } from "@/lib/constants";
import { PricingSchema } from "@/lib/costs/pricing";
import {
  AudioMixSchema,
  DefaultsSchema,
  getDefaults,
  getVoices,
  ModelsSchema,
  VoiceSchema,
  VoiceSettingsSchema,
  writeSetting,
} from "@/lib/settings";
import { approveEpisode as approve, ensureEditableVersion, forkVersion, refreshStoryStatus } from "@/lib/pipeline/versions";
import { listElevenLabsVoices } from "@/lib/providers/speech";
import { normalizeTitle } from "@/lib/text";
import { createChannelFromBrief, PITCHES_SHOWN, storyFromPitch } from "@/lib/pipeline/channels";
import { ChannelEditSchema } from "@/lib/schemas/channel";
import { productionDeps } from "@/lib/pipeline/deps";
import type { EpisodeSpecRecord } from "@/lib/schemas/episode";
import { withDismissal } from "@/lib/process/review";

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

// ───────────────────────────── Channels ─────────────────────────────

/** Designs a channel from the producer's prompt, then opens it to review and edit. */
export async function createChannel(brief: string): Promise<ActionResult<{ channelId: string }>> {
  let channelId = "";
  const result = await attempt(async () => {
    const text = z.string().trim().min(10, "Describe the channel in a sentence or two.").max(3000).parse(brief);
    const channel = await createChannelFromBrief({ brief: text, deps: productionDeps });
    channelId = channel.id;
    return { channelId };
  });
  if (result.ok) redirect(`/channels/${channelId}`);
  return result;
}

export async function updateChannel(channelId: string, input: unknown) {
  return attempt(async () => {
    const data = ChannelEditSchema.parse(input);
    if (!(TARGET_DURATIONS as readonly number[]).includes(data.targetDurationSec)) throw new Error("Duration must be 60, 75 or 90 seconds.");
    if (!(data.styleKey in ILLUSTRATION_STYLES)) throw new Error("Unknown illustration style.");
    await db.channel.update({ where: { id: channelId }, data });
  });
}

export async function setChannelArchived(channelId: string, archived: boolean) {
  return attempt(async () => {
    await db.channel.update({ where: { id: channelId }, data: { archivedAt: archived ? new Date() : null } });
  });
}

// ───────────────────────────── Generate ─────────────────────────────

/** Pitches ideas for a channel from the producer's idea, or fresh ones when `idea` is empty ("Surprise me"). */
export async function pitchIdeas(channelId: string, idea: string | null): Promise<ActionResult<{ batchId: string }>> {
  let batchId = "";
  const result = await attempt(async () => {
    const text = z.string().trim().max(2000).nullable().parse(idea) || null;
    const channel = await db.channel.findUniqueOrThrow({ where: { id: channelId } });
    if (channel.archivedAt) throw new Error("This channel is archived.");
    const voiceId = channel.voiceId ?? (await getVoices())[0]?.id;
    if (!voiceId) throw new Error("Add a narrator voice in Settings first.");
    const batch = await db.batch.create({
      data: {
        customDirection: text,
        requestedCount: PITCHES_SHOWN,
        targetDurationSec: channel.targetDurationSec,
        styleKey: channel.styleKey,
        voiceId,
        quality: channel.quality,
        maxBudgetUsd: (await getDefaults()).maxBatchBudgetUsd.toFixed(2),
        channelId: channel.id,
      },
    });
    batchId = batch.id;
    await enqueueIdeation(batch.id);
    return { batchId };
  });
  if (result.ok) redirect(`/batches/${batchId}`);
  return result;
}

/** The producer picks a pitch: it becomes a story and every part's script is written (each stops at the script gate). */
export async function writePitch(conceptId: string): Promise<ActionResult<{ storyId: string }>> {
  let storyId = "";
  const result = await attempt(async () => {
    const story = await storyFromPitch(conceptId);
    storyId = story.id;
    const part1 = await db.episode.findFirstOrThrow({ where: { storyId: story.id, partNumber: 1 } });
    if (part1.status === "DRAFT" && !part1.currentVersionId) {
      await enqueueEpisodeJob({ episodeId: part1.id, continueProduction: true, request: { action: "produce" } });
    }
    return { storyId };
  });
  if (result.ok) redirect(`/stories/${storyId}`);
  return result;
}

// ───────────────────────────── Stories ─────────────────────────────

export async function updateStoryTitle(storyId: string, title: string) {
  return attempt(async () => {
    const t = z.string().trim().min(3).max(200).parse(title);
    await db.story.update({ where: { id: storyId }, data: { title: t, normalizedTitle: normalizeTitle(t), lastActivityAt: new Date() } });
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

export async function approveEpisodeAction(episodeId: string) {
  return attempt(() => approve(episodeId));
}

export async function markPublished(episodeId: string, input: { url?: string; platform?: string; publishedAt?: string }) {
  return attempt(async () => {
    const data = z
      .object({ url: z.string().url().optional().or(z.literal("")), platform: z.string().max(50).optional(), publishedAt: z.string().optional() })
      .parse(input);
    const episode = await db.episode.findUniqueOrThrow({ where: { id: episodeId } });
    if (episode.status !== "APPROVED" && episode.status !== "PUBLISHED") {
      throw new Error("Approve the episode before marking it published, so its script is locked.");
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
  earlyRetention: z.coerce.number().min(0).max(100).optional(),
  completionRate: z.coerce.number().min(0).max(100).optional(),
  rewatchRate: z.coerce.number().min(0).optional(),
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

// ───────────────────────────── Script checks ───────────────────────────

/** The producer judges a flagged issue to be wrong. Recorded (it counts as a false positive) and the gate is re-evaluated. */
export async function dismissScriptIssue(versionId: string, issueId: string, note: string) {
  return attempt(async () => {
    const version = await db.episodeVersion.findUniqueOrThrow({ where: { id: versionId }, include: { episode: true } });
    if (version.episode.currentVersionId !== versionId) throw new Error("This is not the current script version.");
    const spec = version.spec as EpisodeSpecRecord;
    if (!spec.quality) throw new Error("This script has no checks to dismiss.");
    const quality = withDismissal(spec.quality, issueId, z.string().max(500).parse(note ?? ""));
    await db.episodeVersion.update({ where: { id: versionId }, data: { spec: { ...spec, quality }, qualityStatus: quality.status } });
  });
}

/** The producer's own 1–5 rating of a script. */
export async function rateScript(versionId: string, rating: number | null) {
  return attempt(async () => {
    const value = rating === null ? null : z.number().int().min(1).max(5).parse(rating);
    await db.episodeVersion.update({ where: { id: versionId }, data: { humanRating: value } });
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

