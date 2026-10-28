/*
 * End-to-end pipeline test against a real Postgres database with fake
 * providers. Requires TEST_DATABASE_URL (migrated). Skipped otherwise.
 *
 *   pnpm prisma dev -d --name iws-test     # prints a postgres:// URL
 *   DATABASE_URL=<url> pnpm prisma migrate deploy
 *   TEST_DATABASE_URL=<url> pnpm test
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const url = process.env.TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;

vi.mock("@/lib/storage", () => {
  let n = 0;
  return {
    uploadAsset: vi.fn(async (pathname: string) => ({ url: `https://blob.test/${pathname}?n=${++n}`, pathname, downloadUrl: `https://blob.test/${pathname}?download=1` })),
    fetchAsset: vi.fn(async () => Buffer.from("ref")),
    paths: {
      sceneImage: (s: string, e: string, n: number, v: number) => `stories/${s}/episodes/${e}/scenes/${n}-v${v}.png`,
      voiceover: (s: string, e: string, v: number) => `stories/${s}/episodes/${e}/voiceover-v${v}.mp3`,
      render: (s: string, e: string, v: number) => `stories/${s}/episodes/${e}/render-v${v}.mp4`,
    },
  };
});

const { db } = await import("@/lib/db");
const { mutedBandColor } = await import("@/lib/constants");
const { runIdeation } = await import("@/lib/pipeline/ideation");
const { runEpisodeJob, ContinuityConflictError } = await import("@/lib/pipeline/produce");
const { approveEpisode, approvalBlockers } = await import("@/lib/pipeline/versions");
const { continuationBlockers } = await import("@/lib/pipeline/context");
const { BudgetExceededError } = await import("@/lib/costs/record");
const { fakeDeps, fakeImages } = await import("./fakes");
const { createCharacterFromBrief, drawCharacterSheet } = await import("@/lib/pipeline/characters");

async function reset() {
  const tables = await db.$queryRawUnsafe<{ tablename: string }[]>(`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`);
  await db.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} CASCADE`);
}

async function newJob(data: { type: "BATCH_IDEATION" | "EPISODE_PRODUCTION" | "CONTINUATION" | "REGENERATE_IMAGE" | "REGENERATE_HOOKS"; batchId?: string; episodeId?: string }) {
  return db.job.create({ data: { ...data, input: {} } });
}

async function createBatch(requested = 3, budget = 100) {
  return db.batch.create({
    data: { mode: "CONCEPT", category: "hidden-infrastructure", requestedCount: requested, targetDurationSec: 75, styleKey: "stick-figure", voiceId: "voice-1", quality: "STANDARD", maxBudgetUsd: budget },
  });
}

describe.skipIf(!url)("production pipeline (integration)", () => {
  beforeAll(async () => {
    await db.$queryRawUnsafe("SELECT 1");
  });
  beforeEach(reset);

  it("ideates, dedupes, ranks and selects, with no separate hook step", async () => {
    await db.story.create({
      data: { title: "Where Does Your Lost Luggage Actually Go?", normalizedTitle: "lost luggage", category: "travel-transportation", premise: "Your lost suitcase travels through hidden baggage systems.", keywords: ["luggage"] },
    });
    const batch = await createBatch(3);
    const job = await newJob({ type: "BATCH_IDEATION", batchId: batch.id });
    const { deps, text } = fakeDeps();

    const result = await runIdeation({ batchId: batch.id, jobId: job.id, deps });

    expect(result.candidates).toBe(6); // 2× requested
    expect(result.duplicates).toBe(1);
    expect(result.selected).toBe(3);
    const concepts = await db.concept.findMany({ where: { batchId: batch.id } });
    expect(concepts.filter((c) => c.status === "DUPLICATE")[0].duplicateOfTitle).toContain("Lost Luggage");
    expect(concepts.filter((c) => c.status === "SELECTED")).toHaveLength(3);
    const ranked = concepts.filter((c) => c.rank !== null).sort((a, b) => a.rank! - b.rank!);
    expect(ranked[0].totalScore!).toBeGreaterThanOrEqual(ranked.at(-1)!.totalScore!);
    const stories = await db.story.findMany({ where: { conceptId: { not: null } }, include: { episodes: true, bibles: true } });
    expect(stories).toHaveLength(3);
    for (const s of stories) {
      expect(s.status).toBe("CONCEPT");
      expect(s.bibles).toHaveLength(1);
    }
    expect(Object.keys(text.calls).sort()).toEqual(["concept_batch", "concept_evaluation"]);
    const costs = await db.costEntry.count({ where: { batchId: batch.id } });
    expect(costs).toBeGreaterThan(0);

    // Retrying a finished ideation job must not duplicate concepts.
    const again = await runIdeation({ batchId: batch.id, jobId: job.id, deps });
    expect(again.resumed).toBe(true);
    expect(await db.concept.count({ where: { batchId: batch.id } })).toBe(concepts.length);
  });

  it("produces Part 1, approves it into the bible, and continues to Part 2 with context", async () => {
    const batch = await createBatch(1);
    const ideJob = await newJob({ type: "BATCH_IDEATION", batchId: batch.id });
    const f = fakeDeps();
    const { episodeIds } = await runIdeation({ batchId: batch.id, jobId: ideJob.id, deps: f.deps });
    const episodeId = episodeIds[0];

    const job = await newJob({ type: "EPISODE_PRODUCTION", episodeId });
    await runEpisodeJob({ jobId: job.id, episodeId, continueProduction: true, request: { action: "produce", allowContinuityConflicts: false } }, f.deps);

    const ep = await db.episode.findUniqueOrThrow({
      where: { id: episodeId },
      include: { currentVersion: { include: { scenes: { include: { currentImage: true } }, voiceover: true, renders: true, proposal: true } } },
    });
    const v = ep.currentVersion!;
    expect(ep.status).toBe("READY");
    expect(v.scenes).toHaveLength(12);
    expect(v.scenes.every((s) => s.currentImage?.status === "SUCCEEDED")).toBe(true);
    expect(v.voiceover?.status).toBe("SUCCEEDED");
    expect(v.voiceover?.durationMs).toBeGreaterThan(0);
    expect(v.renders.filter((r) => r.status === "SUCCEEDED")).toHaveLength(1);
    expect(v.narration.startsWith("You land after ten hours.")).toBe(true);
    // Fact checking is off: one draft, no review call, nothing waits on it.
    expect(f.text.calls.episode_draft).toBe(1);
    expect(f.text.calls.fact_review).toBeUndefined();
    expect(v.factCheckStatus).toBe("PASSED");
    expect(v.proposal?.status).toBe("PENDING");
    const timing = v.timing as { scenes: { startMs: number }[]; totalDurationMs: number };
    expect(timing.scenes).toHaveLength(12);
    expect(f.render.renders[0].durationInFrames).toBe(Math.round((timing.totalDurationMs / 1000) * 30));

    // Unapproved drafts never touch the canonical bible.
    expect(await db.storyBible.count({ where: { storyId: ep.storyId } })).toBe(1);
    expect(await continuationBlockers(ep.storyId)).not.toHaveLength(0);

    await approveEpisode(episodeId, { applyProposal: true });
    const bibles = await db.storyBible.findMany({ where: { storyId: ep.storyId }, orderBy: { version: "desc" } });
    expect(bibles[0]).toMatchObject({ version: 2, source: "episode-approval" });
    expect((bibles[0].data as { unresolvedThreads: { id: string }[] }).unresolvedThreads[0].id).toBe("thread-1");
    expect(await continuationBlockers(ep.storyId)).toEqual([]);

    // Part 2
    const part2 = await db.episode.create({ data: { storyId: ep.storyId, partNumber: 2, title: "Part 2" } });
    const job2 = await newJob({ type: "CONTINUATION", episodeId: part2.id });
    await runEpisodeJob({ jobId: job2.id, episodeId: part2.id, continueProduction: true, request: { action: "produce", allowContinuityConflicts: false } }, f.deps);
    const writerPrompt = f.text.prompts.episode_draft.find((p) => p.includes("Part: 2"))!;
    expect(writerPrompt).toContain("MOST RECENT EPISODE IN FULL");
    expect(writerPrompt).toContain("thread-1");
    expect(writerPrompt).toContain(v.narration.slice(0, 40));
    expect(f.text.calls.continuity_review).toBeGreaterThanOrEqual(1);
    const p2 = await db.episode.findUniqueOrThrow({ where: { id: part2.id } });
    expect(p2.status).toBe("READY");
  });

  it("regenerating one image keeps every other asset and only re-renders", async () => {
    const batch = await createBatch(1);
    const f = fakeDeps();
    const { episodeIds } = await runIdeation({ batchId: batch.id, jobId: (await newJob({ type: "BATCH_IDEATION", batchId: batch.id })).id, deps: f.deps });
    const episodeId = episodeIds[0];
    await runEpisodeJob({ jobId: (await newJob({ type: "EPISODE_PRODUCTION", episodeId })).id, episodeId, continueProduction: true, request: { action: "produce", allowContinuityConflicts: false } }, f.deps);
    const before = await db.episodeVersion.findFirstOrThrow({ where: { episodeId }, include: { scenes: true } });
    const imagesBefore = f.images.count;
    const speechBefore = f.speech.count;

    await runEpisodeJob({ jobId: (await newJob({ type: "REGENERATE_IMAGE", episodeId })).id, episodeId, continueProduction: true, request: { action: "regenerate-image", sceneNumbers: [3] } }, f.deps);

    const after = await db.episodeVersion.findFirstOrThrow({ where: { id: before.id }, include: { scenes: { include: { images: true } } } });
    expect(f.images.count).toBe(imagesBefore + 1);
    expect(f.speech.count).toBe(speechBefore);
    const s3 = after.scenes.find((s) => s.sceneNumber === 3)!;
    expect(s3.images).toHaveLength(2); // history kept
    expect(s3.currentImageId).not.toBe(before.scenes.find((s) => s.sceneNumber === 3)!.currentImageId);
    for (const s of after.scenes.filter((x) => x.sceneNumber !== 3)) {
      expect(s.currentImageId).toBe(before.scenes.find((b) => b.sceneNumber === s.sceneNumber)!.currentImageId);
    }
    expect(f.render.renders).toHaveLength(2);
  });

  it("forks a new version instead of editing an approved one", async () => {
    const batch = await createBatch(1);
    const f = fakeDeps();
    const { episodeIds } = await runIdeation({ batchId: batch.id, jobId: (await newJob({ type: "BATCH_IDEATION", batchId: batch.id })).id, deps: f.deps });
    const episodeId = episodeIds[0];
    await runEpisodeJob({ jobId: (await newJob({ type: "EPISODE_PRODUCTION", episodeId })).id, episodeId, continueProduction: true, request: { action: "produce", allowContinuityConflicts: false } }, f.deps);
    expect(await approvalBlockers(episodeId)).toEqual([]);
    await approveEpisode(episodeId, { applyProposal: true });
    const approved = await db.episodeVersion.findFirstOrThrow({ where: { episodeId, status: "APPROVED" }, include: { scenes: true } });

    await runEpisodeJob({ jobId: (await newJob({ type: "REGENERATE_IMAGE", episodeId })).id, episodeId, continueProduction: false, request: { action: "regenerate-image", sceneNumbers: [1] } }, f.deps);

    const ep = await db.episode.findUniqueOrThrow({ where: { id: episodeId }, include: { currentVersion: { include: { scenes: true } } } });
    expect(ep.currentVersionId).not.toBe(approved.id);
    expect(ep.currentVersion!.parentVersionId).toBe(approved.id);
    const untouched = await db.episodeVersion.findUniqueOrThrow({ where: { id: approved.id }, include: { scenes: true } });
    expect(untouched.status).toBe("APPROVED");
    expect(untouched.scenes.map((s) => s.currentImageId)).toEqual(approved.scenes.map((s) => s.currentImageId));
    // Narration unchanged, so the voiceover carries over to the fork.
    expect(ep.currentVersion!.voiceoverId).toBe(untouched.voiceoverId);
  });

  it("rewrites the opening into a new version and keeps the story text in sync", async () => {
    const batch = await createBatch(1);
    const f = fakeDeps();
    const { episodeIds } = await runIdeation({ batchId: batch.id, jobId: (await newJob({ type: "BATCH_IDEATION", batchId: batch.id })).id, deps: f.deps });
    const episodeId = episodeIds[0];
    await runEpisodeJob({ jobId: (await newJob({ type: "EPISODE_PRODUCTION", episodeId })).id, episodeId, continueProduction: true, request: { action: "produce", allowContinuityConflicts: false } }, f.deps);
    const imagesBefore = f.images.count;

    await runEpisodeJob({ jobId: (await newJob({ type: "EPISODE_PRODUCTION", episodeId })).id, episodeId, continueProduction: true, request: { action: "rewrite-scene", sceneNumber: 1, instruction: "Funnier" } }, f.deps);

    const ep = await db.episode.findUniqueOrThrow({ where: { id: episodeId }, include: { currentVersion: { include: { scenes: { orderBy: { sceneNumber: "asc" } } } } } });
    const v = ep.currentVersion!;
    const spec = v.spec as { selectedHook: string; storyNarration: string };
    expect(v.version).toBe(2);
    expect(v.scenes[0].narration).toMatch(/rewritten\.$/);
    expect(spec.storyNarration).toBe(v.narration);
    expect(v.narration.startsWith(spec.selectedHook)).toBe(true);
    expect(f.images.count).toBe(imagesBefore + 1); // only scene 1, whose visual changed
    expect(ep.status).toBe("READY");
  });

  it("keeps successful images when one scene fails, then resumes on retry", async () => {
    const batch = await createBatch(1);
    const f = fakeDeps();
    const { episodeIds } = await runIdeation({ batchId: batch.id, jobId: (await newJob({ type: "BATCH_IDEATION", batchId: batch.id })).id, deps: f.deps });
    const episodeId = episodeIds[0];
    const failing = { ...f.deps, images: fakeImages(new Set(["5"])) };
    const job = await newJob({ type: "EPISODE_PRODUCTION", episodeId });

    await expect(
      runEpisodeJob({ jobId: job.id, episodeId, continueProduction: true, request: { action: "produce", allowContinuityConflicts: false } }, failing),
    ).rejects.toThrow(/scene\(s\) 5/);
    const v = await db.episodeVersion.findFirstOrThrow({ where: { episodeId }, include: { scenes: true } });
    expect(v.scenes.filter((s) => s.currentImageId)).toHaveLength(11);

    const writesBefore = f.text.calls.episode_draft;
    await runEpisodeJob({ jobId: job.id, episodeId, continueProduction: true, request: { action: "produce", allowContinuityConflicts: false } }, f.deps);
    expect(f.text.calls.episode_draft).toBe(writesBefore); // script not rewritten
    expect(f.images.count).toBe(1); // only the missing scene
    expect((await db.episode.findUniqueOrThrow({ where: { id: episodeId } })).status).toBe("READY");
  });

  it("stops before media spend when continuity conflicts remain", async () => {
    const batch = await createBatch(1);
    const f = fakeDeps();
    const { episodeIds } = await runIdeation({ batchId: batch.id, jobId: (await newJob({ type: "BATCH_IDEATION", batchId: batch.id })).id, deps: f.deps });
    const episodeId = episodeIds[0];
    await runEpisodeJob({ jobId: (await newJob({ type: "EPISODE_PRODUCTION", episodeId })).id, episodeId, continueProduction: true, request: { action: "produce", allowContinuityConflicts: false } }, f.deps);
    await approveEpisode(episodeId, { applyProposal: true });
    const story = await db.episode.findUniqueOrThrow({ where: { id: episodeId } });
    const part2 = await db.episode.create({ data: { storyId: story.storyId, partNumber: 2, title: "Part 2" } });
    const conflicted = fakeDeps({ continuity: "material-conflicts" });

    await expect(
      runEpisodeJob({ jobId: (await newJob({ type: "CONTINUATION", episodeId: part2.id })).id, episodeId: part2.id, continueProduction: true, request: { action: "produce", allowContinuityConflicts: false } }, conflicted.deps),
    ).rejects.toBeInstanceOf(ContinuityConflictError);
    expect(conflicted.text.calls.episode_draft).toBe(3); // initial + 2 bounded corrections
    expect(conflicted.images.count).toBe(0);
  });

  it("enforces the budget before paid steps", async () => {
    const batch = await createBatch(3, 0.0001);
    const f = fakeDeps();
    await expect(runIdeation({ batchId: batch.id, jobId: (await newJob({ type: "BATCH_IDEATION", batchId: batch.id })).id, deps: f.deps })).rejects.toBeInstanceOf(BudgetExceededError);
  });

  it("builds series around a character: pitches, narrator, reference sheet and bands layout", async () => {
    const f = fakeDeps();
    const dave = await createCharacterFromBrief({ brief: "A big friendly ex-trucker who keeps getting stranded", deps: f.deps });
    expect(dave).toMatchObject({ name: "Big Dave", brief: "A big friendly ex-trucker who keeps getting stranded" });
    await db.character.update({ where: { id: dave.id }, data: { voiceId: "voice-dave" } });
    await drawCharacterSheet({ characterId: dave.id, deps: f.deps });
    expect(f.images.calls[0].size).toBe("1536x1024");
    expect((await db.character.findUniqueOrThrow({ where: { id: dave.id } })).sheetUrl).toMatch(/characters\//);
    expect(await db.costEntry.count({ where: { characterId: dave.id } })).toBe(2);

    const batch = await db.batch.create({
      data: { mode: "CONCEPT", category: "survival-scenarios", requestedCount: 1, targetDurationSec: 75, styleKey: "stick-figure-color", voiceId: "voice-1", quality: "STANDARD", maxBudgetUsd: 100, characterId: dave.id },
    });
    await runIdeation({ batchId: batch.id, jobId: (await newJob({ type: "BATCH_IDEATION", batchId: batch.id })).id, deps: f.deps });
    expect(f.text.prompts.concept_batch[0]).toContain("Series character");
    const story = await db.story.findFirstOrThrow({ where: { characterId: dave.id }, include: { bibles: true, episodes: true } });
    expect(story).toMatchObject({ voiceId: "voice-dave", videoFormat: "bands" });
    expect((story.bibles[0].data as { characters: { name: string }[] }).characters[0].name).toBe("Big Dave");

    const episodeId = story.episodes[0].id;
    const job = await newJob({ type: "EPISODE_PRODUCTION", episodeId });
    const imagesBefore = f.images.calls.length;
    await runEpisodeJob({ jobId: job.id, episodeId, continueProduction: true, request: { action: "produce", allowContinuityConflicts: false } }, f.deps);

    expect(f.text.prompts.episode_draft[0]).toContain("NARRATOR AND HERO: Big Dave");
    const sceneCalls = f.images.calls.slice(imagesBefore);
    expect(sceneCalls.length).toBeGreaterThan(0);
    expect(sceneCalls.every((c) => c.size === "1536x1024")).toBe(true);
    // The sheet goes only into shots Big Dave is in; the cutaway (scene 5) tells the model to leave him out.
    const [cutaway, withHero] = [sceneCalls.filter((c) => c.prompt.includes("Big Dave is not in this shot.")), sceneCalls.filter((c) => c.prompt.includes("character sheet for Big Dave"))];
    expect(cutaway).toHaveLength(1);
    expect(withHero).toHaveLength(sceneCalls.length - 1);
    expect(withHero.every((c) => c.references >= 1)).toBe(true);
    // Every image prompt carries the story around the shot.
    expect(sceneCalls.every((c) => c.prompt.includes("EPISODE FACTS") && c.prompt.includes("THIS MOMENT"))).toBe(true);
    // Bands use a muted version of the signature colour, not the colour itself.
    expect(f.render.renders.at(-1)).toMatchObject({ layout: "bands", seriesTitle: story.title, partLabel: "Part 1", accentColor: mutedBandColor("#C62828") });
    expect(mutedBandColor("#C62828")).not.toBe("#C62828");
  });

  it("outlines and picks before writing, and revises once on the story editor's notes", async () => {
    const batch = await createBatch(1);
    const f = fakeDeps({ storyReview: "revise" });
    const { episodeIds } = await runIdeation({ batchId: batch.id, jobId: (await newJob({ type: "BATCH_IDEATION", batchId: batch.id })).id, deps: f.deps });
    await runEpisodeJob({ jobId: (await newJob({ type: "EPISODE_PRODUCTION", episodeId: episodeIds[0] })).id, episodeId: episodeIds[0], continueProduction: false, request: { action: "produce", allowContinuityConflicts: false } }, f.deps);
    expect(f.text.calls.story_outlines).toBe(1);
    expect(f.text.calls.outline_pick).toBe(1);
    expect(f.text.prompts.episode_draft[0]).toContain("Second outline"); // the picked outline
    expect(f.text.prompts.episode_draft[0]).toContain("Make the ending sharper");
    expect(f.text.calls.story_review).toBe(1);
    expect(f.text.calls.episode_draft).toBe(2); // draft + one revision
    expect(f.text.prompts.episode_draft[1]).toContain("Story editor: The ending");
    const episode = await db.episode.findUniqueOrThrow({ where: { id: episodeIds[0] }, include: { currentVersion: { include: { scenes: true } } } });
    const spec = episode.currentVersion!.spec as { outline?: { logline: string }; visualState?: object };
    expect(spec.outline?.logline).toBe("Second outline");
    expect(spec.visualState).toBeTruthy();
    expect(episode.currentVersion!.scenes.every((s) => s.continuity.startsWith("Still in the terminal"))).toBe(true);
  });

  it("checks each image and redraws a wrong one once, with the problem spelled out", async () => {
    const batch = await createBatch(1);
    const f = fakeDeps({}, { rejectOnce: new Set(["3"]) });
    const { episodeIds } = await runIdeation({ batchId: batch.id, jobId: (await newJob({ type: "BATCH_IDEATION", batchId: batch.id })).id, deps: f.deps });
    await runEpisodeJob({ jobId: (await newJob({ type: "EPISODE_PRODUCTION", episodeId: episodeIds[0] })).id, episodeId: episodeIds[0], continueProduction: true, request: { action: "produce", allowContinuityConflicts: false } }, f.deps);
    expect(f.images.count).toBe(13); // 12 scenes + 1 redraw
    expect(f.images.reviews).toBe(13);
    const redraw = f.images.calls.find((c) => c.prompt.includes("A previous attempt was rejected"));
    expect(redraw?.prompt).toContain("Hero is standing on the ground");
    expect(await db.costEntry.count({ where: { operation: "scene-image-3-redraw" } })).toBe(1);
  });
});
