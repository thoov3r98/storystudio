/*
 * End-to-end pipeline test against a real Postgres database with fake
 * providers. Requires TEST_DATABASE_URL (migrated). Skipped otherwise.
 *
 *   pnpm prisma dev -d --name iws-test     # prints a postgres:// URL
 *   DIRECT_URL=<url> DATABASE_URL=<url> pnpm prisma migrate deploy
 *   TEST_DATABASE_URL=<url> DATABASE_POOL_MAX=1 pnpm test
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
      libraryAudio: (key: string) => `audio/${key}.mp3`,
    },
  };
});

const { db } = await import("@/lib/db");
const { bandColorFor } = await import("@/lib/constants");
const { createStoryFromScript, runScriptJob } = await import("@/lib/pipeline/paste");
const { runEpisodeJob } = await import("@/lib/pipeline/produce");
const { approveEpisode, approvalBlockers, editHeadline, editScene } = await import("@/lib/pipeline/versions");
const { BudgetExceededError } = await import("@/lib/costs/record");
const { fakeDeps, fakeImages, makeScript, FAKE_VISUAL_STATE } = await import("./fakes");

type Deps = Parameters<typeof runEpisodeJob>[1];

async function reset() {
  const tables = await db.$queryRawUnsafe<{ tablename: string }[]>(`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`);
  await db.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} CASCADE`);
}

async function newJob(data: { type: "STORYBOARD" | "EPISODE_PRODUCTION" | "REGENERATE_IMAGE" | "RENDER"; episodeId?: string; storyId?: string }) {
  return db.job.create({ data: { ...data, input: {} } });
}

async function createChannel() {
  return db.channel.create({ data: { name: "How It's Made", format: "PROCESS_EXPLAINER", profile: { visuals: "Machines and materials fill the frame." }, voiceId: "voice-channel" } });
}

/** Pastes a script and storyboards it, as the Make videos form and the script job do. */
async function paste(opts: { sentences?: number; parts?: number; title?: string; hook?: string; visualNotes?: string; deps?: Deps; script?: string } = {}) {
  const channel = await createChannel();
  const story = await createStoryFromScript({
    channelId: channel.id,
    script: opts.script ?? makeScript(opts.sentences ?? 12),
    parts: opts.parts ?? 1,
    title: opts.title,
    hook: opts.hook,
    visualNotes: opts.visualNotes,
  });
  const f = fakeDeps();
  const deps = opts.deps ?? f.deps;
  const job = await newJob({ type: "STORYBOARD", storyId: story.id });
  const result = await runScriptJob({ jobId: job.id, storyId: story.id, hook: opts.hook ?? null, titleLocked: Boolean(opts.title) }, deps);
  return { story, channel, episodeIds: result.episodeIds, f };
}

/** Makes the video, as the production job queued after storyboarding does. */
async function produce(episodeId: string, deps: Deps) {
  const job = await newJob({ type: "EPISODE_PRODUCTION", episodeId });
  await runEpisodeJob({ jobId: job.id, episodeId, continueProduction: true, request: { action: "render" } }, deps);
}

