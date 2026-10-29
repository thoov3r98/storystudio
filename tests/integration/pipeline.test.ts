/*
 * End-to-end pipeline test against a real Postgres database with fake
 * providers. Requires TEST_DATABASE_URL (migrated). Skipped otherwise.
 *
 *   pnpm prisma dev -d --name iws-test     # prints a postgres:// URL
 *   DIRECT_URL=<url> DATABASE_URL=<url> pnpm prisma migrate deploy
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
const { bandColorFor } = await import("@/lib/constants");
const { createChannelFromBrief, runChannelIdeation, storyFromPitch } = await import("@/lib/pipeline/channels");
const { runEpisodeJob, ScriptGateError } = await import("@/lib/pipeline/produce");
const { MAX_SCRIPT_REVISIONS } = await import("@/lib/process/script");
const { withDismissal } = await import("@/lib/process/review");
const { approveEpisode, approvalBlockers } = await import("@/lib/pipeline/versions");
const { BudgetExceededError } = await import("@/lib/costs/record");
const { fakeDeps, fakeImages } = await import("./fakes");

type Deps = Parameters<typeof runEpisodeJob>[1];

async function reset() {
  const tables = await db.$queryRawUnsafe<{ tablename: string }[]>(`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`);
  await db.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} CASCADE`);
}

async function newJob(data: { type: "BATCH_IDEATION" | "EPISODE_PRODUCTION" | "REGENERATE_IMAGE" | "REGENERATE_SCRIPT" | "RENDER"; batchId?: string; episodeId?: string }) {
  return db.job.create({ data: { ...data, input: {} } });
}

/** Writes the scripts: Part 1 researches, plans and writes every part, each stopping at the gate. */
async function writeScripts(episodeId: string, deps: Deps) {
  await runEpisodeJob({ jobId: (await newJob({ type: "EPISODE_PRODUCTION", episodeId })).id, episodeId, continueProduction: true, request: { action: "produce" } }, deps);
}

/** Approves an episode's script at the gate, which makes the images, narration and video. */
async function approveScript(episodeId: string, deps: Deps) {
  const job = await newJob({ type: "EPISODE_PRODUCTION", episodeId });
  await runEpisodeJob({ jobId: job.id, episodeId, continueProduction: true, request: { action: "render" } }, deps);
}

const CHANNEL_PROFILE = {
  summary: "How everyday products are made, step by step.",
  subjects: "One manufactured product per series.",
  voice: "Unseen narrator, third person, present tense, strictly factual.",
  structure: "Real manufacturing order; each part covers one or two stages.",
  avoid: ["Brand names", "Jokes"],
  surpriseMe: "Pick an everyday product the channel hasn't covered.",
  examples: ["Crayons", "Pencils"],
};

async function createChannel(data: { minParts?: number; maxParts?: number } = {}) {
  return db.channel.create({
    data: { name: "How It's Made", brief: "b", format: "PROCESS_EXPLAINER", profile: CHANNEL_PROFILE, minParts: data.minParts ?? 3, maxParts: data.maxParts ?? 5, voiceId: "voice-channel" },
  });
}

async function channelBatch(channelId: string, idea: string | null, budget = 100) {
  return db.batch.create({
    data: { customDirection: idea, requestedCount: 3, targetDurationSec: 75, styleKey: "stick-figure-color", voiceId: "voice-1", quality: "STANDARD", maxBudgetUsd: budget, channelId },
  });
}

/** A crayon series ready to write: pitched, picked, Part 1 waiting. `parts` fixes the channel's range. */
async function crayonStory(parts: [number, number] = [1, 1]) {
  const channel = await createChannel({ minParts: parts[0], maxParts: parts[1] });
  const batch = await channelBatch(channel.id, "Crayons");
  const f = fakeDeps();
  await runChannelIdeation({ batchId: batch.id, jobId: (await newJob({ type: "BATCH_IDEATION", batchId: batch.id })).id, deps: f.deps });
  const story = await storyFromPitch((await db.concept.findFirstOrThrow({ where: { batchId: batch.id, rank: 1 } })).id);
  return { story, episodeId: story.episodes[0].id };
}

