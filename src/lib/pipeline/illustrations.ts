import { db } from "@/lib/db";
import { mapSettled, withRetry, withTimeout } from "@/lib/async";
import { buildImagePrompt, reviewImage } from "@/lib/providers/images";
import { fetchAsset, paths, uploadAsset } from "@/lib/storage";
import { imageCost, textCost } from "@/lib/costs/pricing";
import { assertWithinBudget, recordCost, type CostContext } from "@/lib/costs/record";
import { getDefaults, getPricing, getModels } from "@/lib/settings";
import { QUALITY_PRESETS } from "@/lib/constants";
import { assertNotCanceled, setJobStage } from "@/lib/jobs";
import { loadCanonicalBible } from "./context";
import type { PipelineDeps } from "./deps";

const IMAGE_TIMEOUT_MS = 4 * 60_000;
const IMAGE_ATTEMPTS = 3;
const IMAGE_CONCURRENCY = 4;

export class SceneImagesIncompleteError extends Error {
  constructor(public readonly failedScenes: { sceneNumber: number; error: string }[]) {
    super(`Illustrations failed for scene(s) ${failedScenes.map((f) => f.sceneNumber).join(", ")}. Successful images were kept; retry to fill the gaps.`);
    this.name = "SceneImagesIncompleteError";
  }
  toJSON() {
    return { name: this.name, message: this.message, failedScenes: this.failedScenes };
  }
}

/**
 * Style references for consistency: the first two successful images from the
 * story's earliest approved episode, or from this version if none exist yet.
 * Reference images are passed to the image edit endpoint so line weight and
 * figure proportions carry across scenes and episodes.
 */
async function styleReferences(storyId: string, versionId: string, excludeSceneNumbers: number[]): Promise<string[]> {
  const story = await db.story.findUniqueOrThrow({ where: { id: storyId }, select: { visualReferences: { where: { kind: "style", imageUrl: { not: null } } } } });
  const pinned = story.visualReferences.map((r) => r.imageUrl!).slice(0, 2);
  if (pinned.length) return pinned;
  const own = await db.scene.findMany({
    where: { episodeVersionId: versionId, currentImageId: { not: null }, sceneNumber: { notIn: excludeSceneNumbers } },
    include: { currentImage: true },
    orderBy: { sceneNumber: "asc" },
    take: 2,
  });
  return own.map((s) => s.currentImage?.url).filter((u): u is string => Boolean(u));
}

/**
 * Generates images for the given scenes (default: scenes without a current
 * image). Each scene succeeds or fails independently; successful images are
 * stored immediately so a later failure never discards them.
 */
