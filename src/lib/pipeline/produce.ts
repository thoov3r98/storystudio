import { z } from "zod";
import { db } from "@/lib/db";
import { setJobStage } from "@/lib/jobs";
import type { CostContext } from "@/lib/costs/record";
import { computeStaleness } from "@/lib/invalidation";
import { reviseEpisode, rewriteScene, writeEpisode } from "./writing";
import type { EpisodeSpecRecord } from "@/lib/schemas/episode";
import { generateSceneImages } from "./illustrations";
import { generateVoiceover, synchronizeNarration } from "./voiceover";
import { renderVersion } from "./render";
import { ensureEditableVersion, refreshStoryStatus } from "./versions";
import type { PipelineDeps } from "./deps";

export const EpisodeActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("produce"), direction: z.string().nullish() }),
  z.object({ action: z.literal("regenerate-script"), direction: z.string().nullish() }),
  /** Fix the issues flagged on the current script with targeted revisions. */
  z.object({ action: z.literal("revise-script") }),
  z.object({ action: z.literal("rewrite-scene"), sceneNumber: z.number().int(), instruction: z.string().nullish() }),
  z.object({ action: z.literal("regenerate-image"), sceneNumbers: z.array(z.number().int()).min(1) }),
  z.object({ action: z.literal("regenerate-voiceover") }),
  /** At the script gate, `acceptOpenNotes` is the producer's explicit override of non-blocking issues. */
  z.object({ action: z.literal("render"), acceptOpenNotes: z.boolean().optional() }),
]);

export const EpisodeJobPayloadSchema = z.object({
  jobId: z.string(),
  episodeId: z.string(),
  /** Continue through to a fresh MP4 after the requested change. */
  continueProduction: z.boolean().default(true),
  budgetUsd: z.number().nullish(),
  batchId: z.string().nullish(),
  request: EpisodeActionSchema,
});

export type EpisodeJobPayload = z.infer<typeof EpisodeJobPayloadSchema>;

/** The script gate refused to spend on media for this script. */
export class ScriptGateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScriptGateError";
  }
}

/**
 * The script gate. A blocked script can never be produced; one with open
 * issues needs the producer's explicit override, which is recorded.
 */
async function assertScriptApproved(episodeId: string, acceptOpenNotes: boolean) {
  const { currentVersion: v } = await db.episode.findUniqueOrThrow({ where: { id: episodeId }, include: { currentVersion: true } });
  if (!v || !v.qualityStatus || v.qualityStatus === "passed") return;
  const spec = v.spec as EpisodeSpecRecord;
  if (v.qualityStatus === "blocked") {
    throw new ScriptGateError("This script has blocking plot problems. Fix the flagged issues, rewrite the lines, regenerate it, or dismiss an issue you judge to be wrong. Nothing was spent on media.");
  }
  if (v.qualityStatus === "needs-attention") {
    if (spec.quality?.override) return;
    if (!acceptOpenNotes) throw new ScriptGateError("This script has open issues from the checks. Review them, then approve with the override to make the video anyway.");
    if (spec.quality) {
      const open = spec.quality.issues.filter((i) => i.severity !== "minor" && !spec.quality!.dismissed.some((d) => d.issueId === i.id)).length + spec.quality.mustFix.length;
      await db.episodeVersion.update({ where: { id: v.id }, data: { spec: { ...spec, quality: { ...spec.quality, override: { at: new Date().toISOString(), open } } } } });
    }
  }
}

/**
 * Runs the downstream stages for the episode's current version, skipping any
 * stage whose artifact is already present and current. This is what makes
 * retries resume instead of restarting, and keeps regeneration minimal.
 */
async function produceDownstream(episodeId: string, jobId: string, cost: CostContext, deps: PipelineDeps) {
  await assertScriptApproved(episodeId, false);
  const episode = await db.episode.findUniqueOrThrow({ where: { id: episodeId } });
  const versionId = episode.currentVersionId;
  if (!versionId) throw new Error("No script version to produce.");
  await db.episode.update({ where: { id: episodeId }, data: { status: "IN_PRODUCTION" } });
  await refreshStoryStatus(episode.storyId);

  const load = () =>
    db.episodeVersion.findUniqueOrThrow({
      where: { id: versionId },
      include: { voiceover: true, scenes: { orderBy: { sceneNumber: "asc" }, include: { currentImage: true } } },
    });

  await setJobStage(jobId, "GENERATING_SCENES", "Preparing scenes", 0.3);
  let v = await load();
  const missing = v.scenes.filter((s) => !s.currentImage || s.currentImage.status !== "SUCCEEDED").map((s) => s.sceneNumber);
  if (missing.length) {
    await setJobStage(jobId, "GENERATING_ILLUSTRATIONS", `Illustrating ${missing.length} scenes`, 0.32);
    await generateSceneImages({ versionId, sceneNumbers: missing, jobId, cost, deps, progress: { from: 0.32, to: 0.6 } });
  }

  v = await load();
  if (!v.voiceover || v.voiceover.status !== "SUCCEEDED") {
    await setJobStage(jobId, "GENERATING_VOICEOVER", "Recording narration", 0.62);
    await generateVoiceover({ versionId, cost, deps });
  }

  v = await load();
  if (!v.timing) {
    await setJobStage(jobId, "SYNCHRONIZING_NARRATION", "Aligning scenes and captions to the voiceover", 0.75);
    await synchronizeNarration(versionId);
  }

  v = await load();
  const latest = await db.render.findFirst({ where: { episodeVersionId: versionId, status: "SUCCEEDED" }, orderBy: { createdAt: "desc" } });
  const staleness = computeStaleness({
    scenes: v.scenes.map((s) => ({ sceneNumber: s.sceneNumber, currentImageId: s.currentImageId })),
    voiceoverId: v.voiceoverId,
    hasTiming: Boolean(v.timing),
    latestSucceededRender: latest ? { inputs: latest.inputs as { voiceoverId: string; imageIds: Record<string, string> } } : null,
  });
  if (staleness.renderMissing || staleness.renderOutdated) {
    await setJobStage(jobId, "RENDERING_VIDEO", "Rendering video", 0.8);
    await renderVersion({ versionId, jobId, cost, client: deps.render() });
  } else {
    await db.episode.update({ where: { id: episodeId }, data: { status: "READY" } });
    await refreshStoryStatus(episode.storyId);
  }
  return { versionId };
}

