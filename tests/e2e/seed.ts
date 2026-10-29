/*
 * Seeds a TEST database with one produced story for Playwright. Never run
 * against production: it truncates every table first.
 *
 *   DATABASE_URL=<test db> pnpm tsx tests/e2e/seed.ts
 */
import { db } from "@/lib/db";
import { makeDraft } from "../integration/fakes";
import type { QualityRecord } from "@/lib/schemas/quality";
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
  const profile = (summary: string) => ({ summary, subjects: "s", voice: "Plain and factual.", structure: "In order.", avoid: ["Brand names"], surpriseMe: "Pick one.", examples: ["Crayons", "Pencils"] });
  const channel = await db.channel.create({ data: { name: "How It's Made", brief: "How things are made.", format: "PROCESS_EXPLAINER", profile: profile("How everyday products are made."), voiceId: "test-voice" } });
  await db.channel.create({ data: { name: "How Toys Are Made", brief: "How toys are made.", format: "PROCESS_EXPLAINER", profile: profile("How everyday toys are made."), voiceId: "test-voice" } });

  const hook = "This is how crayons are made.";
  const draft = makeDraft(hook, 1);

  const story = await db.story.create({
    data: {
      title: "How Crayons Are Made",
      normalizedTitle: "how crayons are made",
      premise: "How wax crayons are made in a factory.",
      keywords: ["crayons", "wax"],
      status: "READY",
      voiceId: "test-voice",
      thumbnailUrl: svg(1),
      channelId: channel.id,
    },
  });
  await db.story.create({
    data: { title: "How Pencils Are Made", normalizedTitle: "how pencils are made", premise: "How wooden pencils are made.", keywords: ["pencils"], status: "CONCEPT", channelId: channel.id },
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
      spec: { ...draft, scenes: undefined, storyId: story.id, partNumber: 1, narration, wordCount: 169, estimatedDurationSec: 72 },
      narration,
      wordCount: 169,
      estimatedDurationSec: 72,
      summary: draft.summary,
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
  await db.episode.update({ where: { id: episode.id }, data: { currentVersionId: version.id } });
  // A script waiting at the gate: written, nothing produced yet.
  const soapDraft = makeDraft("Every bar of soap starts as a vat of oil.", 1);
  const soapStory = await db.story.create({
    data: {
      title: "How Bar Soap Is Made",
      normalizedTitle: "how bar soap is made",
      premise: "How bars of soap are made in a factory.",
      keywords: ["soap"],
      status: "CONCEPT",
      channelId: channel.id,
    },
  });
  const scripted = await db.episode.create({ data: { storyId: soapStory.id, partNumber: 1, title: soapDraft.title, status: "SCRIPTED" } });
  const soapNarration = soapDraft.scenes.map((s) => s.narration).join(" ");
  // The checks left one significant issue open, so approving needs an override (or a dismissal).
  const evidence = soapNarration.split(" ").slice(6, 12).join(" ");
  const quality: QualityRecord = {
    pipelineVersion: 2,
    part: 1,
    status: "needs-attention",
    scriptRounds: [],
    issues: [
      { id: "S3.1", stage: "script", verified: true, category: "unsupported-claim", severity: "significant", kind: "contradiction", location: "Sentence 2", evidence, problem: "The research doesn't say the oil is heated to 200 degrees.", repair: "Say it is heated, without the number." },
    ],
    dismissed: [],
    override: null,
    metrics: { firstPass: false, scriptRevisions: 2, blockingFound: 0, significantFound: 2, unverifiedIssues: 0, durationMs: 190000, textCostUsd: 0.62 },
  };
  quality.scriptRounds = [{ issues: quality.issues, changeLog: [], unresolvedPrevious: [] }];
  const soapVersion = await db.episodeVersion.create({
    data: {
      episodeId: scripted.id,
      version: 1,
      reason: "initial",
      spec: { ...soapDraft, scenes: undefined, storyId: soapStory.id, partNumber: 1, narration: soapNarration, wordCount: 169, estimatedDurationSec: 72, quality },
      qualityStatus: quality.status,
      narration: soapNarration,
      wordCount: 169,
      estimatedDurationSec: 72,
      summary: "Oil and lye are mixed and heated until they turn into soap.",
      styleKey: "stick-figure",
      scenes: { create: soapDraft.scenes.map((s) => ({ ...s, intendedDurationSec: 6 })) },
    },
  });
  await db.episode.update({ where: { id: scripted.id }, data: { currentVersionId: soapVersion.id } });

  const batch = await db.batch.create({
    data: { requestedCount: 3, targetDurationSec: 75, styleKey: "stick-figure-color", voiceId: "test-voice", quality: "STANDARD", maxBudgetUsd: 10, channelId: channel.id },
  });
  await db.job.create({ data: { type: "BATCH_IDEATION", batchId: batch.id, status: "FAILED", input: { batchId: batch.id }, error: { name: "MissingConfigError", message: "TRIGGER_SECRET_KEY is not configured." }, completedAt: new Date() } });
  await db.costEntry.create({ data: { provider: "OPENAI_TEXT", model: "seed", operation: "seed", usage: {}, costUsd: "0.42", storyId: story.id, episodeId: episode.id } });

  console.log(JSON.stringify({ storyId: story.id, episodeId: episode.id, batchId: batch.id, scriptedEpisodeId: scripted.id }));
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
