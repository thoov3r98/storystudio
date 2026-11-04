import { db } from "@/lib/db";
import { firstSentence } from "@/lib/script";
import { playbackWordsPerSecond } from "@/lib/settings";
import { countWords, estimateSpokenDuration, joinNarration } from "@/lib/text";

type SceneOverride = { narration?: string; imagePrompt?: string; composition?: string; dropImage?: boolean };

/**
 * Copies a version into a new DRAFT version. Scenes keep their current images
 * unless overridden; the voiceover is kept only when narration is unchanged.
 */
export async function forkVersion(
  versionId: string,
  opts: { reason: string; keepVoiceover: boolean; sceneOverrides?: Record<number, SceneOverride>; specPatch?: Record<string, unknown> },
): Promise<string> {
  const source = await db.episodeVersion.findUniqueOrThrow({
    where: { id: versionId },
    include: { scenes: { orderBy: { sceneNumber: "asc" } }, episode: { include: { story: { select: { voiceId: true } } } } },
  });
  const wps = await playbackWordsPerSecond(source.episode.story.voiceId);
  const scenes = source.scenes.map((s) => {
    const o = opts.sceneOverrides?.[s.sceneNumber];
    const narrationEdited = o?.narration !== undefined && o.narration !== s.narration;
    return {
      sceneNumber: s.sceneNumber,
      narration: o?.narration ?? s.narration,
      imagePrompt: o?.imagePrompt ?? s.imagePrompt,
      composition: o?.composition ?? s.composition,
      continuity: s.continuity,
      characters: s.characters,
      objects: s.objects,
      intendedDurationSec: narrationEdited ? estimateSpokenDuration(o.narration!, wps) : s.intendedDurationSec,
      motionPreset: s.motionPreset,
      soundEffect: s.soundEffect,
      stepLabel: s.stepLabel,
      currentImageId: o?.dropImage ? null : s.currentImageId,
    };
  });
  const narration = joinNarration(scenes);
  const narrationChanged = narration !== source.narration;
  // The scenes are a cut of the story, so the story text and its opening follow any scene edit.
  const spec = { ...(source.spec as object), selectedHook: firstSentence(narration), ...(opts.specPatch ?? {}), narration, storyNarration: narration, wordCount: countWords(narration) };

  return db.$transaction(async (tx) => {
    const last = await tx.episodeVersion.aggregate({ where: { episodeId: source.episodeId }, _max: { version: true } });
    const created = await tx.episodeVersion.create({
      data: {
        episodeId: source.episodeId,
        version: (last._max.version ?? 0) + 1,
        parentVersionId: source.id,
        reason: opts.reason,
        spec,
        narration,
        wordCount: countWords(narration),
        estimatedDurationSec: narrationChanged ? estimateSpokenDuration(narration, wps) : source.estimatedDurationSec,
        summary: source.summary,
        styleKey: source.styleKey,
        imageShape: source.imageShape,
        voiceoverId: opts.keepVoiceover && !narrationChanged ? source.voiceoverId : null,
        timing: opts.keepVoiceover && !narrationChanged ? (source.timing ?? undefined) : undefined,
        scenes: { create: scenes },
      },
    });
    if (source.status === "DRAFT") await tx.episodeVersion.update({ where: { id: source.id }, data: { status: "SUPERSEDED" } });
    await tx.episode.update({ where: { id: source.episodeId }, data: { currentVersionId: created.id } });
    return created.id;
  });
}

/**
 * The producer's own edit of one shot: its words, its picture, or both. Changed words
 * mean a new voiceover; a changed picture means only that shot is drawn again.
 */
export async function editScene(episodeId: string, sceneNumber: number, edit: { narration: string; imagePrompt: string }): Promise<{ changed: boolean }> {
  const episode = await db.episode.findUniqueOrThrow({ where: { id: episodeId }, include: { currentVersion: { include: { scenes: true } } } });
  const v = episode.currentVersion;
  if (!v) throw new Error("This part hasn't been storyboarded yet.");
  const scene = v.scenes.find((s) => s.sceneNumber === sceneNumber);
  if (!scene) throw new Error(`There is no shot ${sceneNumber}.`);
  const narration = edit.narration.replace(/\s+/g, " ").trim();
  const imagePrompt = edit.imagePrompt.trim();
  if (!narration) throw new Error("A shot needs some narration. To drop its words, add them to the shot before or after it.");
  if (!imagePrompt) throw new Error("Describe what the picture shows.");
  const words = narration !== scene.narration;
  const picture = imagePrompt !== scene.imagePrompt;
  if (!words && !picture) return { changed: false };
  await forkVersion(v.id, {
    reason: `edit-scene-${sceneNumber}`,
    keepVoiceover: true,
    sceneOverrides: { [sceneNumber]: { narration, imagePrompt, dropImage: picture } },
  });
  await markEdited(episodeId, v.status);
  return { changed: true };
}

