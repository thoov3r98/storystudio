/*
 * Seeds a TEST database with one produced story for Playwright. Never run
 * against production: it truncates every table first.
 *
 *   DATABASE_URL=<test db> pnpm tsx tests/e2e/seed.ts
 */
import { db } from "@/lib/db";
import { makeDraft, makeScript } from "../integration/fakes";
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
  const channel = await db.channel.create({ data: { name: "How It's Made", format: "PROCESS_EXPLAINER", profile: { visuals: "Machines and materials fill the frame." }, voiceId: "test-voice" } });
  await db.channel.create({ data: { name: "The Invisible World", format: "INVISIBLE_EXPLAINER", profile: { visuals: "" }, voiceId: "test-voice", styleKey: "invisible-cutaway" } });

  const script = makeScript(12);
  const draft = makeDraft(script, 1);

  const story = await db.story.create({
    data: {
      title: "How Crayons Are Made",
      normalizedTitle: "how crayons are made",
      sourceScript: script,
      status: "READY",
      voiceId: "test-voice",
      thumbnailUrl: svg(1),
      channelId: channel.id,
    },
  });
  const pencils = await db.story.create({
    data: { title: "How Pencils Are Made", normalizedTitle: "how pencils are made", sourceScript: "Pencils start as cedar slats. Graphite is pressed into rods.", status: "CONCEPT", channelId: channel.id, episodes: { create: { partNumber: 1, title: "How Pencils Are Made", script: "Pencils start as cedar slats. Graphite is pressed into rods." } } },
  });

  const episode = await db.episode.create({ data: { storyId: story.id, partNumber: 1, title: draft.title, script, status: "READY" } });
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
      reason: "pasted",
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
  // A storyboard that failed: shown on the story page and the jobs page, with a retry.
  await db.job.create({
    data: { type: "STORYBOARD", storyId: pencils.id, status: "FAILED", input: { storyId: pencils.id, hook: null, titleLocked: false }, error: { name: "MissingConfigError", message: "TRIGGER_SECRET_KEY is not configured." }, completedAt: new Date() },
  });
  await db.costEntry.create({ data: { provider: "OPENAI_TEXT", model: "seed", operation: "seed", usage: {}, costUsd: "0.42", storyId: story.id, episodeId: episode.id } });

  console.log(JSON.stringify({ storyId: story.id, episodeId: episode.id, pencilsStoryId: pencils.id }));
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