describe.skipIf(!url)("production pipeline (integration)", () => {
  beforeAll(async () => {
    await db.$queryRawUnsafe("SELECT 1");
  });
  beforeEach(reset);

  it("sets up a channel from a prompt as a How It's Made explainer", async () => {
    const f = fakeDeps();
    const channel = await createChannelFromBrief({ brief: "How everyday toys are made", deps: f.deps });
    expect(channel).toMatchObject({ name: "How Toys Are Made", format: "PROCESS_EXPLAINER", minParts: 2, maxParts: 3, brief: "How everyday toys are made" });
  });

  it("pitches for a channel: Surprise me skips the channel's own products, three are shown, and a pick becomes a channel story", async () => {
    const channel = await createChannel();
    await db.story.create({ data: { title: "How Crayons Are Made", normalizedTitle: "how crayons are made", premise: "How wax crayons are made in a factory.", keywords: ["crayons"], channelId: channel.id } });
    const batch = await channelBatch(channel.id, null);
    const job = await newJob({ type: "BATCH_IDEATION", batchId: batch.id });
    const { deps, text } = fakeDeps();

    const result = await runChannelIdeation({ batchId: batch.id, jobId: job.id, deps });

    expect(result).toMatchObject({ pitches: 6, shown: 3, duplicates: 1 });
    expect(text.prompts.pitch_batch[0]).toContain("Surprise me");
    expect(text.prompts.pitch_batch[0]).toContain("How Crayons Are Made");
    const concepts = await db.concept.findMany({ where: { batchId: batch.id }, orderBy: { rank: "asc" } });
    expect(concepts.filter((c) => c.status === "CANDIDATE").map((c) => c.rank)).toEqual([1, 2, 3]);
    expect(concepts.filter((c) => c.status === "DUPLICATE")[0].duplicateOfTitle).toBe("How Crayons Are Made");
    expect(concepts.find((c) => c.rank === 1)!.scores).toMatchObject({ summary: "Works because 0." });
    expect(Object.keys(text.calls).sort()).toEqual(["pitch_batch", "pitch_pick"]);

    // Retrying a finished job must not duplicate pitches.
    expect((await runChannelIdeation({ batchId: batch.id, jobId: job.id, deps })).resumed).toBe(true);

    const pick = concepts.find((c) => c.rank === 1)!;
    const story = await storyFromPitch(pick.id);
    expect(story).toMatchObject({ channelId: channel.id, plannedParts: 5, voiceId: "voice-channel", styleKey: channel.styleKey });
    expect(story.episodes).toHaveLength(1);
    expect((await db.concept.findUniqueOrThrow({ where: { id: pick.id } })).status).toBe("SELECTED");
    // Picking it again opens the same story.
    expect((await storyFromPitch(pick.id)).id).toBe(story.id);
  });

  it("keeps the producer's own product in every pitch", async () => {
    const channel = await createChannel();
    const batch = await channelBatch(channel.id, "Crayons");
    const f = fakeDeps();
    await runChannelIdeation({ batchId: batch.id, jobId: (await newJob({ type: "BATCH_IDEATION", batchId: batch.id })).id, deps: f.deps });
    expect(f.text.prompts.pitch_batch[0]).toContain("## The producer's idea (keep it exactly)\nCrayons");
    // An idea is meant to repeat itself across pitches, so nothing is dropped as a duplicate.
    expect(await db.concept.count({ where: { batchId: batch.id, status: "DUPLICATE" } })).toBe(0);
  });

  it("writes a series from web research, fact-checks each part against it, and keeps the research for rewrites", async () => {
    const { story, episodeId: part1 } = await crayonStory([3, 5]);
    const f = fakeDeps({ processAudit: "significant-once" });
    await writeScripts(part1, f.deps);

    expect(f.research.calls).toBe(1);
    expect(f.text.calls).toMatchObject({ research_notes: 1, process_plan: 1, process_narration: 4, process_audit: 5, scene_breakdown: 4, process_revision: 1 });
    expect(f.text.prompts.process_narration[0]).toContain("about 80 degrees Celsius");
    expect(f.text.prompts.process_narration[0]).toContain("Main route (follow this): From paraffin wax");
    expect(f.text.prompts.process_audit[0]).toContain("RESEARCH NOTES");
    // Checking runs on the reviewer model (the main model unless set).
    expect(f.text.models.process_audit).toBe(f.text.models.process_narration);
    // Research costs tokens plus each web search.
    const research = await db.costEntry.findFirstOrThrow({ where: { operation: "research" } });
    expect(Number(research.costUsd)).toBeGreaterThan(0.02);

    const saved = await db.story.findUniqueOrThrow({ where: { id: story.id }, include: { episodes: { orderBy: { partNumber: "asc" }, include: { currentVersion: true } } } });
    expect(saved.plannedParts).toBe(4);
    expect(saved.status).toBe("CONCEPT");
    expect((saved.research as { sources: { url: string }[] }).sources[0].url).toBe("https://example.test/crayons");
    for (const e of saved.episodes) {
      const spec = e.currentVersion!.spec as EpisodeSpecRecord;
      expect(spec.process?.part).toBe(e.partNumber);
      expect(spec.quality?.part).toBe(e.partNumber);
      expect(e.status).toBe("SCRIPTED");
      expect(e.currentVersion!.qualityStatus).toBe("passed");
    }
    // Part 1's unsupported claim was fixed by one revision.
    const q1 = (saved.episodes[0].currentVersion!.spec as EpisodeSpecRecord).quality!;
    expect(q1.scriptRounds).toHaveLength(2);
    expect(q1.scriptRounds[0].issues[0].category).toBe("unsupported-claim");
    expect(q1.metrics).toMatchObject({ firstPass: false, scriptRevisions: 1, significantFound: 1 });
    // Planning is shared, so each part carries a share; together they match what was spent writing (research is costed on the story).
    const textSpend = (await db.costEntry.findMany({ where: { storyId: story.id, provider: "OPENAI_TEXT", operation: { notIn: ["research", "research-notes"] } } })).reduce((t, c) => t + Number(c.costUsd), 0);
    const recorded = saved.episodes.reduce((t, e) => t + (e.currentVersion!.spec as EpisodeSpecRecord).quality!.metrics.textCostUsd, 0);
    expect(recorded).toBeCloseTo(textSpend, 2);
    expect(f.images.count).toBe(0);

    // Media for Part 1 only.
    await approveScript(part1, f.deps);
    const after = await db.episode.findMany({ where: { storyId: story.id }, orderBy: { partNumber: "asc" } });
    expect(after.map((e) => e.status)).toEqual(["READY", "SCRIPTED", "SCRIPTED", "SCRIPTED"]);
    expect(f.render.renders).toHaveLength(1);

    // Rewriting Part 3 reuses the saved research and plan; replanning is refused once a part is produced.
    const part3 = after[2];
    await runEpisodeJob({ jobId: (await newJob({ type: "REGENERATE_SCRIPT", episodeId: part3.id })).id, episodeId: part3.id, continueProduction: false, request: { action: "regenerate-script" } }, f.deps);
    expect(f.research.calls).toBe(1);
    expect(f.text.calls.process_plan).toBe(1);
    expect(f.text.prompts.process_narration.at(-1)).toContain("EARLIER PARTS, AS NARRATED");
    expect(await db.episodeVersion.count({ where: { episodeId: part3.id } })).toBe(2);
    expect(await db.episodeVersion.count({ where: { episodeId: after[1].id } })).toBe(1);
    await expect(
      runEpisodeJob({ jobId: (await newJob({ type: "REGENERATE_SCRIPT", episodeId: part1 })).id, episodeId: part1, continueProduction: false, request: { action: "regenerate-script", replanStory: true } }, f.deps),
    ).rejects.toThrow(/already been produced/);
  });

  it("stops at the script gate, makes the video on approval, and approval locks the episode", async () => {
    const { story, episodeId } = await crayonStory();
    const f = fakeDeps();
    await writeScripts(episodeId, f.deps);

    // Script gate: the script is written, then everything stops for review. No media spend yet.
    expect((await db.episode.findUniqueOrThrow({ where: { id: episodeId } })).status).toBe("SCRIPTED");
    expect(f.images.count).toBe(0);
    expect(f.speech.count).toBe(0);
    expect(await db.costEntry.count({ where: { episodeId, provider: { in: ["OPENAI_IMAGE", "ELEVENLABS"] } } })).toBe(0);

    await approveScript(episodeId, f.deps);

    const ep = await db.episode.findUniqueOrThrow({
      where: { id: episodeId },
      include: { currentVersion: { include: { scenes: { include: { currentImage: true } }, voiceover: true, renders: true } } },
    });
    const v = ep.currentVersion!;
    expect(ep.status).toBe("READY");
    expect(v.scenes).toHaveLength(12);
    expect(v.scenes.every((s) => s.currentImage?.status === "SUCCEEDED")).toBe(true);
    expect(v.voiceover?.status).toBe("SUCCEEDED");
    expect(v.renders.filter((r) => r.status === "SUCCEEDED")).toHaveLength(1);
    expect(v.narration.startsWith("This is how crayons are made.")).toBe(true);
    const timing = v.timing as { scenes: { startMs: number }[]; totalDurationMs: number };
    expect(timing.scenes).toHaveLength(12);
    expect(f.render.renders[0].durationInFrames).toBe(Math.round((timing.totalDurationMs / 1000) * 30));
    // Bands layout: landscape art, the series title and a band colour picked from the story.
    expect(f.render.renders[0]).toMatchObject({ layout: "bands", seriesTitle: story.title, partLabel: "Part 1", accentColor: bandColorFor(story.id) });
    expect(f.images.calls.every((c) => c.size === "1536x1024" && c.prompt.includes("EPISODE FACTS") && c.prompt.includes("THIS MOMENT"))).toBe(true);

    expect(await approvalBlockers(episodeId)).toEqual([]);
    await approveEpisode(episodeId);
    const approved = await db.episode.findUniqueOrThrow({ where: { id: episodeId }, include: { currentVersion: true } });
    expect(approved.status).toBe("APPROVED");
    expect(approved.currentVersion!.status).toBe("APPROVED");
  });

  it("regenerating one image keeps every other asset and only re-renders", async () => {
    const { episodeId } = await crayonStory();
    const f = fakeDeps();
    await writeScripts(episodeId, f.deps);
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
    const { episodeId } = await crayonStory();
    const f = fakeDeps();
    await writeScripts(episodeId, f.deps);
    await approveScript(episodeId, f.deps);
    await approveEpisode(episodeId);
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

  it("rewrites the opening into a new version, fact-checks it again, and keeps the script text in sync", async () => {
    const { episodeId } = await crayonStory();
    const f = fakeDeps();
    await writeScripts(episodeId, f.deps);
    await approveScript(episodeId, f.deps);
    const imagesBefore = f.images.count;
    const auditsBefore = f.text.calls.process_audit;

    await runEpisodeJob({ jobId: (await newJob({ type: "EPISODE_PRODUCTION", episodeId })).id, episodeId, continueProduction: true, request: { action: "rewrite-scene", sceneNumber: 1, instruction: "Plainer" } }, f.deps);

    const ep = await db.episode.findUniqueOrThrow({ where: { id: episodeId }, include: { currentVersion: { include: { scenes: { orderBy: { sceneNumber: "asc" } } } } } });
    const v = ep.currentVersion!;
    const spec = v.spec as { selectedHook: string; storyNarration: string };
    expect(v.version).toBe(2);
    expect(v.scenes[0].narration).toMatch(/rewritten\.$/);
    expect(spec.storyNarration).toBe(v.narration);
    expect(v.narration.startsWith(spec.selectedHook)).toBe(true);
    expect(f.text.calls.process_audit).toBe(auditsBefore + 1);
    expect(f.text.prompts.scene_rewrite[0]).toContain("Producer instruction: Plainer");
    expect(f.images.count).toBe(imagesBefore + 1); // only scene 1, whose visual changed
    expect(ep.status).toBe("READY");
  });

  it("keeps successful images when one scene fails, then resumes on retry", async () => {
    const { episodeId } = await crayonStory();
    const f = fakeDeps();
    const failing = { ...f.deps, images: fakeImages(new Set(["5"])) };
    await writeScripts(episodeId, f.deps);
    await expect(approveScript(episodeId, failing)).rejects.toThrow(/scene\(s\) 5/);
    const v = await db.episodeVersion.findFirstOrThrow({ where: { episodeId }, include: { scenes: true } });
    expect(v.scenes.filter((s) => s.currentImageId)).toHaveLength(11);

    const writesBefore = f.text.calls.process_narration;
    await writeScripts(episodeId, f.deps);
    expect(f.text.calls.process_narration).toBe(writesBefore); // script not rewritten
    expect(f.images.count).toBe(1); // only the missing scene
    expect((await db.episode.findUniqueOrThrow({ where: { id: episodeId } })).status).toBe("READY");
  });

  it("blocks a script that contradicts the research: saved for review, never produced, until the issue is resolved", async () => {
    const { episodeId } = await crayonStory();
    const f = fakeDeps({ processAudit: "blocking-always" });
    await writeScripts(episodeId, f.deps);

    // Bounded: the first check plus two targeted revisions, each checked again.
    expect(f.text.calls.process_revision).toBe(MAX_SCRIPT_REVISIONS);
    expect(f.text.calls.process_audit).toBe(MAX_SCRIPT_REVISIONS + 1);
    const blocked = await db.episode.findUniqueOrThrow({ where: { id: episodeId }, include: { currentVersion: true } });
    expect(blocked.status).toBe("SCRIPTED");
    expect(blocked.currentVersion!.qualityStatus).toBe("blocked");
    const quality = (blocked.currentVersion!.spec as EpisodeSpecRecord).quality!;
    expect(quality.issues[0]).toMatchObject({ severity: "blocking", category: "unsupported-claim", stage: "script", verified: true });
    expect(quality.scriptRounds[1].changeLog[0].issueId).toBe("S1.1");

    // Neither approving nor the override can spend on media for a blocked script.
    await expect(approveScript(episodeId, f.deps)).rejects.toBeInstanceOf(ScriptGateError);
    const job = await newJob({ type: "RENDER", episodeId });
    await expect(runEpisodeJob({ jobId: job.id, episodeId, continueProduction: true, request: { action: "render", acceptOpenNotes: true } }, f.deps)).rejects.toBeInstanceOf(ScriptGateError);
    await expect(runEpisodeJob({ jobId: job.id, episodeId, continueProduction: true, request: { action: "regenerate-image", sceneNumbers: [1] } }, f.deps)).rejects.toBeInstanceOf(ScriptGateError);
    expect(f.images.count).toBe(0);
    expect(f.speech.count).toBe(0);

    // The producer judges the issue wrong: dismissing it is recorded and unblocks the script.
    const dismissed = withDismissal(quality, quality.issues[0].id, "The research says so");
    expect(dismissed.status).toBe("passed");
    expect(dismissed.dismissed[0].note).toBe("The research says so");
  });

  it("needs an explicit override to produce a script with open issues, and records it", async () => {
    const { episodeId } = await crayonStory();
    const f = fakeDeps({ processAudit: "significant-always" });
    await writeScripts(episodeId, f.deps);
    expect(f.text.calls.process_revision).toBe(MAX_SCRIPT_REVISIONS);
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

  it("fixes flagged issues as a new version", async () => {
    const { episodeId } = await crayonStory();
    const f = fakeDeps({ processAudit: "significant-always" });
    await writeScripts(episodeId, f.deps);
    const fixed = fakeDeps();
    await runEpisodeJob({ jobId: (await newJob({ type: "REGENERATE_SCRIPT", episodeId })).id, episodeId, continueProduction: false, request: { action: "revise-script" } }, fixed.deps);
    expect(fixed.text.prompts.process_revision[0]).toContain("S3.1");
    const revised = await db.episode.findUniqueOrThrow({ where: { id: episodeId }, include: { currentVersion: true } });
    expect(revised.currentVersion).toMatchObject({ version: 2, reason: "revise-issues", qualityStatus: "passed" });
    expect(revised.status).toBe("SCRIPTED");
  });

  it("enforces the budget before paid steps", async () => {
    const channel = await createChannel();
    const batch = await channelBatch(channel.id, null, 0.0001);
    const f = fakeDeps();
    await expect(runChannelIdeation({ batchId: batch.id, jobId: (await newJob({ type: "BATCH_IDEATION", batchId: batch.id })).id, deps: f.deps })).rejects.toBeInstanceOf(
      BudgetExceededError,
    );
  });

  it("checks each image and redraws a wrong one once, with the problem spelled out", async () => {
    const { episodeId } = await crayonStory();
    const f = fakeDeps({}, { rejectOnce: new Set(["3"]) });
    await writeScripts(episodeId, f.deps);
    await approveScript(episodeId, f.deps);
    expect(f.images.count).toBe(13); // 12 scenes + 1 redraw
    expect(f.images.reviews).toBe(13);
    const redraw = f.images.calls.find((c) => c.prompt.includes("A previous attempt was rejected"));
    expect(redraw?.prompt).toContain("The crayons are already boxed at the melting step");
    expect(await db.costEntry.count({ where: { operation: "scene-image-3-redraw" } })).toBe(1);
  });
});
