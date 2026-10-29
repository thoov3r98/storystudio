/*
 * End-to-end pipeline test against a real Postgres database with fake
 * providers. Requires TEST_DATABASE_URL (migrated). Skipped otherwise.
 *
 *   pnpm prisma dev -d --name iws-test     # prints a postgres:// URL
 *   DATABASE_URL=<url> pnpm prisma migrate deploy
 *   TEST_DATABASE_URL=<url> pnpm test
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { EpisodeSpecRecord } from "@/lib/schemas/episode";

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
const { runEpisodeJob, ScriptGateError } = await import("@/lib/pipeline/produce");
const { StoryQualityError, MAX_PLOT_REPAIRS } = await import("@/lib/story/compose");
const { withDismissal } = await import("@/lib/story/review");
const { approveEpisode, approvalBlockers } = await import("@/lib/pipeline/versions");
const { continuationBlockers } = await import("@/lib/pipeline/context");
const { BudgetExceededError } = await import("@/lib/costs/record");
const { fakeDeps, fakeImages } = await import("./fakes");
const { createCharacterFromBrief, drawCharacterSheet } = await import("@/lib/pipeline/characters");

async function reset() {
  const tables = await db.$queryRawUnsafe<{ tablename: string }[]>(`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`);
  await db.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} CASCADE`);
}

async function newJob(data: { type: "BATCH_IDEATION" | "EPISODE_PRODUCTION" | "CONTINUATION" | "REGENERATE_IMAGE" | "REGENERATE_SCRIPT" | "RENDER"; batchId?: string; episodeId?: string }) {
  return db.job.create({ data: { ...data, input: {} } });
}

/** Approves an episode's script at the gate, which makes the images, narration and video. */
async function approveScript(episodeId: string, deps: Parameters<typeof runEpisodeJob>[1]) {
  const job = await newJob({ type: "EPISODE_PRODUCTION", episodeId });
  await runEpisodeJob({ jobId: job.id, episodeId, continueProduction: true, request: { action: "render" } }, deps);
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
  beforeEach(async () => {
    await reset();
    // Most tests cover single-episode stories; multi-part stories have their own test.
    await db.setting.create({ data: { key: "defaults", value: { partsPerStory: 1 } } });
  });

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
    await runEpisodeJob({ jobId: job.id, episodeId, continueProduction: true, request: { action: "produce" } }, f.deps);

    // Script gate: the script is written, then everything stops for review. No media spend yet.
    expect((await db.episode.findUniqueOrThrow({ where: { id: episodeId } })).status).toBe("SCRIPTED");
    expect(f.images.count).toBe(0);
    expect(f.speech.count).toBe(0);
    expect(f.render.renders).toHaveLength(0);
    expect(await db.costEntry.count({ where: { episodeId, provider: { in: ["OPENAI_IMAGE", "ELEVENLABS"] } } })).toBe(0);

    await approveScript(episodeId, f.deps);

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
    // Part 1 is planned, audited and edited too; fact checking is off.
    expect(f.text.calls.story_narration).toBe(1);
    expect(f.text.calls.plot_audit).toBe(1);
    expect(f.text.calls.script_audit).toBe(1);
    expect(v.qualityStatus).toBe("passed");
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
    await runEpisodeJob({ jobId: job2.id, episodeId: part2.id, continueProduction: true, request: { action: "produce" } }, f.deps);
    await approveScript(part2.id, f.deps);
    const writerPrompt = f.text.prompts.story_narration.find((p) => p.includes("Part: 2"))!;
    expect(writerPrompt).toContain("MOST RECENT EPISODE IN FULL");
    expect(writerPrompt).toContain("thread-1");
    expect(writerPrompt).toContain(v.narration.slice(0, 40));
    // Part 2's logic audit checks it against the series so far.
    expect(f.text.prompts.script_audit.at(-1)).toContain("SERIES SO FAR");
    expect(f.text.prompts.plot_audit.at(-1)).toContain("thread-1");
    const p2 = await db.episode.findUniqueOrThrow({ where: { id: part2.id } });
    expect(p2.status).toBe("READY");
  });

  it("regenerating one image keeps every other asset and only re-renders", async () => {
    const batch = await createBatch(1);
    const f = fakeDeps();
    const { episodeIds } = await runIdeation({ batchId: batch.id, jobId: (await newJob({ type: "BATCH_IDEATION", batchId: batch.id })).id, deps: f.deps });
    const episodeId = episodeIds[0];
    await runEpisodeJob({ jobId: (await newJob({ type: "EPISODE_PRODUCTION", episodeId })).id, episodeId, continueProduction: true, request: { action: "produce" } }, f.deps);
    await approveScript(episodeId, f.deps);
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
    await runEpisodeJob({ jobId: (await newJob({ type: "EPISODE_PRODUCTION", episodeId })).id, episodeId, continueProduction: true, request: { action: "produce" } }, f.deps);
    await approveScript(episodeId, f.deps);
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
    await runEpisodeJob({ jobId: (await newJob({ type: "EPISODE_PRODUCTION", episodeId })).id, episodeId, continueProduction: true, request: { action: "produce" } }, f.deps);
    await approveScript(episodeId, f.deps);
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

    await runEpisodeJob({ jobId: job.id, episodeId, continueProduction: true, request: { action: "produce" } }, f.deps);
    await expect(approveScript(episodeId, failing)).rejects.toThrow(/scene\(s\) 5/);
    const v = await db.episodeVersion.findFirstOrThrow({ where: { episodeId }, include: { scenes: true } });
    expect(v.scenes.filter((s) => s.currentImageId)).toHaveLength(11);

    const writesBefore = f.text.calls.story_narration;
    await runEpisodeJob({ jobId: job.id, episodeId, continueProduction: true, request: { action: "produce" } }, f.deps);
    expect(f.text.calls.story_narration).toBe(writesBefore); // script not rewritten
    expect(f.images.count).toBe(1); // only the missing scene
    expect((await db.episode.findUniqueOrThrow({ where: { id: episodeId } })).status).toBe("READY");
  });

  it("blocks a Part 2 that contradicts the series: saved for review, never produced, until the issue is resolved", async () => {
    const batch = await createBatch(1);
    const f = fakeDeps();
    const { episodeIds } = await runIdeation({ batchId: batch.id, jobId: (await newJob({ type: "BATCH_IDEATION", batchId: batch.id })).id, deps: f.deps });
    const episodeId = episodeIds[0];
    await runEpisodeJob({ jobId: (await newJob({ type: "EPISODE_PRODUCTION", episodeId })).id, episodeId, continueProduction: true, request: { action: "produce" } }, f.deps);
    await approveScript(episodeId, f.deps);
    await approveEpisode(episodeId, { applyProposal: true });
    const story = await db.episode.findUniqueOrThrow({ where: { id: episodeId } });
    const part2 = await db.episode.create({ data: { storyId: story.storyId, partNumber: 2, title: "Part 2" } });
    const conflicted = fakeDeps({ scriptAudit: "series-conflict" });

    await runEpisodeJob({ jobId: (await newJob({ type: "CONTINUATION", episodeId: part2.id })).id, episodeId: part2.id, continueProduction: true, request: { action: "produce" } }, conflicted.deps);
    // Bounded: the first check plus two targeted revisions, each checked again.
    expect(conflicted.text.calls.script_revision).toBe(2);
    expect(conflicted.text.calls.script_audit).toBe(3);
    const blocked = await db.episode.findUniqueOrThrow({ where: { id: part2.id }, include: { currentVersion: true } });
    expect(blocked.status).toBe("SCRIPTED");
    expect(blocked.currentVersion!.qualityStatus).toBe("blocked");
    const quality = (blocked.currentVersion!.spec as EpisodeSpecRecord).quality!;
    expect(quality.issues[0]).toMatchObject({ severity: "blocking", category: "series-continuity", stage: "continuity", verified: true });
    expect(quality.scriptRounds[1].changeLog[0].issueId).toBe("S1.1");

    // Neither approving nor the override can spend on media for a blocked script.
    await expect(approveScript(part2.id, conflicted.deps)).rejects.toBeInstanceOf(ScriptGateError);
    const job = await newJob({ type: "RENDER", episodeId: part2.id });
    await expect(runEpisodeJob({ jobId: job.id, episodeId: part2.id, continueProduction: true, request: { action: "render", acceptOpenNotes: true } }, conflicted.deps)).rejects.toBeInstanceOf(ScriptGateError);
    await expect(runEpisodeJob({ jobId: job.id, episodeId: part2.id, continueProduction: true, request: { action: "regenerate-image", sceneNumbers: [1] } }, conflicted.deps)).rejects.toBeInstanceOf(ScriptGateError);
    expect(conflicted.images.count).toBe(0);
    expect(conflicted.speech.count).toBe(0);

    // The producer judges the issue wrong: dismissing it is recorded and unblocks the script.
    const dismissed = withDismissal(quality, quality.issues[0].id, "It was explained in Part 1");
    expect(dismissed.status).toBe("passed");
    expect(dismissed.dismissed[0].note).toBe("It was explained in Part 1");
  });

  it("stops before narration when the plot keeps a blocking hole", async () => {
    const batch = await createBatch(1);
    const f = fakeDeps({ plotAudit: "blocking-always" });
    const { episodeIds } = await runIdeation({ batchId: batch.id, jobId: (await newJob({ type: "BATCH_IDEATION", batchId: batch.id })).id, deps: f.deps });
    const job = await newJob({ type: "EPISODE_PRODUCTION", episodeId: episodeIds[0] });
    const err = await runEpisodeJob({ jobId: job.id, episodeId: episodeIds[0], continueProduction: true, request: { action: "produce" } }, f.deps).catch((e) => e);
    expect(err).toBeInstanceOf(StoryQualityError);
    expect((err as InstanceType<typeof StoryQualityError>).issues[0]).toMatchObject({ severity: "blocking", category: "knowledge" });
    expect(f.text.calls.plot_repair).toBe(MAX_PLOT_REPAIRS);
    expect(f.text.calls.plot_audit).toBe(MAX_PLOT_REPAIRS + 1);
    expect(f.text.calls.story_narration).toBeUndefined();
    expect((await db.episode.findUniqueOrThrow({ where: { id: episodeIds[0] } })).currentVersionId).toBeNull();
  });

  it("plans, audits, repairs and edits a script, recording every round and its cost", async () => {
    const batch = await createBatch(1);
    const f = fakeDeps({ plotAudit: "blocking-once", scriptAudit: "significant-once" });
    const { episodeIds } = await runIdeation({ batchId: batch.id, jobId: (await newJob({ type: "BATCH_IDEATION", batchId: batch.id })).id, deps: f.deps });
    const episodeId = episodeIds[0];
    const job = await newJob({ type: "EPISODE_PRODUCTION", episodeId });
    await runEpisodeJob({ jobId: job.id, episodeId, continueProduction: true, request: { action: "produce" } }, f.deps);

    // Two plots, an editor's pick, a hole repaired at its root and re-audited.
    expect(f.text.calls.plot_candidates).toBe(1);
    expect(f.text.prompts.hook_candidates[0]).toContain("Second plot"); // the picked plot
    expect(f.text.calls.plot_repair).toBe(1);
    expect(f.text.prompts.plot_audit[1]).toContain("EARLIER ISSUES");
    // Hooks are developed and judged against the plot; the narration opens with the chosen one.
    expect(f.text.prompts.hook_pick[0]).toContain("PLOT");
    expect(f.text.prompts.story_narration[0]).toContain("CHOSEN HOOK (open with exactly this): You land after ten hours.");
    expect(f.text.prompts.story_narration[0]).toContain("REFERENCE STORIES");
    // A significant script issue gets one targeted revision, then the whole script is checked again.
    expect(f.text.calls.script_revision).toBe(1);
    expect(f.text.prompts.script_revision[0]).toContain("S1.1");
    expect(f.text.calls.script_audit).toBe(2);
    expect(f.text.calls.editorial_review).toBe(2);
    // Checking runs on the reviewer model (the main model unless set), writing on the writer.
    expect(f.text.models.script_audit).toBe(f.text.models.story_narration);

    const ep = await db.episode.findUniqueOrThrow({ where: { id: episodeId }, include: { currentVersion: { include: { scenes: true } } } });
    const v = ep.currentVersion!;
    const spec = v.spec as EpisodeSpecRecord;
    expect(ep.status).toBe("SCRIPTED");
    expect(v.qualityStatus).toBe("passed");
    expect(v.narration).toContain("revised.");
    expect(spec.storyNarration).toBe(v.narration);
    expect(spec.plot?.dramaticQuestion).toBe("Second plot");
    expect(spec.quality?.plotRounds).toHaveLength(2);
    expect(spec.quality?.plotRounds[1].changeLog[0]).toMatchObject({ issueId: "P1.1" });
    expect(spec.quality?.metrics).toMatchObject({ firstPass: false, plotRepairs: 1, scriptRevisions: 1, blockingFound: 1, significantFound: 1 });
    expect(spec.quality?.hooks?.candidates.candidates).toHaveLength(4);
    expect(spec.quality?.references.length).toBeGreaterThan(0);
    expect(v.scenes).toHaveLength(12);

    // Every model call is costed against the episode, and the script's own total matches.
    const ops = await db.costEntry.findMany({ where: { episodeId, provider: "OPENAI_TEXT" } });
    expect(new Set(ops.map((o) => o.operation))).toEqual(
      new Set(["plot-candidates", "plot-pick", "plot-audit", "plot-repair", "hook-candidates", "hook-pick", "write-narration", "script-audit", "editorial-review", "revise-script", "scene-breakdown"]),
    );
    const total = ops.reduce((t, o) => t + Number(o.costUsd), 0);
    expect(spec.quality!.metrics.textCostUsd).toBeCloseTo(total, 3);
    expect(f.images.count).toBe(0);
  });

  it("needs an explicit override to produce a script with open editorial notes, and records it", async () => {
    const batch = await createBatch(1);
    const f = fakeDeps({ editorial: "must-fix-always" });
    const { episodeIds } = await runIdeation({ batchId: batch.id, jobId: (await newJob({ type: "BATCH_IDEATION", batchId: batch.id })).id, deps: f.deps });
    const episodeId = episodeIds[0];
    await runEpisodeJob({ jobId: (await newJob({ type: "EPISODE_PRODUCTION", episodeId })).id, episodeId, continueProduction: true, request: { action: "produce" } }, f.deps);
    expect(f.text.calls.script_revision).toBe(2);
    const v = await db.episodeVersion.findFirstOrThrow({ where: { episodeId } });
    expect(v.qualityStatus).toBe("needs-attention");

    await expect(approveScript(episodeId, f.deps)).rejects.toBeInstanceOf(ScriptGateError);
    expect(f.images.count).toBe(0);
    const job = await newJob({ type: "RENDER", episodeId });
    await runEpisodeJob({ jobId: job.id, episodeId, continueProduction: true, request: { action: "render", acceptOpenNotes: true } }, f.deps);
    const after = await db.episode.findUniqueOrThrow({ where: { id: episodeId }, include: { currentVersion: true } });
    expect(after.status).toBe("READY");
    expect((after.currentVersion!.spec as EpisodeSpecRecord).quality?.override?.open).toBe(1);
  });

  it("fixes flagged issues as a new version, and re-checks a hand-edited line", async () => {
    const batch = await createBatch(1);
    const f = fakeDeps({ editorial: "must-fix-once" });
    const { episodeIds } = await runIdeation({ batchId: batch.id, jobId: (await newJob({ type: "BATCH_IDEATION", batchId: batch.id })).id, deps: f.deps });
    const episodeId = episodeIds[0];
    await runEpisodeJob({ jobId: (await newJob({ type: "EPISODE_PRODUCTION", episodeId })).id, episodeId, continueProduction: true, request: { action: "produce" } }, f.deps);
    // The editor's note was fixed automatically on the first pass.
    expect(f.text.calls.script_revision).toBe(1);
    expect((await db.episodeVersion.findFirstOrThrow({ where: { episodeId } })).qualityStatus).toBe("passed");

    await runEpisodeJob({ jobId: (await newJob({ type: "REGENERATE_SCRIPT", episodeId })).id, episodeId, continueProduction: false, request: { action: "revise-script" } }, f.deps);
    const revised = await db.episode.findUniqueOrThrow({ where: { id: episodeId }, include: { currentVersion: true } });
    expect(revised.currentVersion).toMatchObject({ version: 2, reason: "revise-issues", qualityStatus: "passed" });

    const auditsBefore = f.text.calls.script_audit;
    await runEpisodeJob({ jobId: (await newJob({ type: "EPISODE_PRODUCTION", episodeId })).id, episodeId, continueProduction: false, request: { action: "rewrite-scene", sceneNumber: 4, instruction: null } }, f.deps);
    expect(f.text.calls.script_audit).toBe(auditsBefore + 1);
    const edited = await db.episode.findUniqueOrThrow({ where: { id: episodeId }, include: { currentVersion: true } });
    expect(edited.currentVersion!.version).toBe(3);
    expect((edited.currentVersion!.spec as EpisodeSpecRecord).quality!.scriptRounds.length).toBeGreaterThan(1);
    expect(edited.status).toBe("SCRIPTED");
  });

  it("writes all four parts of a story from one plan, then makes media one part at a time", async () => {
    await db.setting.update({ where: { key: "defaults" }, data: { value: { partsPerStory: 4 } } });
    const batch = await createBatch(1);
    const f = fakeDeps();
    const { episodeIds } = await runIdeation({ batchId: batch.id, jobId: (await newJob({ type: "BATCH_IDEATION", batchId: batch.id })).id, deps: f.deps });
    expect(f.text.prompts.concept_batch[0]).toContain("told across 4 short videos");
    const part1 = episodeIds[0];
    await runEpisodeJob({ jobId: (await newJob({ type: "EPISODE_PRODUCTION", episodeId: part1 })).id, episodeId: part1, continueProduction: true, request: { action: "produce" } }, f.deps);

    // One plan and one audit for the whole story; hooks for all parts at once; each part written and checked on its own.
    expect(f.text.calls).toMatchObject({ plot_candidates: 1, plot_audit: 1, hook_candidates: 1, hook_pick: 1, story_narration: 4, script_audit: 4, editorial_review: 4, scene_breakdown: 4 });
    expect(f.text.prompts.plot_candidates[0]).toContain("for this 4-part story");
    expect(f.text.prompts.story_narration[1]).toContain("THIS IS PART 2 OF 4");
    expect(f.text.prompts.story_narration[1]).toContain("It tells beats 4, 5, 6 only");
    // Later parts hear what earlier parts told, and their checks know the scope.
    const part1Text = (await db.episode.findUniqueOrThrow({ where: { id: part1 }, include: { currentVersion: true } })).currentVersion!.narration;
    expect(f.text.prompts.story_narration[1]).toContain(part1Text.slice(0, 40));
    expect(f.text.prompts.script_audit[3]).toContain("THIS IS PART 4 OF 4");

    const story = await db.story.findFirstOrThrow({ where: { episodes: { some: { id: part1 } } }, include: { episodes: { orderBy: { partNumber: "asc" }, include: { currentVersion: true } } } });
    expect(story.plannedParts).toBe(4);
    expect(story.status).toBe("CONCEPT");
    expect(story.episodes.map((e) => [e.partNumber, e.status])).toEqual([
      [1, "SCRIPTED"],
      [2, "SCRIPTED"],
      [3, "SCRIPTED"],
      [4, "SCRIPTED"],
    ]);
    for (const e of story.episodes) {
      const spec = e.currentVersion!.spec as EpisodeSpecRecord;
      expect(spec.quality?.part).toBe(e.partNumber);
      expect(spec.plot?.parts).toHaveLength(4);
      expect(e.currentVersion!.qualityStatus).toBe("passed");
    }
    // Planning is shared, so each part carries a share of it; together they match what was spent.
    const textSpend = (await db.costEntry.findMany({ where: { storyId: story.id, provider: "OPENAI_TEXT" } })).reduce((t, c) => t + Number(c.costUsd), 0);
    const recorded = story.episodes.reduce((t, e) => t + (e.currentVersion!.spec as EpisodeSpecRecord).quality!.metrics.textCostUsd, 0);
    expect(recorded).toBeCloseTo(textSpend, 2);
    expect(f.images.count).toBe(0);

    // Media for Part 1 only.
    await approveScript(part1, f.deps);
    const after = await db.episode.findMany({ where: { storyId: story.id }, orderBy: { partNumber: "asc" } });
    expect(after.map((e) => e.status)).toEqual(["READY", "SCRIPTED", "SCRIPTED", "SCRIPTED"]);
    expect(f.render.renders).toHaveLength(1);

    // Rewriting Part 3 keeps the plan and the other parts; replanning is refused once a part is produced.
    const part3 = after[2];
    const plansBefore = f.text.calls.plot_candidates;
    await runEpisodeJob({ jobId: (await newJob({ type: "REGENERATE_SCRIPT", episodeId: part3.id })).id, episodeId: part3.id, continueProduction: false, request: { action: "regenerate-script" } }, f.deps);
    expect(f.text.calls.plot_candidates).toBe(plansBefore);
    expect(f.text.prompts.story_narration.at(-1)).toContain("THIS IS PART 3 OF 4");
    expect((await db.episodeVersion.count({ where: { episodeId: part3.id } }))).toBe(2);
    expect(await db.episodeVersion.count({ where: { episodeId: after[1].id } })).toBe(1);
    await expect(
      runEpisodeJob({ jobId: (await newJob({ type: "REGENERATE_SCRIPT", episodeId: part1 })).id, episodeId: part1, continueProduction: false, request: { action: "regenerate-script", replanStory: true } }, f.deps),
    ).rejects.toThrow(/already been produced/);
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
    await runEpisodeJob({ jobId: job.id, episodeId, continueProduction: true, request: { action: "produce" } }, f.deps);
    await approveScript(episodeId, f.deps);

    expect(f.text.prompts.story_narration[0]).toContain("NARRATOR AND HERO: Big Dave");
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

  it("checks each image and redraws a wrong one once, with the problem spelled out", async () => {
    const batch = await createBatch(1);
    const f = fakeDeps({}, { rejectOnce: new Set(["3"]) });
    const { episodeIds } = await runIdeation({ batchId: batch.id, jobId: (await newJob({ type: "BATCH_IDEATION", batchId: batch.id })).id, deps: f.deps });
    await runEpisodeJob({ jobId: (await newJob({ type: "EPISODE_PRODUCTION", episodeId: episodeIds[0] })).id, episodeId: episodeIds[0], continueProduction: true, request: { action: "produce" } }, f.deps);
    await approveScript(episodeIds[0], f.deps);
    expect(f.images.count).toBe(13); // 12 scenes + 1 redraw
    expect(f.images.reviews).toBe(13);
    const redraw = f.images.calls.find((c) => c.prompt.includes("A previous attempt was rejected"));
    expect(redraw?.prompt).toContain("Hero is standing on the ground");
    expect(await db.costEntry.count({ where: { operation: "scene-image-3-redraw" } })).toBe(1);
  });
});
