/*
 * Seeds a TEST database with one produced story for Playwright. Never run
 * against production: it truncates every table first.
 *
 *   DATABASE_URL=<test db> pnpm tsx tests/e2e/seed.ts
 */
import { db } from "@/lib/db";
import { applyBibleUpdate, emptyBible } from "@/lib/schemas/story-bible";
import { makeDraft } from "../integration/fakes";
import { buildEpisodeTiming } from "@/lib/timing";

if (!process.env.DATABASE_URL || /neon\.tech/.test(process.env.DATABASE_URL) || process.env.ALLOW_E2E_SEED !== "1") {
  console.error("Refusing to seed: set ALLOW_E2E_SEED=1 and point DATABASE_URL at a disposable local test database.");
  process.exit(1);
}

const svg = (n: number) =>
  `data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 300"><rect width="200" height="300" fill="#FAFAF7"/><circle cx="100" cy="80" r="18" fill="none" stroke="#111" stroke-width="4"/><path d="M100 98v70M100 168l-25 50M100 168l25 50M100 120l-30 ${10 + n}M100 120l30 -${n}" stroke="#111" stroke-width="4" fill="none" stroke-linecap="round"/></svg>`,
  )}`;

async function main() {
  const tables = await db.$queryRawUnsafe<{ tablename: string }[]>(`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`);
  await db.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} CASCADE`);

  await db.setting.create({ data: { key: "voices", value: [{ id: "test-voice", name: "Test Narrator", description: "" }] } });
  await db.character.create({
    data: {
      name: "Test Dave",
      tagline: "An ex-trucker who keeps ending up stranded",
      brief: "A friendly ex-trucker",
      personality: "Calm and stubborn.",
      backstory: "Drove long-haul for twenty years.",
      speakingStyle: "Slow and dry.",
      visualDescription: "Big stick figure with a red cap.",
      signatureColor: "#C62828",
      voiceId: "test-voice",
    },
  });

  const hook = "You land after ten hours.";
  const draft = makeDraft(hook, 1);
  const bible1 = emptyBible({ premise: "Your checked bag vanishes into a hidden network.", styleKey: "stick-figure" });

  const story = await db.story.create({
    data: {
      title: "Where Does Your Lost Luggage Actually Go?",
      normalizedTitle: "lost luggage",
      category: "travel-transportation",
      premise: "Your checked bag vanishes into a hidden network.",
      keywords: ["luggage", "airport"],
      status: "READY",
      voiceId: "test-voice",
      thumbnailUrl: svg(1),
      bibles: { create: { version: 1, source: "concept", data: bible1 } },
    },
  });
  await db.story.create({
    data: { title: "What Happens If Every Traffic Light Turns Green?", normalizedTitle: "traffic light turns green", category: "hypothetical-disasters", premise: "A fault turns every signal green.", keywords: ["traffic"], status: "CONCEPT" },
  });

  const episode = await db.episode.create({ data: { storyId: story.id, partNumber: 1, title: draft.title, status: "READY" } });
  const narration = draft.scenes.map((s) => s.narration).join(" ");
  const chars = [...narration];
  let t = 0;
  const starts = chars.map(() => (t += 0.06) - 0.06);
  const alignment = { characters: chars, characterStartTimesSeconds: starts, characterEndTimesSeconds: starts.map((s) => s + 0.06) };
  const timing = buildEpisodeTiming({ scenes: draft.scenes, alignment, audioDurationMs: Math.round(t * 1000), tailMs: 900 });

  const version = await db.episodeVersion.create({
    data: {
      episodeId: episode.id,
      version: 1,
      reason: "initial",
      spec: { ...draft, scenes: undefined, storyId: story.id, partNumber: 1, narration, wordCount: 169, estimatedDurationSec: 72, factCheckStatus: "PASSED" },
      narration,
      wordCount: 169,
      estimatedDurationSec: 72,
      summary: draft.summary,
      factCheckStatus: "PASSED",
      styleKey: "stick-figure",
      timing,
      scenes: { create: draft.scenes.map((s) => ({ ...s, intendedDurationSec: 6 })) },
    },
    include: { scenes: true },
  });
  for (const scene of version.scenes) {
    const img = await db.sceneImage.create({ data: { sceneId: scene.id, version: 1, status: "SUCCEEDED", url: svg(scene.sceneNumber), prompt: scene.imagePrompt, model: "seed", quality: "low" } });
    await db.scene.update({ where: { id: scene.id }, data: { currentImageId: img.id } });
  }
  await db.bibleUpdateProposal.create({ data: { storyId: story.id, episodeVersionId: version.id, baseBibleVersion: 1, update: draft.bibleUpdate } });
  await db.episode.update({ where: { id: episode.id }, data: { currentVersionId: version.id } });
  // Pre-compute what approval would produce so the bible view has content to show.
  void applyBibleUpdate;

  const batch = await db.batch.create({
    data: { mode: "CONCEPT", category: "mixed", requestedCount: 2, targetDurationSec: 75, styleKey: "stick-figure", voiceId: "test-voice", quality: "STANDARD", maxBudgetUsd: 10 },
  });
  await db.job.create({ data: { type: "BATCH_IDEATION", batchId: batch.id, status: "FAILED", input: { batchId: batch.id }, error: { name: "MissingConfigError", message: "TRIGGER_SECRET_KEY is not configured." }, completedAt: new Date() } });
  await db.costEntry.create({ data: { provider: "OPENAI_TEXT", model: "seed", operation: "seed", usage: {}, costUsd: "0.42", storyId: story.id, episodeId: episode.id } });

  console.log(JSON.stringify({ storyId: story.id, episodeId: episode.id, batchId: batch.id }));
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