export async function runEpisodeJob(payload: EpisodeJobPayload, deps: PipelineDeps) {
  const episode = await db.episode.findUniqueOrThrow({ where: { id: payload.episodeId } });
  const cost: CostContext = {
    jobId: payload.jobId,
    storyId: episode.storyId,
    episodeId: episode.id,
    batchId: payload.batchId ?? null,
    budgetUsd: payload.budgetUsd ?? null,
    budgetScope: payload.batchId ? "batch" : "job",
  };
  const ctx = { episodeId: episode.id, cost, deps };
  const req = payload.request;
  const { jobId } = payload;

  const write = async (reason: string, direction?: string | null) => {
    await setJobStage(jobId, "WRITING_STORY", "Planning, writing and checking the script", 0.02);
    return writeEpisode({ ...ctx, jobId, reason, direction });
  };
  // A changed script only goes on to media when it passed its checks; otherwise it waits at the gate.
  const continueIfPassed = async (status: string | null) => {
    if (payload.continueProduction && status === "passed") return produceDownstream(episode.id, jobId, cost, deps);
    await db.episode.update({ where: { id: episode.id }, data: { status: "SCRIPTED" } });
    await refreshStoryStatus(episode.storyId);
    return { scripted: true };
  };

  switch (req.action) {
    case "produce": {
      // Script gate: a new script always stops for review before anything is spent on images,
      // narration or rendering. Approving it ("render") makes the video.
      if (!episode.currentVersionId) {
        await write("initial", req.direction);
        return { scripted: true };
      }
      return produceDownstream(episode.id, jobId, cost, deps);
    }
    case "regenerate-script": {
      const result = await write("regenerate-script", req.direction);
      return continueIfPassed(result.quality.status);
    }
    case "revise-script": {
      await setJobStage(jobId, "WRITING_STORY", "Fixing the flagged issues", 0.02);
      await reviseEpisode({ ...ctx, jobId });
      return { scripted: true };
    }
    case "rewrite-scene": {
      await setJobStage(jobId, "WRITING_STORY", `Rewriting scene ${req.sceneNumber}`, 0.1);
      const { versionId } = await rewriteScene({ ...ctx, jobId, sceneNumber: req.sceneNumber, instruction: req.instruction });
      const v = await db.episodeVersion.findUniqueOrThrow({ where: { id: versionId }, select: { qualityStatus: true } });
      // Scripts written before the checks have no status and keep their old behaviour.
      return continueIfPassed(v.qualityStatus ?? "passed");
    }
    case "regenerate-image": {
      await assertScriptApproved(episode.id, false);
      const versionId = await ensureEditableVersion(episode.id, "regenerate-image");
      await setJobStage(jobId, "GENERATING_ILLUSTRATIONS", `Regenerating ${req.sceneNumbers.length} image(s)`, 0.1);
      await generateSceneImages({ versionId, sceneNumbers: req.sceneNumbers, jobId, cost, deps, progress: { from: 0.1, to: 0.75 } });
      return payload.continueProduction ? produceDownstream(episode.id, jobId, cost, deps) : { versionId };
    }
    case "regenerate-voiceover": {
      await assertScriptApproved(episode.id, false);
      const versionId = await ensureEditableVersion(episode.id, "regenerate-voiceover");
      await setJobStage(jobId, "GENERATING_VOICEOVER", "Recording narration", 0.1);
      await generateVoiceover({ versionId, cost, deps });
      await setJobStage(jobId, "SYNCHRONIZING_NARRATION", "Aligning scenes and captions", 0.6);
      await synchronizeNarration(versionId);
      return payload.continueProduction ? produceDownstream(episode.id, jobId, cost, deps) : { versionId };
    }
    case "render": {
      await assertScriptApproved(episode.id, req.acceptOpenNotes ?? false);
      return produceDownstream(episode.id, jobId, cost, deps);
    }
  }
}
