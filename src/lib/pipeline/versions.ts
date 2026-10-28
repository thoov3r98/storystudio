import { db } from "@/lib/db";
import { applyBibleUpdate, openThreads, StoryBibleUpdateSchema } from "@/lib/schemas/story-bible";
import { EpisodeSpecRecordSchema } from "@/lib/schemas/episode";
import { countWords, estimateSpokenDuration, joinNarration } from "@/lib/text";
import { loadCanonicalBible } from "./context";

type SceneOverride = { narration?: string; imagePrompt?: string; composition?: string; dropImage?: boolean };

/**
 * Copies a version into a new DRAFT version. Scenes keep their current images
 * unless overridden; the voiceover is kept only when narration is unchanged.
 */
export async function forkVersion(
  versionId: string,
  opts: { reason: string; keepVoiceover: boolean; sceneOverrides?: Record<number, SceneOverride>; resetFactCheck?: boolean; specPatch?: Record<string, unknown> },
): Promise<string> {
  const source = await db.episodeVersion.findUniqueOrThrow({
    where: { id: versionId },
    include: { scenes: { orderBy: { sceneNumber: "asc" } }, proposal: true, claims: true },
  });
  const scenes = source.scenes.map((s) => {
    const o = opts.sceneOverrides?.[s.sceneNumber];
    return {
      sceneNumber: s.sceneNumber,
      narration: o?.narration ?? s.narration,
      imagePrompt: o?.imagePrompt ?? s.imagePrompt,
      composition: o?.composition ?? s.composition,
      characters: s.characters,
      objects: s.objects,
      intendedDurationSec: s.intendedDurationSec,
      motionPreset: s.motionPreset,
      currentImageId: o?.dropImage ? null : s.currentImageId,
    };
  });
  const narration = joinNarration(scenes);
  const narrationChanged = narration !== source.narration;
  const spec = { ...(source.spec as object), ...(opts.specPatch ?? {}), narration, wordCount: countWords(narration) };

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
        estimatedDurationSec: narrationChanged ? estimateSpokenDuration(narration) : source.estimatedDurationSec,
        summary: source.summary,
        factCheckStatus: opts.resetFactCheck ? "PENDING" : source.factCheckStatus,
        factReview: source.factReview ?? undefined,
        continuityReview: source.continuityReview ?? undefined,
        styleKey: source.styleKey,
        voiceoverId: opts.keepVoiceover && !narrationChanged ? source.voiceoverId : null,
        timing: opts.keepVoiceover && !narrationChanged ? (source.timing ?? undefined) : undefined,
        scenes: { create: scenes },
      },
    });
    if (!opts.resetFactCheck && source.claims.length) {
      await tx.factClaim.createMany({
        data: source.claims.map(({ id: _id, createdAt: _c, updatedAt: _u, episodeVersionId: _v, ...c }) => ({ ...c, episodeVersionId: created.id })),
      });
    }
    if (source.proposal) {
      await tx.bibleUpdateProposal.create({
        data: { storyId: source.proposal.storyId, episodeVersionId: created.id, baseBibleVersion: source.proposal.baseBibleVersion, update: source.proposal.update as object },
      });
      if (source.proposal.status === "PENDING") {
        await tx.bibleUpdateProposal.update({ where: { id: source.proposal.id }, data: { status: "SUPERSEDED", resolvedAt: new Date() } });
      }
    }
    if (source.status === "DRAFT") await tx.episodeVersion.update({ where: { id: source.id }, data: { status: "SUPERSEDED" } });
    await tx.episode.update({ where: { id: source.episodeId }, data: { currentVersionId: created.id } });
    return created.id;
  });
}

/**
 * Returns a version that may be modified. Approved/published versions are
 * locked, so a DRAFT copy is forked (and becomes current) instead.
 */
export async function ensureEditableVersion(episodeId: string, reason: string): Promise<string> {
  const episode = await db.episode.findUniqueOrThrow({ where: { id: episodeId }, include: { currentVersion: true } });
  if (!episode.currentVersion) throw new Error("This episode has no script yet.");
  if (episode.currentVersion.status !== "APPROVED") return episode.currentVersion.id;
  const forked = await forkVersion(episode.currentVersion.id, { reason: `fork-locked:${reason}`, keepVoiceover: true });
  // A changed episode must be re-approved; published state is kept on the episode for history.
  await db.episode.update({ where: { id: episodeId }, data: { status: "READY" } });
  return forked;
}

/**
 * Swaps the opening hook. If scene 1 starts with the old hook it is replaced in
 * place (new version, images kept, voiceover regenerated). Returns null when a
 * full rewrite is needed instead.
 */
