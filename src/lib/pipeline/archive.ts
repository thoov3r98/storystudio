import { db } from "@/lib/db";
import { ACTIVE_JOB_STATUSES } from "@/lib/constants";
import { cancelJob } from "@/lib/enqueue";
import { deleteStoryAssets } from "@/lib/storage";

/**
 * Archives stories and permanently deletes their stored files (images, voiceovers, renders).
 * The text stays (script, storyboard, metrics, costs) so archived stories can still be read and
 * compared, but they cannot be restored. Safe to run again on an archived story: it re-deletes
 * anything left behind, e.g. by a run that uploaded after an earlier pass.
 */
export async function archiveStories(storyIds: string[]): Promise<{ filesRemoved: number }> {
  if (!storyIds.length) return { filesRemoved: 0 };
  // Mark first: archived stories refuse new work, so nothing new starts while we clean up.
  await db.story.updateMany({ where: { id: { in: storyIds } }, data: { status: "ARCHIVED", archivedAt: new Date() } });

  const active = await db.job.findMany({
    where: { status: { in: ACTIVE_JOB_STATUSES }, OR: [{ storyId: { in: storyIds } }, { episode: { storyId: { in: storyIds } } }] },
    select: { id: true },
  });
  for (const job of active) await cancelJob(job.id);

  let filesRemoved = 0;
  for (const id of storyIds) filesRemoved += await deleteStoryAssets(id);

  // The files are gone; drop the links so pages don't show broken media.
  const versionWhere = { episode: { storyId: { in: storyIds } } };
  await db.$transaction([
    db.sceneImage.updateMany({ where: { scene: { episodeVersion: versionWhere } }, data: { url: null, blobPath: null } }),
    db.voiceover.updateMany({ where: { episodeVersion: versionWhere }, data: { url: null, blobPath: null } }),
    db.render.updateMany({ where: { episodeVersion: versionWhere }, data: { url: null } }),
    db.story.updateMany({ where: { id: { in: storyIds } }, data: { thumbnailUrl: null } }),
  ]);
  return { filesRemoved };
}
