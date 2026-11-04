import { db } from "@/lib/db";
import { generateStructured } from "@/lib/ai/structured";
import { postCopyPrompt } from "@/lib/ai/post-prompts";
import { type CostContext } from "@/lib/costs/record";
import { type EpisodeSpecRecord, type PostCopy, PostCopySchema } from "@/lib/schemas/episode";
import { channelGuide } from "@/lib/schemas/channel";
import { numbersIn } from "@/lib/script";
import { getModels, getPricing } from "@/lib/settings";
import type { PipelineDeps } from "./deps";

/** Code checks on the posting text: hashtag form, length, a real cover shot, and no number the narration doesn't say. */
export function postCopyIssues(v: PostCopy, opts: { sceneNumbers: number[]; narration: string; part?: number; parts?: number }): string[] {
  const issues: string[] = [];
  if (v.caption.length > 180) issues.push(`The caption must be at most 150 characters (it is ${v.caption.length}).`);
  if (v.hashtags.length < 3 || v.hashtags.length > 6) issues.push(`Give 3–5 hashtags (you gave ${v.hashtags.length}).`);
  const bad = v.hashtags.filter((h) => !/^#[a-z0-9]+$/.test(h));
  if (bad.length) issues.push(`Hashtags are # followed by lowercase letters and digits only: fix ${bad.join(", ")}.`);
  if (!opts.sceneNumbers.includes(v.coverSceneNumber)) issues.push(`coverSceneNumber must be one of ${opts.sceneNumbers.join(", ")}.`);
  // "Part 2 of 4" is allowed in the caption.
  const said = new Set([...numbersIn(opts.narration), ...(opts.parts && opts.parts > 1 ? [String(opts.part), String(opts.parts)] : [])]);
  const captionExtra = numbersIn(v.caption).filter((n) => !said.has(n));
  if (captionExtra.length) issues.push(`The caption says ${captionExtra.join(", ")}, which the video doesn't.`);
  const commentExtra = numbersIn(v.pinnedComment).filter((n) => !said.has(n));
  if (commentExtra.length) issues.push(`The pinned comment says ${commentExtra.join(", ")}, which the video doesn't.`);
  return issues;
}

/** Writes the posting text for a version and stores it on the version. */
export async function writePostCopy(input: { versionId: string; cost: CostContext; deps: Pick<PipelineDeps, "text"> }): Promise<PostCopy> {
  const version = await db.episodeVersion.findUniqueOrThrow({
    where: { id: input.versionId },
    include: { episode: { include: { story: { include: { channel: true } } } }, scenes: { orderBy: { sceneNumber: "asc" } } },
  });
  const story = version.episode.story;
  if (!story.channel) throw new Error("This story belongs to no channel.");
  const spec = version.spec as EpisodeSpecRecord;
  const [pricing, models] = await Promise.all([getPricing(), getModels()]);
  const copy = await generateStructured({
    client: input.deps.text,
    pricing,
    model: models.fast,
    ...postCopyPrompt({
      channel: channelGuide(story.channel),
      seriesTitle: story.title,
      part: version.episode.partNumber,
      parts: story.plannedParts,
      narration: version.narration,
      onScreenHook: spec.onScreenHook ?? null,
      scenes: version.scenes.map((s) => ({ sceneNumber: s.sceneNumber, narration: s.narration, imagePrompt: s.imagePrompt })),
    }),
    schema: PostCopySchema,
    schemaName: "post_copy",
    validate: (v) =>
      postCopyIssues(v, {
        sceneNumbers: version.scenes.map((s) => s.sceneNumber),
        narration: version.narration,
        part: version.episode.partNumber,
        parts: story.plannedParts,
      }),
    cost: { ctx: input.cost, operation: "post-copy" },
  });
  await db.episodeVersion.update({ where: { id: version.id }, data: { postCopy: copy } });
  return copy;
}
