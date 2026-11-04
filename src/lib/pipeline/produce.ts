import { z } from "zod";
import { db } from "@/lib/db";
import { setJobStage } from "@/lib/jobs";
import type { CostContext } from "@/lib/costs/record";
import { computeStaleness } from "@/lib/invalidation";
import { generateSceneImages } from "./illustrations";
import { generateVoiceover, synchronizeNarration } from "./voiceover";
import { renderVersion } from "./render";
import { writePostCopy } from "./post";
import { ensureEditableVersion, refreshStoryStatus } from "./versions";
import type { PipelineDeps } from "./deps";

export const EpisodeActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("regenerate-image"), sceneNumbers: z.array(z.number().int()).min(1) }),
  z.object({ action: z.literal("regenerate-voiceover") }),
  /** Makes whatever is missing or stale, then the MP4. `rerender`: render again with the current settings even if nothing changed. */
  z.object({ action: z.literal("render"), rerender: z.boolean().optional() }),
]);

export const EpisodeJobPayloadSchema = z.object({
  jobId: z.string(),
  episodeId: z.string(),
  /** Continue through to a fresh MP4 after the requested change. */
  continueProduction: z.boolean().default(true),
  budgetUsd: z.number().nullish(),
  request: EpisodeActionSchema,
});

export type EpisodeJobPayload = z.infer<typeof EpisodeJobPayloadSchema>;

/**
 * Runs the downstream stages for the episode's current version, skipping any
 * stage whose artifact is already present and current. This is what makes
 * retries resume instead of restarting, and keeps regeneration minimal.
 */
async function produceDownstream(episodeId: string, jobId: string, cost: CostContext, deps: PipelineDeps, opts: { rerender?: boolean } = {}) {
  const episode = await db.episode.findUniqueOrThrow({ where: { id: episodeId } });
  const versionId = episode.currentVersionId;
  if (!versionId) throw new Error("This part hasn't been storyboarded yet.");
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
  // A re-render picks up changed settings (pauses, speed, volumes, music), which the inputs don't record.
  if (opts.rerender || staleness.renderMissing || staleness.renderOutdated) {
    await setJobStage(jobId, "RENDERING_VIDEO", "Rendering video", 0.8);
    await renderVersion({ versionId, jobId, cost, client: deps.render(), sound: deps.sound });
    // The posting text is a convenience: a failure is logged, and it can be written again from the episode page.
    // The script hasn't changed on a re-render, so existing text is kept.
    if (!(opts.rerender && v.postCopy)) {
      await writePostCopy({ versionId, cost, deps }).catch((err) => console.warn(`Post text not written: ${String((err as Error)?.message ?? err)}`));
    }
  } else {
    await db.episode.update({ where: { id: episodeId }, data: { status: "READY" } });
    await refreshStoryStatus(episode.storyId);
  }
  return { versionId };
}

export async function runEpisodeJob(payload: EpisodeJobPayload, deps: PipelineDeps) {
  const episode = await db.episode.findUniqueOrThrow({ where: { id: payload.episodeId } });
  const cost: CostContext = { jobId: payload.jobId, storyId: episode.storyId, episodeId: episode.id, budgetUsd: payload.budgetUsd ?? null };
  const req = payload.request;
  const { jobId } = payload;

  switch (req.action) {
    case "regenerate-image": {
      const versionId = await ensureEditableVersion(episode.id, "regenerate-image");
      await setJobStage(jobId, "GENERATING_ILLUSTRATIONS", `Regenerating ${req.sceneNumbers.length} image(s)`, 0.1);
      await generateSceneImages({ versionId, sceneNumbers: req.sceneNumbers, jobId, cost, deps, progress: { from: 0.1, to: 0.75 } });
      return payload.continueProduction ? produceDownstream(episode.id, jobId, cost, deps) : { versionId };
    }
    case "regenerate-voiceover": {
      const versionId = await ensureEditableVersion(episode.id, "regenerate-voiceover");
      await setJobStage(jobId, "GENERATING_VOICEOVER", "Recording narration", 0.1);
      await generateVoiceover({ versionId, cost, deps });
      await setJobStage(jobId, "SYNCHRONIZING_NARRATION", "Aligning scenes and captions", 0.6);
      await synchronizeNarration(versionId);
      return payload.continueProduction ? produceDownstream(episode.id, jobId, cost, deps) : { versionId };
    }
    case "render":
      return produceDownstream(episode.id, jobId, cost, deps, { rerender: req.rerender });
  }
}
