"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { cancelJob, enqueueEpisodeJob, enqueueScriptJob, retryJob } from "@/lib/enqueue";
import { ILLUSTRATION_STYLES } from "@/lib/constants";
import { PricingSchema } from "@/lib/costs/pricing";
import {
  AudioMixSchema,
  DefaultsSchema,
  getVoices,
  ModelsSchema,
  VoiceSchema,
  VoiceSettingsSchema,
  writeSetting,
} from "@/lib/settings";
import { approveEpisode as approve, editHeadline, editScene, ensureEditableVersion, forkVersion, refreshStoryStatus } from "@/lib/pipeline/versions";
import { listElevenLabsVoices } from "@/lib/providers/speech";
import { normalizeTitle } from "@/lib/text";
import { ChannelEditSchema } from "@/lib/schemas/channel";
import { productionDeps } from "@/lib/pipeline/deps";
import { writePostCopy } from "@/lib/pipeline/post";
import { createStoryFromScript, type ScriptInput } from "@/lib/pipeline/paste";
import { archiveStories } from "@/lib/pipeline/archive";

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

/** Sets up a channel: its voice, art style, quality and description. */
export async function createChannel(input: unknown): Promise<ActionResult<{ channelId: string }>> {
  let channelId = "";
  const result = await attempt(async () => {
    const data = ChannelEditSchema.parse(input);
    if (!(data.styleKey in ILLUSTRATION_STYLES)) throw new Error("Unknown illustration style.");
    const channel = await db.channel.create({ data: { ...data, format: "CUSTOM" } });
    channelId = channel.id;
    return { channelId };
  });
  if (result.ok) redirect(`/channels/${channelId}`);
  return result;
}

export async function updateChannel(channelId: string, input: unknown) {
  return attempt(async () => {
    const data = ChannelEditSchema.parse(input);
    if (!(data.styleKey in ILLUSTRATION_STYLES)) throw new Error("Unknown illustration style.");
    await db.channel.update({ where: { id: channelId }, data });
  });
}

export async function setChannelArchived(channelId: string, archived: boolean) {
  return attempt(async () => {
    await db.channel.update({ where: { id: channelId }, data: { archivedAt: archived ? new Date() : null } });
  });
}

// ───────────────────────────── Make videos ─────────────────────────────

/** The producer's script becomes a story of `parts` videos: split, storyboarded, illustrated, voiced and rendered. */
export async function createFromScript(input: ScriptInput): Promise<ActionResult<{ storyId: string }>> {
  let storyId = "";
  const result = await attempt(async () => {
    const channel = await db.channel.findUniqueOrThrow({ where: { id: input.channelId } });
    if (!channel.voiceId && !(await getVoices())[0]) throw new Error("Add a narrator voice in Settings first.");
    if (!channel.voiceId) await db.channel.update({ where: { id: channel.id }, data: { voiceId: (await getVoices())[0].id } });
    const story = await createStoryFromScript(input);
    storyId = story.id;
    await enqueueScriptJob({ storyId, hook: input.hook?.trim() || null, titleLocked: Boolean(input.title?.trim()) });
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

/** Archives stories and permanently deletes their images, audio and videos. There is no unarchive. */
export async function archiveStoriesAction(storyIds: string[]) {
  return attempt(async () => {
    const ids = z.array(z.string().min(1)).min(1).max(500).parse(storyIds);
    return archiveStories(ids);
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

/** Writes (or rewrites) the posting text for the episode's current version. One fast model call. */
export async function writePostCopyAction(episodeId: string) {
  return attempt(async () => {
    const episode = await db.episode.findUniqueOrThrow({ where: { id: episodeId } });
    if (!episode.currentVersionId) throw new Error("This part hasn't been storyboarded yet.");
    await writePostCopy({ versionId: episode.currentVersionId, cost: { storyId: episode.storyId, episodeId }, deps: productionDeps });
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

/** The producer's edit of one shot's words and picture. Saves a new version, then makes only what changed and a new MP4. */
export async function editSceneAction(episodeId: string, sceneNumber: number, edit: { narration: string; imagePrompt: string }) {
  return attempt(async () => {
    const data = z.object({ narration: z.string().max(2000), imagePrompt: z.string().max(2000) }).parse(edit);
    await assertNotArchived(episodeId);
    const { changed } = await editScene(episodeId, z.number().int().parse(sceneNumber), data);
    if (changed) await enqueueEpisodeJob({ episodeId, continueProduction: true, request: { action: "render" } });
    return { changed };
  });
}

/** The producer's own title and on-screen hook text. A new MP4 is rendered with them; nothing else is regenerated. */
export async function editHeadlineAction(episodeId: string, edit: { title: string; onScreenHook: string }) {
  return attempt(async () => {
    const data = z.object({ title: z.string().max(200), onScreenHook: z.string().max(80) }).parse(edit);
    await assertNotArchived(episodeId);
    const { changed } = await editHeadline(episodeId, data);
    if (changed) await enqueueEpisodeJob({ episodeId, continueProduction: true, request: { action: "render" } });
    return { changed };
  });
}

async function assertNotArchived(episodeId: string) {
  const episode = await db.episode.findUniqueOrThrow({ where: { id: episodeId }, include: { story: true } });
  if (episode.story.status === "ARCHIVED") throw new Error("Unarchive the story first.");
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
    // A restored version needs rendering (and approving) again; the page offers "Render now".
    const episode = await db.episode.findUniqueOrThrow({ where: { id: episodeId } });
    if (episode.status === "APPROVED" || episode.status === "PUBLISHED") await db.episode.update({ where: { id: episodeId }, data: { status: "READY" } });
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