/** The producer's own title and on-screen hook for a part. Nothing is regenerated; the next render shows them. */
export async function editHeadline(episodeId: string, edit: { title: string; onScreenHook: string }): Promise<{ changed: boolean }> {
  const episode = await db.episode.findUniqueOrThrow({ where: { id: episodeId }, include: { currentVersion: true } });
  const v = episode.currentVersion;
  if (!v) throw new Error("This part hasn't been storyboarded yet.");
  const title = edit.title.trim();
  const onScreenHook = edit.onScreenHook.trim();
  if (!title) throw new Error("Give the video a title.");
  const spec = v.spec as { title?: string; onScreenHook?: string };
  if (title === (spec.title ?? episode.title) && onScreenHook === (spec.onScreenHook ?? "")) return { changed: false };
  await forkVersion(v.id, { reason: "edit-headline", keepVoiceover: true, specPatch: { title, onScreenHook: onScreenHook || undefined } });
  await db.episode.update({ where: { id: episodeId }, data: { title } });
  await markEdited(episodeId, v.status);
  return { changed: true };
}

/** An edited part needs a new MP4 (and, if it was approved, approving again). */
async function markEdited(episodeId: string, previousVersionStatus: string) {
  const episode = await db.episode.findUniqueOrThrow({ where: { id: episodeId } });
  if (previousVersionStatus === "APPROVED" || episode.status === "READY") await db.episode.update({ where: { id: episodeId }, data: { status: "READY" } });
  await db.story.update({ where: { id: episode.storyId }, data: { lastActivityAt: new Date() } });
}

/**
 * Returns a version that may be modified. Approved/published versions are
 * locked, so a DRAFT copy is forked (and becomes current) instead.
 */
export async function ensureEditableVersion(episodeId: string, reason: string): Promise<string> {
  const episode = await db.episode.findUniqueOrThrow({ where: { id: episodeId }, include: { currentVersion: true } });
  if (!episode.currentVersion) throw new Error("This part hasn't been storyboarded yet.");
  if (episode.currentVersion.status !== "APPROVED") return episode.currentVersion.id;
  const forked = await forkVersion(episode.currentVersion.id, { reason: `fork-locked:${reason}`, keepVoiceover: true });
  // A changed episode must be re-approved; published state is kept on the episode for history.
  await db.episode.update({ where: { id: episodeId }, data: { status: "READY" } });
  return forked;
}

export class ApprovalBlockedError extends Error {
  constructor(public readonly reasons: string[]) {
    super(`Episode cannot be approved: ${reasons.join(" ")}`);
    this.name = "ApprovalBlockedError";
  }
}

/** Reasons approval should be blocked; empty when the episode can be approved. */
export async function approvalBlockers(episodeId: string): Promise<string[]> {
  const episode = await db.episode.findUniqueOrThrow({ where: { id: episodeId }, include: { currentVersion: true } });
  const reasons: string[] = [];
  if (!episode.currentVersion) return ["There is no video to approve."];
  if (episode.partNumber > 1) {
    const earlier = await db.episode.count({ where: { storyId: episode.storyId, partNumber: { lt: episode.partNumber }, status: { notIn: ["APPROVED", "PUBLISHED"] } } });
    if (earlier > 0) reasons.push("Earlier parts must be approved first.");
  }
  return reasons;
}

/** Approves an episode: locks its current version, so later changes fork a new one. */
export async function approveEpisode(episodeId: string) {
  const blockers = await approvalBlockers(episodeId);
  if (blockers.length) throw new ApprovalBlockedError(blockers);

  const episode = await db.episode.findUniqueOrThrow({ where: { id: episodeId } });
  await db.$transaction([
    db.episodeVersion.update({ where: { id: episode.currentVersionId! }, data: { status: "APPROVED" } }),
    db.episode.update({
      where: { id: episodeId },
      data: { status: episode.status === "PUBLISHED" ? "PUBLISHED" : "APPROVED", approvedAt: new Date() },
    }),
    db.story.update({ where: { id: episode.storyId }, data: { lastActivityAt: new Date() } }),
  ]);
}

/** Recomputes story status from its episodes (except ARCHIVED, which is sticky). */
export async function refreshStoryStatus(storyId: string) {
  const story = await db.story.findUniqueOrThrow({ where: { id: storyId }, include: { episodes: { select: { status: true, partNumber: true } } } });
  if (story.status === "ARCHIVED") return;
  const eps = story.episodes;
  let status = story.status;
  if (eps.some((e) => e.status === "IN_PRODUCTION")) status = "IN_PRODUCTION";
  // Parts written ahead of time don't make a story "continuing" until one is produced.
  else if (eps.some((e) => e.partNumber > 1 && e.status !== "DRAFT" && e.status !== "SCRIPTED")) status = "CONTINUING";
  else if (eps.some((e) => e.status === "PUBLISHED")) status = "PUBLISHED";
  else if (eps.some((e) => e.status === "READY" || e.status === "APPROVED")) status = "READY";
  else status = "CONCEPT";
  if (status !== story.status) await db.story.update({ where: { id: storyId }, data: { status } });
}
