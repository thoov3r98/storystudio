import { db } from "@/lib/db";
import { emptyBible, type StoryBible, StoryBibleSchema } from "@/lib/schemas/story-bible";
import { EpisodeSpecRecordSchema } from "@/lib/schemas/episode";

export async function loadCanonicalBible(storyId: string): Promise<{ version: number; data: StoryBible }> {
  const row = await db.storyBible.findFirst({ where: { storyId }, orderBy: { version: "desc" } });
  if (!row) {
    const story = await db.story.findUniqueOrThrow({ where: { id: storyId } });
    return { version: 0, data: emptyBible({ premise: story.premise, styleKey: story.styleKey }) };
  }
  return { version: row.version, data: StoryBibleSchema.parse(row.data) };
}

export type EpisodeHistoryItem = {
  partNumber: number;
  title: string;
  summary: string;
  narration: string;
  keyReveals: string[];
  unresolvedQuestions: string[];
};

/**
 * Selective retrieval for long series: the most recent approved episode is sent
 * in full, the previous `maxSummaries` as summaries, and anything older is
 * represented only by the bible's arcSummary. Prompt size stays bounded no
 * matter how many parts exist.
 */
export function selectContinuationContext(history: EpisodeHistoryItem[], maxSummaries = 10) {
  const sorted = [...history].sort((a, b) => a.partNumber - b.partNumber);
  const latest = sorted.at(-1) ?? null;
  const earlier = sorted.slice(0, -1);
  const summaries = earlier.slice(-maxSummaries).map(({ partNumber, title, summary }) => ({ partNumber, title, summary }));
  return {
    latestEpisode: latest
      ? { partNumber: latest.partNumber, title: latest.title, narration: latest.narration, keyReveals: latest.keyReveals, unresolvedQuestions: latest.unresolvedQuestions }
      : null,
    previousEpisodes: summaries,
    omittedCount: Math.max(0, earlier.length - maxSummaries),
  };
}

/** Approved (or published) episodes before `partNumber`, from their current locked versions. */
export async function approvedHistory(storyId: string, beforePart: number): Promise<EpisodeHistoryItem[]> {
  const episodes = await db.episode.findMany({
    where: { storyId, partNumber: { lt: beforePart }, status: { in: ["APPROVED", "PUBLISHED"] } },
    include: { currentVersion: true },
    orderBy: { partNumber: "asc" },
  });
  return episodes
    .filter((e) => e.currentVersion)
    .map((e) => {
      const spec = EpisodeSpecRecordSchema.partial().parse(e.currentVersion!.spec);
      return {
        partNumber: e.partNumber,
        title: e.title,
        summary: e.currentVersion!.summary,
        narration: e.currentVersion!.narration,
        keyReveals: spec.keyReveals ?? [],
        unresolvedQuestions: spec.unresolvedQuestions ?? [],
      };
    });
}

/** Reasons a continuation can't be generated yet, or an empty list. */
export async function continuationBlockers(storyId: string): Promise<string[]> {
  const episodes = await db.episode.findMany({ where: { storyId }, orderBy: { partNumber: "asc" }, select: { partNumber: true, status: true } });
  const blockers: string[] = [];
  if (episodes.length === 0) blockers.push("This story has no opening episode yet.");
  for (const e of episodes) {
    if (e.status !== "APPROVED" && e.status !== "PUBLISHED") {
      blockers.push(`Part ${e.partNumber} is not approved yet. Approve it so its continuity becomes canonical.`);
    }
  }
  return blockers;
}
