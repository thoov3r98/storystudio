/*
 * Topic discovery, storytelling and hooks against a real Postgres database
 * with fake providers. Requires TEST_DATABASE_URL (migrated); see pipeline.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EpisodeSpecRecord } from "@/lib/schemas/episode";
import type { DiscoverySnapshot } from "@/lib/schemas/topics";

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
const { conceptFromCandidate, runChannelIdeation, runTopicDiscovery, storyFromPitch } = await import("@/lib/pipeline/channels");
const { runEpisodeJob } = await import("@/lib/pipeline/produce");
const { addMetricObservation, addStarterReferences, createReference, deleteReference, getReference, importReferenceMetadata, updateReference } = await import("@/lib/topics/references");
const { traction } = await import("@/lib/topics/scoring");
const { MAX_SCRIPT_REVISIONS } = await import("@/lib/process/script");
const { fakeDeps, FAKE_HOOKS } = await import("./fakes");

type Deps = Parameters<typeof runEpisodeJob>[1];

async function reset() {
  const tables = await db.$queryRawUnsafe<{ tablename: string }[]>(`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`);
  await db.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} CASCADE`);
}

const newJob = (data: { type: "BATCH_IDEATION" | "TOPIC_DISCOVERY" | "EPISODE_PRODUCTION" | "REGENERATE_SCRIPT"; batchId?: string; episodeId?: string }) => db.job.create({ data: { ...data, input: {} } });

const PROFILE = {
  summary: "How everyday products are made.",
  subjects: "One product per series.",
  voice: "Calm, third person.",
  structure: "Factory order.",
  avoid: ["Brand names"],
  surpriseMe: "Pick an everyday product.",
  examples: ["Crayons"],
};

async function channel(parts: [number, number] = [1, 1]) {
  return db.channel.create({ data: { name: "How It's Made", brief: "b", format: "PROCESS_EXPLAINER", profile: PROFILE, minParts: parts[0], maxParts: parts[1], voiceId: "voice-1" } });
}

async function batch(channelId: string, idea: string | null) {
  return db.batch.create({ data: { customDirection: idea, requestedCount: 3, targetDurationSec: 75, styleKey: "stick-figure-color", voiceId: "voice-1", quality: "STANDARD", maxBudgetUsd: 100, channelId } });
}

/** A library with one reference that has hand-entered numbers and one with none. */
async function library() {
  const flip = await createReference({ platform: "youtube", creator: "Factory Works", url: "https://www.youtube.com/watch?v=flipflop1", title: "Flip-flop factory", product: "Rubber flip-flops", category: "footwear", publishedAt: "2025-10-01", transformationType: "molding" });
  await addMetricObservation(flip.id, { views: "4000000", likes: "", observedAt: "2026-10-01" });
  const razor = await createReference({ platform: "youtube", creator: "Science Channel", url: null, title: "Razor blades", product: "Razor blades", category: "personal care" });
  return { flip, razor };
}

async function writeScripts(episodeId: string, deps: Deps) {
  await runEpisodeJob({ jobId: (await newJob({ type: "EPISODE_PRODUCTION", episodeId })).id, episodeId, continueProduction: true, request: { action: "produce" } }, deps);
}

async function act(episodeId: string, deps: Deps, request: Parameters<typeof runEpisodeJob>[0]["request"]) {
  await runEpisodeJob({ jobId: (await newJob({ type: "REGENERATE_SCRIPT", episodeId })).id, episodeId, continueProduction: false, request }, deps);
}

/** A crayon story picked from a producer's idea, with Part 1 ready to write. */
async function crayonStory(parts: [number, number] = [1, 1]) {
  const ch = await channel(parts);
  const b = await batch(ch.id, "Crayons");
  await runChannelIdeation({ batchId: b.id, jobId: (await newJob({ type: "BATCH_IDEATION", batchId: b.id })).id, deps: fakeDeps().deps });
  const story = await storyFromPitch((await db.concept.findFirstOrThrow({ where: { batchId: b.id, rank: 1 } })).id);
  return { story, episodeId: story.episodes[0].id };
}