export async function applyHookSwap(episodeId: string, hookId: string): Promise<string | null> {
  const hook = await db.hook.findUniqueOrThrow({ where: { id: hookId } });
  const episode = await db.episode.findUniqueOrThrow({
    where: { id: episodeId },
    include: { currentVersion: { include: { scenes: { orderBy: { sceneNumber: "asc" }, take: 1 } } } },
  });
  await db.$transaction([
    db.hook.updateMany({ where: { episodeId }, data: { isPrimary: false } }),
    db.hook.update({ where: { id: hookId }, data: { isPrimary: true } }),
  ]);
  const version = episode.currentVersion;
  if (!version) return null;
  const spec = EpisodeSpecRecordSchema.partial().parse(version.spec);
  const oldHook = spec.selectedHook?.trim();
  const scene1 = version.scenes[0];
  if (!oldHook || !scene1 || !scene1.narration.trim().startsWith(oldHook)) return null;
  const narration = `${hook.text.trim()} ${scene1.narration.trim().slice(oldHook.length).trim()}`.trim();
  return forkVersion(version.id, {
    reason: "regenerate-hook",
    keepVoiceover: false,
    resetFactCheck: true,
    sceneOverrides: { 1: { narration } },
    specPatch: { selectedHook: hook.text.trim(), alternativeHooks: [...(spec.alternativeHooks ?? []).filter((h) => h !== hook.text), oldHook] },
  });
}

export class ApprovalBlockedError extends Error {
  constructor(public readonly reasons: string[]) {
    super(`Episode cannot be approved: ${reasons.join(" ")}`);
    this.name = "ApprovalBlockedError";
  }
}

/** Reasons approval should be blocked; empty when the episode can be approved. */
export async function approvalBlockers(episodeId: string): Promise<string[]> {
  const episode = await db.episode.findUniqueOrThrow({ where: { id: episodeId }, include: { currentVersion: { include: { claims: true } } } });
  const v = episode.currentVersion;
  const reasons: string[] = [];
  if (!v) return ["There is no script to approve."];
  const flagged = v.claims.filter((c) => c.status === "FLAGGED" || c.status === "UNVERIFIED");
  if (v.factCheckStatus === "PENDING") reasons.push("The fact review has not run for this version.");
  if (flagged.length > 0 && v.factCheckStatus !== "MANUALLY_APPROVED") {
    reasons.push(`${flagged.length} claim(s) are flagged for verification. Verify, revise, or reject them first.`);
  }
  if (episode.partNumber > 1) {
    const earlier = await db.episode.count({ where: { storyId: episode.storyId, partNumber: { lt: episode.partNumber }, status: { notIn: ["APPROVED", "PUBLISHED"] } } });
    if (earlier > 0) reasons.push("Earlier parts must be approved first.");
  }
  return reasons;
}

/**
 * Approves an episode: locks its current version and applies its continuity
 * proposal to the story bible as a new canonical version.
 */
export async function approveEpisode(episodeId: string, opts: { applyProposal: boolean }) {
  const blockers = await approvalBlockers(episodeId);
  if (blockers.length) throw new ApprovalBlockedError(blockers);

  const episode = await db.episode.findUniqueOrThrow({ where: { id: episodeId }, include: { currentVersion: { include: { proposal: true } } } });
  const version = episode.currentVersion!;
  const bible = await loadCanonicalBible(episode.storyId);

  await db.$transaction(async (tx) => {
    await tx.episodeVersion.update({ where: { id: version.id }, data: { status: "APPROVED" } });
    await tx.episode.update({
      where: { id: episodeId },
      data: { status: episode.status === "PUBLISHED" ? "PUBLISHED" : "APPROVED", approvedAt: new Date() },
    });

    if (version.proposal && version.proposal.status === "PENDING") {
      if (opts.applyProposal) {
        const update = StoryBibleUpdateSchema.parse(version.proposal.update);
        const next = applyBibleUpdate(bible.data, update, episode.partNumber);
        await tx.storyBible.create({
          data: {
            storyId: episode.storyId,
            version: bible.version + 1,
            data: next,
            source: "episode-approval",
            sourceEpisodeId: episodeId,
            note: `Applied continuity from Part ${episode.partNumber} (version ${version.version}).`,
          },
        });
        await tx.story.update({ where: { id: episode.storyId }, data: { hasUnresolvedThreads: openThreads(next).length > 0 } });
      }
      await tx.bibleUpdateProposal.update({
        where: { id: version.proposal.id },
        data: { status: opts.applyProposal ? "APPLIED" : "REJECTED", resolvedAt: new Date() },
      });
    }

    await tx.story.update({
      where: { id: episode.storyId },
      data: { lastActivityAt: new Date(), ...(episode.partNumber > 1 ? { status: "CONTINUING" } : {}) },
    });
  });
}

/** Recomputes story status from its episodes (except ARCHIVED, which is sticky). */
export async function refreshStoryStatus(storyId: string) {
  const story = await db.story.findUniqueOrThrow({ where: { id: storyId }, include: { episodes: { select: { status: true, partNumber: true } } } });
  if (story.status === "ARCHIVED") return;
  const eps = story.episodes;
  let status = story.status;
  if (eps.some((e) => e.status === "IN_PRODUCTION")) status = "IN_PRODUCTION";
  else if (eps.some((e) => e.partNumber > 1)) status = "CONTINUING";
  else if (eps.some((e) => e.status === "PUBLISHED")) status = "PUBLISHED";
  else if (eps.some((e) => e.status === "READY" || e.status === "APPROVED")) status = "READY";
  else status = "CONCEPT";
  if (status !== story.status) await db.story.update({ where: { id: storyId }, data: { status } });
}
