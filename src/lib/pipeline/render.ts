import { db } from "@/lib/db";
import { computeStaleness, type RenderInputs } from "@/lib/invalidation";
import { renderCost } from "@/lib/costs/pricing";
import { assertWithinBudget, recordCost, type CostContext } from "@/lib/costs/record";
import { env } from "@/lib/env";
import { storyBandColor, videoFormat } from "@/lib/constants";
import { getAudioMix, getPricing } from "@/lib/settings";
import { setJobStage } from "@/lib/jobs";
import { renderClient, type RenderClient } from "@/lib/render/client";
import type { EpisodeTiming } from "@/lib/timing";
import { buildEpisodeProps } from "./render-props";
import { refreshStoryStatus } from "./versions";

export async function renderVersion(input: { versionId: string; jobId?: string; cost: CostContext; client?: RenderClient }) {
  const version = await db.episodeVersion.findUniqueOrThrow({
    where: { id: input.versionId },
    include: {
      episode: { include: { story: { include: { character: { select: { signatureColor: true, bandColor: true } } } } } },
      voiceover: true,
      scenes: { orderBy: { sceneNumber: "asc" }, include: { currentImage: true } },
    },
  });
  const staleness = computeStaleness({
    scenes: version.scenes.map((s) => ({ sceneNumber: s.sceneNumber, currentImageId: s.currentImage?.status === "SUCCEEDED" ? s.currentImageId : null })),
    voiceoverId: version.voiceover?.status === "SUCCEEDED" ? version.voiceoverId : null,
    hasTiming: Boolean(version.timing),
    latestSucceededRender: null,
  });
  if (!staleness.readyToRender) {
    const missing = [
      staleness.missingImages.length ? `images for scenes ${staleness.missingImages.join(", ")}` : "",
      staleness.voiceoverMissing ? "voiceover" : "",
      staleness.timingMissing ? "narration timing" : "",
    ].filter(Boolean);
    throw new Error(`Cannot render yet; missing ${missing.join(", ")}.`);
  }

  const mix = await getAudioMix();
  const music = mix.musicAssetId ? await db.audioAsset.findUnique({ where: { id: mix.musicAssetId } }) : null;
  const props = buildEpisodeProps({
    scenes: version.scenes.map((s) => ({ sceneNumber: s.sceneNumber, imageUrl: s.currentImage!.url!, motionPreset: s.motionPreset })),
    timing: version.timing as unknown as EpisodeTiming,
    voiceoverUrl: version.voiceover!.url!,
    voiceVolume: mix.voiceVolume,
    music: music ? { url: music.url, volume: mix.musicVolume } : null,
    narrationSpeed: mix.narrationSpeed,
    bands:
      videoFormat(version.episode.story.videoFormat) === "bands"
        ? {
            seriesTitle: version.episode.story.title,
            partLabel: `Part ${version.episode.partNumber}`,
            accentColor: storyBandColor(version.episode.storyId, version.episode.story.character),
          }
        : null,
  });

  const pricing = await getPricing();
  const vcpus = env().RENDER_SANDBOX_VCPUS;
  const durationSec = props.durationInFrames / props.fps;
  await assertWithinBudget(input.cost, renderCost(pricing, vcpus, durationSec * 2.5 + 120));

  const inputs: RenderInputs = {
    voiceoverId: version.voiceoverId!,
    imageIds: Object.fromEntries(version.scenes.map((s) => [String(s.sceneNumber), s.currentImageId!])),
  };
  const last = await db.render.aggregate({ where: { episodeVersion: { episodeId: version.episodeId } }, _max: { version: true } });
  const render = await db.render.create({
    data: { episodeVersionId: version.id, version: (last._max.version ?? 0) + 1, status: "GENERATING", inputs, inputProps: props, durationSec },
  });
  await db.episode.update({ where: { id: version.episodeId }, data: { status: "IN_PRODUCTION" } });
  await refreshStoryStatus(version.episode.storyId);

  try {
    const client = input.client ?? renderClient();
    const outcome = await client.render({
      props,
      blobPath: `stories/${version.episode.storyId}/episodes/${version.episodeId}/part-${version.episode.partNumber}-v${version.version}-r${render.version}-${render.id}.mp4`,
      onStarted: async ({ sandboxId, commandId }) => {
        await db.render.update({ where: { id: render.id }, data: { sandboxId, commandId } });
      },
      onProgress: async ({ progress, stage }) => {
        await db.render.update({ where: { id: render.id }, data: { progress } });
        if (input.jobId) {
          await setJobStage(input.jobId, stage === "Uploading MP4" ? "UPLOADING_MP4" : "RENDERING_VIDEO", stage, 0.8 + 0.2 * progress);
        }
      },
    });

    const isSandbox = env().RENDER_PROVIDER === "vercel-sandbox";
    const costUsd = isSandbox ? renderCost(pricing, vcpus, outcome.renderSeconds) : 0;
    if (isSandbox) {
      await recordCost(input.cost, { provider: "VERCEL_SANDBOX", model: `${vcpus}vcpu`, operation: "render", usage: { seconds: outcome.renderSeconds, vcpus }, costUsd, estimated: true });
    }
    await db.render.update({
      where: { id: render.id },
      data: { status: "SUCCEEDED", url: outcome.url, sizeBytes: outcome.sizeBytes, progress: 1, completedAt: new Date(), costUsd: costUsd.toFixed(6) },
    });
    const episode = await db.episode.findUniqueOrThrow({ where: { id: version.episodeId } });
    if (episode.status === "IN_PRODUCTION") {
      // A previously approved/published episode that was re-rendered from a locked version keeps its state.
      await db.episode.update({ where: { id: episode.id }, data: { status: version.status === "APPROVED" ? (episode.publishedAt ? "PUBLISHED" : "APPROVED") : "READY" } });
    }
    await refreshStoryStatus(version.episode.storyId);
    return { renderId: render.id, url: outcome.url };
  } catch (err) {
    await db.render.update({ where: { id: render.id }, data: { status: "FAILED", error: String((err as Error)?.message ?? err).slice(0, 2000) } });
    await db.episode.update({ where: { id: version.episodeId }, data: { status: "FAILED" } });
    await refreshStoryStatus(version.episode.storyId);
    throw err;
  }
}