const part1Narration = async (storyId: string) => (await db.episode.findFirstOrThrow({ where: { storyId, partNumber: 1 }, include: { currentVersion: true } })).currentVersion!;

describe.skipIf(!url)("topic discovery and storytelling (integration)", () => {
  beforeEach(reset);

  it("creates, edits, observes and deletes references without inventing numbers", async () => {
    const ref = await createReference({ platform: "tiktok", creator: "a", url: "https://www.tiktok.com/@a/video/1", title: "Mould", product: "Slippers", category: "footwear" });
    expect(ref).toMatchObject({ verification: "USER_ENTERED", normalizedProduct: "slippers", publishedAt: null, durationSec: null });
    const noUrl = await createReference({ platform: "youtube", creator: "b", url: "", title: "t", product: "p", category: "c" });
    expect(noUrl.verification).toBe("NEEDS_SOURCE");

    // Only likes were seen: views stay unknown, never zero or guessed.
    await addMetricObservation(ref.id, { views: "", likes: "900", observedAt: "2026-10-20" });
    const got = (await getReference(ref.id))!;
    expect(got.metrics[0]).toMatchObject({ views: null, likes: 900, comments: null, shares: null, source: "MANUAL" });
    expect(traction(got)).toMatchObject({ tier: "unknown", value: 0 });

    await updateReference(ref.id, { platform: "tiktok", creator: "a", url: null, title: "Mould 2", product: "Slippers", category: "footwear" });
    expect((await getReference(ref.id))!).toMatchObject({ title: "Mould 2", verification: "NEEDS_SOURCE" });

    await deleteReference(ref.id);
    expect(await getReference(ref.id)).toBeNull();
    expect(await db.referenceMetricObservation.count({ where: { referenceId: ref.id } })).toBe(0);

    // Starter references come with no numbers, and only confirmed sources have a URL.
    expect(await addStarterReferences()).toBe(5);
    expect(await addStarterReferences()).toBe(0);
    expect(await db.referenceMetricObservation.count()).toBe(0);
    expect(await db.manufacturingContentReference.count({ where: { url: { not: null }, verification: { not: "SOURCE_CONFIRMED" } } })).toBe(0);
  });

  it("confirms a reference's source from the platform; numbers only come from an API that reports them", async () => {
    const ref = await createReference({ platform: "youtube", creator: "?", url: "https://www.youtube.com/watch?v=eeI7q_eIs7g", title: "?", product: "Razor blades", category: "personal care" });
    const fetcher = (async () => new Response(JSON.stringify({ title: "How It's Made: Razor Blades", author_name: "Science Channel" }))) as typeof fetch;
    await importReferenceMetadata(ref.id, fetcher);
    const got = (await getReference(ref.id))!;
    expect(got).toMatchObject({ title: "How It's Made: Razor Blades", creator: "Science Channel", verification: "SOURCE_CONFIRMED" });
    expect(got.metrics).toHaveLength(0);
  });

  it("Surprise me with an empty library falls back to the pitch writer", async () => {
    const ch = await channel();
    const b = await batch(ch.id, null);
    const f = fakeDeps();
    const result = await runChannelIdeation({ batchId: b.id, jobId: (await newJob({ type: "BATCH_IDEATION", batchId: b.id })).id, deps: f.deps });
    expect(result).toMatchObject({ shown: 3 });
    expect(f.text.calls.topic_ideas).toBeUndefined();
    expect(f.text.calls.pitch_batch).toBe(1);
    expect(await db.concept.count({ where: { batchId: b.id } })).toBe(6);
    expect((await db.concept.findMany({ where: { batchId: b.id } })).every((c) => c.discovery === null)).toBe(true);
  });

  it("Surprise me discovers three scored, evidence-linked, diverse topics in two model calls", async () => {
    const ch = await channel();
    const { flip } = await library();
    await db.story.create({ data: { title: "How Crayons Are Made", normalizedTitle: "crayons made", premise: "How wax crayons are made.", keywords: ["crayons"], channelId: ch.id } });
    const b = await batch(ch.id, null);
    const job = await newJob({ type: "BATCH_IDEATION", batchId: b.id });
    const f = fakeDeps();

    const result = await runChannelIdeation({ batchId: b.id, jobId: job.id, deps: f.deps });

    expect(result).toMatchObject({ shown: 3, discovery: true });
    expect(f.text.calls).toEqual({ topic_ideas: 1, topic_evaluation: 1 });
    // The library is shown to the model as data with code-computed evidence, never as instructions.
    expect(f.text.prompts.topic_ideas[0]).toContain(`${flip.id} · Rubber flip-flops`);
    expect(f.text.prompts.topic_ideas[0]).toMatch(/strong traction: 4\.0M views over 12 months .* entered by hand, unverified/);

    const candidates = await db.manufacturingTopicCandidate.findMany({ where: { batchId: b.id } });
    const dupes = candidates.filter((c) => c.status === "DUPLICATE");
    // The library's own product and the channel's existing crayon story are dropped.
    expect(dupes.map((d) => d.product).sort()).toEqual(["Crayons", "Rubber flip-flops"]);
    expect(dupes.every((d) => d.score === null)).toBe(true);

    const shown = await db.concept.findMany({ where: { batchId: b.id, status: "CANDIDATE" }, orderBy: { rank: "asc" }, include: { topic: true } });
    expect(shown.map((c) => c.rank)).toEqual([1, 2, 3]);
    const snaps = shown.map((c) => c.discovery as DiscoverySnapshot);
    expect(new Set(shown.map((c) => c.topic!.category)).size).toBe(3);
    expect(snaps.map((s) => s.score)).toEqual([...snaps.map((s) => s.score)].sort((a, b) => b! - a!));
    for (const s of snaps) {
      expect(s.breakdown).toHaveLength(6);
      expect(s.curiosityAngle).toBeTruthy();
      expect(s.visualPayoff).toBeTruthy();
    }
    // Evidence is honest: hand-entered numbers are "reported", and no reference means no evidence.
    for (const c of shown) {
      const s = c.discovery as DiscoverySnapshot;
      if (s.referenceIds.length) {
        expect(s.evidenceLevel).toBe("REPORTED");
        expect(s.evidence[0].traction).toContain("unverified");
      } else {
        expect(s).toMatchObject({ evidenceLevel: "NONE", strategy: "EXPLORATORY" });
        expect(s.breakdown.find((l) => l.key === "evidence")!.points).toBe(0);
      }
    }

    // A retry keeps what was saved.
    expect((await runChannelIdeation({ batchId: b.id, jobId: job.id, deps: f.deps })).resumed).toBe(true);
    expect(f.text.calls.topic_ideas).toBe(1);

    // Picking one carries its discovery metadata onto the story.
    const story = await storyFromPitch(shown[0].id);
    expect(story).toMatchObject({ topicCandidateId: shown[0].topic!.id });
    expect((story.discovery as DiscoverySnapshot).candidateId).toBe(shown[0].topic!.id);
    expect((await db.manufacturingTopicCandidate.findUniqueOrThrow({ where: { id: shown[0].topic!.id } })).status).toBe("USED");
  });

  it("falls back to the pitch writer when discovery can't produce valid ideas", async () => {
    const ch = await channel();
    await library();
    const b = await batch(ch.id, null);
    const f = fakeDeps();
    // Discovery never returns any ideas, so it gives up after its bounded retries.
    f.deps.text = { ...f.text, generate: async (args) => (args.schemaName === "topic_ideas" ? { parsed: { ideas: [] }, usage: { inputTokens: 1, cachedInputTokens: 0, outputTokens: 1 }, model: "fake" } : f.text.generate(args)) };
    const result = await runChannelIdeation({ batchId: b.id, jobId: (await newJob({ type: "BATCH_IDEATION", batchId: b.id })).id, deps: f.deps });
    expect(result.shown).toBe(3);
    expect(f.text.calls.pitch_batch).toBe(1);
  });

  it("rejects ideas citing references that don't exist, then accepts the corrected ones", async () => {
    const ch = await channel();
    await library();
    const f = fakeDeps({ topicBadReferenceOnce: true });
    const job = await newJob({ type: "TOPIC_DISCOVERY" });
    await runTopicDiscovery({ channelId: ch.id, jobId: job.id, deps: f.deps });
    expect(f.text.calls.topic_ideas).toBe(2);
    expect(f.text.prompts.topic_ideas[1]).toContain("unknown reference ids not-a-ref");
  });

  it("Topic Research reuses recent ratings, and an approved topic goes into the normal pipeline", async () => {
    const ch = await channel();
    await library();
    const f = fakeDeps();
    await runTopicDiscovery({ channelId: ch.id, jobId: (await newJob({ type: "TOPIC_DISCOVERY" })).id, deps: f.deps });
    await runTopicDiscovery({ channelId: ch.id, jobId: (await newJob({ type: "TOPIC_DISCOVERY" })).id, deps: f.deps });
    // The same products came back; their ratings were reused rather than paid for again.
    expect(f.text.calls).toEqual({ topic_ideas: 2, topic_evaluation: 1 });

    const top = await db.manufacturingTopicCandidate.findFirstOrThrow({ where: { status: "PROPOSED", evidence: { some: {} } }, orderBy: { score: "desc" } });
    const conceptId = await conceptFromCandidate(top.id);
    const story = await storyFromPitch(conceptId);
    expect(story.title).toBe(top.title);
    expect((story.discovery as DiscoverySnapshot).generation).toBe("topic-research");

    const w = fakeDeps();
    await writeScripts(story.episodes[0].id, w.deps);
    // The approved angle reaches the storytelling decision as a hint, never as a source.
    expect(w.text.prompts.storytelling_decision[0]).toContain(`Topic angle the producer approved (a hint; keep only what the research supports): ${top.curiosityAngle}`);
  });

  it("keeps a producer's own product exactly and attaches library evidence", async () => {
    const ch = await channel();
    const { flip } = await library();
    const b = await batch(ch.id, "Rubber flip-flops");
    const f = fakeDeps();
    await runChannelIdeation({ batchId: b.id, jobId: (await newJob({ type: "BATCH_IDEATION", batchId: b.id })).id, deps: f.deps });
    expect(f.text.calls.topic_ideas).toBeUndefined();
    expect(f.text.prompts.pitch_batch[0]).toContain("## The producer's idea (keep it exactly)\nRubber flip-flops");
    const concept = await db.concept.findFirstOrThrow({ where: { batchId: b.id, rank: 1 } });
    const snap = concept.discovery as DiscoverySnapshot;
    expect(snap).toMatchObject({ generation: "library-match", referenceIds: [flip.id], evidenceLevel: "REPORTED", score: null });
  });

  it("chooses a pattern and hooks from the research, rejects unsupported hooks, and opens Part 1 with the recommended one", async () => {
    const { story, episodeId } = await crayonStory([2, 2]);
    const f = fakeDeps();
    await writeScripts(episodeId, f.deps);

    expect(f.text.calls).toMatchObject({ storytelling_decision: 1, hook_candidates: 1, hook_review: 1, process_attention: 2 });
    expect(f.text.models.hook_review).toBe(f.text.models.process_audit);
    const decision = await db.manufacturingStorytellingDecision.findUniqueOrThrow({ where: { storyId: story.id }, include: { selectedHook: true } });
    expect(decision).toMatchObject({ pattern: "FACTORY_REVEAL", patternSource: "recommended", featuredStageId: "T2" });
    expect((decision.stageVisuals as { stageId: string }[]).map((s) => s.stageId)).toEqual(["T1", "T2", "T3", "T4"]);

    const hooks = await db.manufacturingHookCandidate.findMany({ where: { storyId: story.id } });
    expect(hooks).toHaveLength(5);
    const by = (text: string) => hooks.find((h) => h.line.includes(text))!;
    expect(by("999").flags.join(" ")).toMatch(/999, which the cited claims don't contain.*Reviewer: 999 degrees/);
    expect(by("checked by hand").flags).toContain("Cites claims that don't exist: T9.9.");
    expect(by("80 degrees").flags).toEqual([]);
    expect(decision.selectedHook!.line).toBe(FAKE_HOOKS.FACTORY_REVEAL);
    expect(hooks.every((h) => h.claimIds.length > 0)).toBe(true);

    // The writer gets the hook, pattern and claim-numbered research; the auditor knows the hook may preview.
    expect(f.text.prompts.process_narration[0]).toContain("[T1.1]");
    expect(f.text.systems.process_narration[0]).toContain("STORY SHAPE");
    expect(f.text.systems.process_narration[0]).toContain(`Open with this approved hook, word for word or tightened, never replaced or embellished: "${FAKE_HOOKS.FACTORY_REVEAL}"`);
    expect(f.text.systems.process_audit[0]).toContain("That preview is intended and is not a temporal issue");
    const v1 = await part1Narration(story.id);
    expect(v1.narration.startsWith(FAKE_HOOKS.FACTORY_REVEAL)).toBe(true);
    expect((v1.spec as EpisodeSpecRecord).process?.creative).toEqual({ pattern: "FACTORY_REVEAL", hookId: decision.selectedHookId, hookLine: FAKE_HOOKS.FACTORY_REVEAL });
    const part2 = await db.episode.findFirstOrThrow({ where: { storyId: story.id, partNumber: 2 }, include: { currentVersion: true } });
    expect((part2.currentVersion!.spec as EpisodeSpecRecord).process?.creative?.hookLine).toBeNull();
  });

  it("choosing another hook rewrites only Part 1 and reuses the research", async () => {
    const { story, episodeId } = await crayonStory([2, 2]);
    const f = fakeDeps();
    await writeScripts(episodeId, f.deps);
    const research = (await db.story.findUniqueOrThrow({ where: { id: story.id } })).research;
    const part2Before = await db.episode.findFirstOrThrow({ where: { storyId: story.id, partNumber: 2 } });
    const alt = await db.manufacturingHookCandidate.findFirstOrThrow({ where: { storyId: story.id, line: { startsWith: "A box of crayons" } } });
    const before = { ...f.text.calls };

    await act(episodeId, f.deps, { action: "choose-hook", hookId: alt.id });

    expect(f.research.calls).toBe(1);
    expect(f.text.calls).toMatchObject({ research_notes: before.research_notes, process_plan: before.process_plan, storytelling_decision: 1, hook_candidates: 1 });
    expect((await db.story.findUniqueOrThrow({ where: { id: story.id } })).research).toEqual(research);
    const v = await part1Narration(story.id);
    expect(v).toMatchObject({ version: 2, reason: "choose-hook" });
    expect(v.narration.startsWith(alt.line)).toBe(true);
    expect((await db.manufacturingStorytellingDecision.findUniqueOrThrow({ where: { storyId: story.id } })).selectedHookId).toBe(alt.id);
    expect((await db.episode.findUniqueOrThrow({ where: { id: part2Before.id } })).currentVersionId).toBe(part2Before.currentVersionId);
  });

  it("switching pattern writes new hooks and rewrites unproduced parts without researching again", async () => {
    const { story, episodeId } = await crayonStory([2, 2]);
    const f = fakeDeps();
    await writeScripts(episodeId, f.deps);
    const plan = (await part1Narration(story.id)).spec as EpisodeSpecRecord;

    await act(episodeId, f.deps, { action: "switch-pattern", pattern: "TRANSFORMATION" });

    expect(f.research.calls).toBe(1);
    expect(f.text.calls).toMatchObject({ research_notes: 1, process_plan: 1, storytelling_decision: 2, hook_candidates: 2, hook_review: 2 });
    expect(f.text.systems.storytelling_decision[1]).toContain("The producer has chosen TRANSFORMATION.");
    const d = await db.manufacturingStorytellingDecision.findUniqueOrThrow({ where: { storyId: story.id }, include: { selectedHook: true } });
    expect(d).toMatchObject({ pattern: "TRANSFORMATION", patternSource: "producer" });
    expect(d.selectedHook!.line).toBe(FAKE_HOOKS.TRANSFORMATION);
    expect(await db.manufacturingHookCandidate.count({ where: { storyId: story.id } })).toBe(10); // earlier openings kept
    const eps = await db.episode.findMany({ where: { storyId: story.id }, orderBy: { partNumber: "asc" }, include: { currentVersion: true } });
    for (const e of eps) {
      const spec = e.currentVersion!.spec as EpisodeSpecRecord;
      expect(e.currentVersion!.version).toBe(2);
      expect(spec.process?.creative?.pattern).toBe("TRANSFORMATION");
      expect(spec.process?.plan).toEqual(plan.process?.plan);
    }
    expect(eps[0].currentVersion!.narration.startsWith(FAKE_HOOKS.TRANSFORMATION)).toBe(true);

    // A hook from the old pattern can't be chosen until the producer switches back.
    const old = await db.manufacturingHookCandidate.findFirstOrThrow({ where: { storyId: story.id, pattern: "FACTORY_REVEAL" } });
    await expect(act(episodeId, f.deps, { action: "choose-hook", hookId: old.id })).rejects.toThrow(/another storytelling pattern/);
  });

  it("an attention problem triggers targeted revisions under the fact check, but never blocks", async () => {
    const { episodeId } = await crayonStory();
    const f = fakeDeps({ attention: "significant-always" });
    await writeScripts(episodeId, f.deps);
    expect(f.text.calls.process_revision).toBe(MAX_SCRIPT_REVISIONS);
    // Every revision is fact-checked again, and the reviser is told it may not add facts.
    expect(f.text.calls.process_audit).toBe(MAX_SCRIPT_REVISIONS + 1);
    expect(f.text.prompts.process_revision[0]).toMatch(/A\d\.1/);
    expect(f.text.systems.process_revision[0]).toContain("never permits a new fact");
    const v = await db.episodeVersion.findFirstOrThrow({ where: { episodeId } });
    const q = (v.spec as EpisodeSpecRecord).quality!;
    expect(v.qualityStatus).toBe("needs-attention");
    expect(q.issues[0]).toMatchObject({ stage: "attention", severity: "significant", kind: "creative-concern" });
  });

  it("stories written before storytelling decisions keep working, and get one on their next Part 1 rewrite without new research", async () => {
    const { story, episodeId } = await crayonStory();
    const f = fakeDeps();
    await writeScripts(episodeId, f.deps);
    // Simulate a story from before this feature.
    await db.manufacturingStorytellingDecision.deleteMany({ where: { storyId: story.id } });
    await db.manufacturingHookCandidate.deleteMany({ where: { storyId: story.id } });

    await act(episodeId, f.deps, { action: "regenerate-script" });

    expect(f.research.calls).toBe(1);
    expect(f.text.calls.research_notes).toBe(1);
    expect(f.text.calls.storytelling_decision).toBe(2);
    expect(await db.manufacturingStorytellingDecision.count({ where: { storyId: story.id } })).toBe(1);
    expect((await part1Narration(story.id)).narration.startsWith(FAKE_HOOKS.FACTORY_REVEAL)).toBe(true);
  });
});