describe.skipIf(!url)("production pipeline (integration)", () => {
  beforeAll(async () => {
    await db.$queryRawUnsafe("SELECT 1");
  });
  beforeEach(reset);

  it("splits a pasted script into a numbered series, storyboards each part with the producer's exact words, and keeps Part 1's look", async () => {
    const script = makeScript(36);
    const { story, f, episodeIds } = await paste({ script, parts: 3, visualNotes: "Keep the factory bright." });

    expect(f.text.calls).toEqual({ script_split: 1, storyboard: 3 });
    expect(f.text.prompts.script_split[0]).toContain("SCRIPT (36 sentences)");
    const saved = await db.story.findUniqueOrThrow({ where: { id: story.id }, include: { episodes: { orderBy: { partNumber: "asc" }, include: { currentVersion: { include: { scenes: { orderBy: { sceneNumber: "asc" } } } } } } } });
    expect(saved).toMatchObject({ title: "How Crayons Are Made", plannedParts: 3, sourceScript: script, visualNotes: "Keep the factory bright." });
    expect(episodeIds).toHaveLength(3);

    // The parts, joined, are the script word for word, with the producer's capitals and punctuation.
    const narrations = saved.episodes.map((e) => e.currentVersion!.narration);
    expect(narrations.join(" ")).toBe(script);
    expect(saved.episodes.map((e) => e.script)).toEqual(narrations);
    expect(saved.episodes[0].currentVersion!.scenes[0].narration).toBe("This is how crayons are made.");
    for (const e of saved.episodes) {
      expect(e.status).toBe("SCRIPTED");
      expect(e.title).toBe(`Crayons part ${e.partNumber}`);
      expect(e.currentVersion!.scenes.length).toBe(12);
      expect(e.currentVersion!.reason).toBe("pasted");
      const spec = e.currentVersion!.spec as EpisodeSpecRecord;
      expect(spec.storyNarration).toBe(e.currentVersion!.narration);
      expect(spec.onScreenHook).toBe("It starts as *wax*");
    }
    // Later parts are told Part 1's look; every storyboard gets the channel's rules, the notes and the whole script.
    expect(f.text.prompts.storyboard[0]).not.toContain("THE SERIES' LOOK");
    expect(f.text.prompts.storyboard[1]).toContain("THE SERIES' LOOK (from Part 1)");
    expect(f.text.prompts.storyboard[1]).toContain(FAKE_VISUAL_STATE.heroLook);
    expect(f.text.prompts.storyboard[2]).toContain("WHOLE SCRIPT");
    expect(f.text.systems.storyboard.every((s) => s.includes("Keep the factory bright.") && s.includes("Machines and materials fill the frame."))).toBe(true);
    // Nothing is spent on media until production runs.
    expect(f.images.count).toBe(0);

    // Retrying the finished job costs nothing.
    await runScriptJob({ jobId: (await newJob({ type: "STORYBOARD", storyId: story.id })).id, storyId: story.id, hook: null, titleLocked: false }, f.deps);
    expect(f.text.calls).toEqual({ script_split: 1, storyboard: 3 });
  });

  it("keeps the producer's title and hook, and splits evenly when the model can't find breaks", async () => {
    const f = fakeDeps({ splitAlwaysBad: true });
    const { story } = await paste({ sentences: 24, parts: 2, title: "My Crayon Series", hook: "Wax *becomes* colour", deps: f.deps });
    expect(f.text.calls.script_split).toBe(3); // bounded retries, then the even split
    const saved = await db.story.findUniqueOrThrow({ where: { id: story.id }, include: { episodes: { orderBy: { partNumber: "asc" }, include: { currentVersion: true } } } });
    expect(saved.title).toBe("My Crayon Series");
    // Split near the middle by length: 150 and 132 words.
    expect(saved.episodes.map((e) => e.currentVersion!.wordCount)).toEqual([150, 132]);
    expect(saved.episodes.map((e) => e.currentVersion!.narration).join(" ")).toBe(makeScript(24));
    expect((saved.episodes[0].currentVersion!.spec as EpisodeSpecRecord).onScreenHook).toBe("Wax *becomes* colour");
    expect((saved.episodes[1].currentVersion!.spec as EpisodeSpecRecord).onScreenHook).toBe("It starts as *wax*");
  });

  it("sends a storyboard back when its shots drop a word", async () => {
    const f = fakeDeps({ storyboardDropWordOnce: true });
    const { episodeIds } = await paste({ deps: f.deps });
    expect(f.text.calls.storyboard).toBe(2);
    expect(f.text.prompts.storyboard[1]).toContain("must reproduce the narration word for word");
    const v = await db.episode.findUniqueOrThrow({ where: { id: episodeIds[0] }, include: { currentVersion: true } });
    expect(v.currentVersion!.narration).toBe(makeScript(12));
  });

  it("refuses a script with fewer sentences than videos", async () => {
    const channel = await createChannel();
    await expect(createStoryFromScript({ channelId: channel.id, script: makeScript(3), parts: 4 })).rejects.toThrow(/can't be split into 4 videos/);
  });

  it("makes the video from the storyboard, and approval locks the episode", async () => {
    const { story, f, episodeIds } = await paste({ sentences: 24, parts: 2 });
    const episodeId = episodeIds[0];
    await produce(episodeId, f.deps);

    const ep = await db.episode.findUniqueOrThrow({
      where: { id: episodeId },
      include: { currentVersion: { include: { scenes: { include: { currentImage: true } }, voiceover: true, renders: true } } },
    });
    const v = ep.currentVersion!;
    expect(ep.status).toBe("READY");
    expect(v.scenes).toHaveLength(12);
    expect(v.scenes.every((s) => s.currentImage?.status === "SUCCEEDED")).toBe(true);
    expect(v.voiceover?.status).toBe("SUCCEEDED");
    expect(v.voiceover?.text).toBe(v.narration);
    expect(v.renders.filter((r) => r.status === "SUCCEEDED")).toHaveLength(1);
    const timing = v.timing as { scenes: { startMs: number }[]; totalDurationMs: number };
    expect(timing.scenes).toHaveLength(12);
    expect(f.render.renders[0].durationInFrames).toBe(Math.round((timing.totalDurationMs / 1000) * 30));
    const saved = await db.story.findUniqueOrThrow({ where: { id: story.id } });
    expect(f.render.renders[0]).toMatchObject({ layout: "square", seriesTitle: saved.title, partLabel: "Part 1 of 2", accentColor: bandColorFor(story.id), hookText: "It starts as *wax*", sounds: 12, music: true });
    expect(f.render.renders[0].steps).toEqual(["Melting the wax", "Moulding the crayons"]);
    expect(f.render.renders[0].focused).toBe(12);
    expect(f.render.renders[0].hookFrames).toBeGreaterThanOrEqual(66);
    expect(v.postCopy).toMatchObject({ coverSceneNumber: 1, hashtags: ["#howitsmade", "#crayons", "#factory"] });
    expect(f.text.systems.post_copy[0]).toContain("part 1 of 2");
    expect(f.sound.calls).toEqual({ effects: 2, music: 1 });
    expect(f.images.calls.every((c) => c.size === "1024x1024" && c.prompt.includes("One square picture") && c.prompt.includes("THIS MOMENT"))).toBe(true);
    // Part 2 is untouched until its own job runs.
    expect((await db.episode.findUniqueOrThrow({ where: { id: episodeIds[1] } })).status).toBe("SCRIPTED");

    expect(await approvalBlockers(episodeId)).toEqual([]);
    expect(await approvalBlockers(episodeIds[1])).toEqual(["Earlier parts must be approved first."]);
    await approveEpisode(episodeId);
    const approved = await db.episode.findUniqueOrThrow({ where: { id: episodeId }, include: { currentVersion: true } });
    expect(approved.status).toBe("APPROVED");
    expect(approved.currentVersion!.status).toBe("APPROVED");
  });

  it("a hand edit of a shot's picture redraws only that shot; an edit of its words records a new voiceover", async () => {
    const { f, episodeIds } = await paste();
    const episodeId = episodeIds[0];
    await produce(episodeId, f.deps);
    const v1 = await db.episodeVersion.findFirstOrThrow({ where: { episodeId }, include: { scenes: { orderBy: { sceneNumber: "asc" } } } });
    const counts = { images: f.images.count, speech: f.speech.count };

    expect(await editScene(episodeId, 3, { narration: v1.scenes[2].narration, imagePrompt: v1.scenes[2].imagePrompt })).toEqual({ changed: false });
    await editScene(episodeId, 3, { narration: v1.scenes[2].narration, imagePrompt: "A close-up of wax in a mould" });
    await produce(episodeId, f.deps);
    const v2 = await db.episode.findUniqueOrThrow({ where: { id: episodeId }, include: { currentVersion: { include: { scenes: { orderBy: { sceneNumber: "asc" } } } } } });
    expect(v2.currentVersion!.version).toBe(2);
    expect(f.images.count).toBe(counts.images + 1);
    expect(f.speech.count).toBe(counts.speech);
    expect(v2.currentVersion!.voiceoverId).toBe(v1.voiceoverId);
    expect(v2.currentVersion!.scenes[2].imagePrompt).toBe("A close-up of wax in a mould");
    expect(v2.currentVersion!.scenes[0].currentImageId).toBe(v1.scenes[0].currentImageId);

    await editScene(episodeId, 2, { narration: "The wax  is melted   slowly.", imagePrompt: v1.scenes[1].imagePrompt });
    await produce(episodeId, f.deps);
    const v3 = await db.episode.findUniqueOrThrow({ where: { id: episodeId }, include: { currentVersion: { include: { voiceover: true } } } });
    expect(f.speech.count).toBe(counts.speech + 1);
    expect(f.images.count).toBe(counts.images + 1);
    expect(v3.currentVersion!.narration).toContain("made. The wax is melted slowly. step2w0");
    expect(v3.currentVersion!.voiceover!.text).toBe(v3.currentVersion!.narration);
    expect((v3.currentVersion!.spec as EpisodeSpecRecord).storyNarration).toBe(v3.currentVersion!.narration);
    expect(f.render.renders).toHaveLength(3);
  });

  it("edits the title and hook text without regenerating anything", async () => {
    const { f, episodeIds } = await paste();
    const episodeId = episodeIds[0];
    await produce(episodeId, f.deps);
    const counts = { images: f.images.count, speech: f.speech.count };
    await editHeadline(episodeId, { title: "Crayons, start to finish", onScreenHook: "Hot wax *in*, crayons out" });
    await produce(episodeId, f.deps);
    const ep = await db.episode.findUniqueOrThrow({ where: { id: episodeId }, include: { currentVersion: true } });
    expect(ep.title).toBe("Crayons, start to finish");
    expect((ep.currentVersion!.spec as EpisodeSpecRecord).onScreenHook).toBe("Hot wax *in*, crayons out");
    expect(f.render.renders.at(-1)!.hookText).toBe("Hot wax *in*, crayons out");
    expect({ images: f.images.count, speech: f.speech.count }).toEqual(counts);
  });

  it("regenerating one image keeps every other asset and only re-renders", async () => {
    const { f, episodeIds } = await paste();
    const episodeId = episodeIds[0];
    await produce(episodeId, f.deps);
    const before = await db.episodeVersion.findFirstOrThrow({ where: { episodeId }, include: { scenes: true } });
    const imagesBefore = f.images.count;
    const speechBefore = f.speech.count;

    await runEpisodeJob({ jobId: (await newJob({ type: "REGENERATE_IMAGE", episodeId })).id, episodeId, continueProduction: true, request: { action: "regenerate-image", sceneNumbers: [3] } }, f.deps);

    const after = await db.episodeVersion.findFirstOrThrow({ where: { id: before.id }, include: { scenes: { include: { images: true } } } });
    expect(f.images.count).toBe(imagesBefore + 1);
    expect(f.speech.count).toBe(speechBefore);
    const s3 = after.scenes.find((s) => s.sceneNumber === 3)!;
    expect(s3.images).toHaveLength(2); // history kept
    for (const s of after.scenes.filter((x) => x.sceneNumber !== 3)) {
      expect(s.currentImageId).toBe(before.scenes.find((b) => b.sceneNumber === s.sceneNumber)!.currentImageId);
    }
    expect(f.render.renders).toHaveLength(2);
    expect(f.sound.calls).toEqual({ effects: 2, music: 1 });
  });

  it("re-renders with the current settings without regenerating anything", async () => {
    const { f, episodeIds } = await paste();
    const episodeId = episodeIds[0];
    await produce(episodeId, f.deps);
    const counts = { images: f.images.count, speech: f.speech.count, text: { ...f.text.calls } };

    // A plain render with nothing changed makes no new MP4; an explicit re-render does.
    await produce(episodeId, f.deps);
    expect(f.render.renders).toHaveLength(1);
    await runEpisodeJob({ jobId: (await newJob({ type: "RENDER", episodeId })).id, episodeId, continueProduction: true, request: { action: "render", rerender: true } }, f.deps);

    expect(f.render.renders).toHaveLength(2);
    expect(f.images.count).toBe(counts.images);
    expect(f.speech.count).toBe(counts.speech);
    expect(f.text.calls).toEqual(counts.text); // post text kept
    expect((await db.episode.findUniqueOrThrow({ where: { id: episodeId } })).status).toBe("READY");
  });

  it("forks a new version instead of editing an approved one", async () => {
    const { f, episodeIds } = await paste();
    const episodeId = episodeIds[0];
    await produce(episodeId, f.deps);
    await approveEpisode(episodeId);
    const approved = await db.episodeVersion.findFirstOrThrow({ where: { episodeId, status: "APPROVED" }, include: { scenes: true } });

    await runEpisodeJob({ jobId: (await newJob({ type: "REGENERATE_IMAGE", episodeId })).id, episodeId, continueProduction: false, request: { action: "regenerate-image", sceneNumbers: [1] } }, f.deps);

    const ep = await db.episode.findUniqueOrThrow({ where: { id: episodeId }, include: { currentVersion: { include: { scenes: true } } } });
    expect(ep.currentVersionId).not.toBe(approved.id);
    expect(ep.currentVersion!.parentVersionId).toBe(approved.id);
    const untouched = await db.episodeVersion.findUniqueOrThrow({ where: { id: approved.id }, include: { scenes: true } });
    expect(untouched.status).toBe("APPROVED");
    expect(untouched.scenes.map((s) => s.currentImageId)).toEqual(approved.scenes.map((s) => s.currentImageId));
    expect(ep.currentVersion!.voiceoverId).toBe(untouched.voiceoverId);
  });

  it("keeps successful images when one scene fails, then resumes on retry", async () => {
    const { f, episodeIds } = await paste();
    const episodeId = episodeIds[0];
    const failing = { ...f.deps, images: fakeImages(new Set(["5"])) };
    await expect(produce(episodeId, failing)).rejects.toThrow(/scene\(s\) 5/);
    const v = await db.episodeVersion.findFirstOrThrow({ where: { episodeId }, include: { scenes: true } });
    expect(v.scenes.filter((s) => s.currentImageId)).toHaveLength(11);

    await produce(episodeId, f.deps);
    expect(f.images.count).toBe(1); // only the missing scene
    expect((await db.episode.findUniqueOrThrow({ where: { id: episodeId } })).status).toBe("READY");
  });

  it("enforces the budget before paid steps", async () => {
    const channel = await createChannel();
    const story = await createStoryFromScript({ channelId: channel.id, script: makeScript(12), parts: 1 });
    const f = fakeDeps();
    await expect(runScriptJob({ jobId: (await newJob({ type: "STORYBOARD", storyId: story.id })).id, storyId: story.id, hook: null, titleLocked: false, budgetUsd: 0.0001 }, f.deps)).rejects.toBeInstanceOf(
      BudgetExceededError,
    );
    expect(f.text.calls).toEqual({});
  });

  it("checks each image and redraws a wrong one once, with the problem spelled out", async () => {
    const f = fakeDeps({}, { rejectOnce: new Set(["3"]) });
    const { episodeIds } = await paste({ deps: f.deps });
    await produce(episodeIds[0], f.deps);
    expect(f.images.count).toBe(13); // 12 scenes + 1 redraw
    expect(f.images.reviews).toBe(13);
    const redraw = f.images.calls.find((c) => c.prompt.includes("A previous attempt was rejected"));
    expect(redraw?.prompt).toContain("The crayons are already boxed at the melting step");
    expect(await db.costEntry.count({ where: { operation: "scene-image-3-redraw" } })).toBe(1);
  });
});