export async function generateSceneImages(input: {
  versionId: string;
  sceneNumbers?: number[];
  jobId?: string;
  cost: CostContext;
  deps: PipelineDeps;
  progress?: { from: number; to: number };
}) {
  const version = await db.episodeVersion.findUniqueOrThrow({
    where: { id: input.versionId },
    include: { episode: { include: { story: true } }, scenes: { orderBy: { sceneNumber: "asc" } } },
  });
  const story = version.episode.story;
  const quality = QUALITY_PRESETS[story.quality].imageQuality;
  const pricing = await getPricing();
  const defaults = await getDefaults();
  const bible = await loadCanonicalBible(story.id);
  const targets = version.scenes.filter((s) => (input.sceneNumbers ? input.sceneNumbers.includes(s.sceneNumber) : !s.currentImageId));
  if (targets.length === 0) return { generated: 0 };

  const proposal = await db.bibleUpdateProposal.findUnique({ where: { episodeVersionId: version.id } });
  const proposedChars = ((proposal?.update as { addCharacters?: { name: string; visualDescription: string }[] } | null)?.addCharacters ?? []);
  const characterSheet = [...bible.data.characters, ...proposedChars];

  let referenceUrls: string[] = [];
  if (defaults.useStyleReferences) referenceUrls = await styleReferences(story.id, version.id, targets.map((t) => t.sceneNumber));
  const references = (await Promise.all(referenceUrls.map((u) => fetchAsset(u).catch(() => null)))).filter((b): b is Buffer => Boolean(b));

  let completed = 0;
  const results = await mapSettled(targets, IMAGE_CONCURRENCY, async (scene) => {
    if (input.jobId) await assertNotCanceled(input.jobId);
    await assertWithinBudget(input.cost, pricing.imagePerImage[quality]);

    const prompt = buildImagePrompt({
      styleKey: version.styleKey,
      scene,
      characterSheet,
      visualNotes: bible.data.visualStyle.notes,
      hasReference: references.length > 0,
    });
    const last = await db.sceneImage.aggregate({ where: { sceneId: scene.id }, _max: { version: true } });
    const image = await db.sceneImage.create({
      data: { sceneId: scene.id, version: (last._max.version ?? 0) + 1, status: "GENERATING", prompt, model: "", quality },
    });

    try {
      const result = await withRetry(
        () => withTimeout(`Scene ${scene.sceneNumber} illustration`, IMAGE_TIMEOUT_MS, (signal) => input.deps.images.generate({ prompt, quality, references, signal })),
        { attempts: IMAGE_ATTEMPTS, baseDelayMs: 2000, shouldRetry: (e) => !/content.policy|safety|moderation/i.test(String((e as Error)?.message)) },
      );
      const cost = imageCost(pricing, quality, result.usage);
      await recordCost(input.cost, {
        provider: "OPENAI_IMAGE",
        model: result.model,
        operation: `scene-image-${scene.sceneNumber}`,
        usage: { ...(result.usage ?? {}), quality, usedReference: result.usedReference },
        ...cost,
      });

      let review = null;
      if (defaults.imageReview) {
        const r = await reviewImage(result.png, `${scene.imagePrompt}. ${scene.composition}`, (await getModels()).fast);
        if (r) {
          review = r.review;
          await recordCost(input.cost, { provider: "OPENAI_TEXT", model: r.model, operation: "image-review", usage: r.usage, costUsd: textCost(pricing, r.model, r.usage), estimated: false });
        }
      }

      const uploaded = await uploadAsset(paths.sceneImage(story.id, version.episodeId, scene.sceneNumber, image.version), result.png, "image/png");
      await db.$transaction([
        db.sceneImage.update({
          where: { id: image.id },
          data: { status: "SUCCEEDED", url: uploaded.url, blobPath: uploaded.pathname, model: result.model, usedReference: result.usedReference, costUsd: cost.costUsd.toFixed(6), review: review ?? undefined },
        }),
        db.scene.update({ where: { id: scene.id }, data: { currentImageId: image.id } }),
      ]);
      if (scene.sceneNumber === 1 && version.episode.partNumber === 1 && !story.thumbnailUrl) {
        await db.story.update({ where: { id: story.id }, data: { thumbnailUrl: uploaded.url } });
      }
      return image.id;
    } catch (err) {
      await db.sceneImage.update({ where: { id: image.id }, data: { status: "FAILED", error: String((err as Error)?.message ?? err).slice(0, 2000) } });
      throw err;
    } finally {
      completed++;
      if (input.jobId && input.progress) {
        const p = input.progress.from + (input.progress.to - input.progress.from) * (completed / targets.length);
        await setJobStage(input.jobId, "GENERATING_ILLUSTRATIONS", `Illustrated ${completed} of ${targets.length} scenes`, p).catch(() => {});
      }
    }
  });

  const failed = results
    .map((r, i) => ({ r, scene: targets[i] }))
    .filter((x) => x.r.status === "rejected")
    .map((x) => ({ sceneNumber: x.scene.sceneNumber, error: String(((x.r as PromiseRejectedResult).reason as Error)?.message ?? (x.r as PromiseRejectedResult).reason) }));
  if (failed.length) throw new SceneImagesIncompleteError(failed);
  return { generated: targets.length };
}
