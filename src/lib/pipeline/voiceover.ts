import { db } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";
import { withRetry, withTimeout } from "@/lib/async";
import { mp3DurationMs } from "@/lib/mp3";
import { alignmentToWords, buildEpisodeTiming, type CharAlignment } from "@/lib/timing";
import { paths, uploadAsset } from "@/lib/storage";
import { speechCost } from "@/lib/costs/pricing";
import { assertWithinBudget, recordCost, type CostContext } from "@/lib/costs/record";
import { getModels, getPricing, getVoiceSettings } from "@/lib/settings";
import { env } from "@/lib/env";
import { VIDEO } from "@/lib/constants";
import { joinNarration } from "@/lib/text";
import type { PipelineDeps } from "./deps";

export async function generateVoiceover(input: { versionId: string; cost: CostContext; deps: PipelineDeps }) {
  const version = await db.episodeVersion.findUniqueOrThrow({
    where: { id: input.versionId },
    include: { episode: { include: { story: true } }, scenes: { orderBy: { sceneNumber: "asc" } } },
  });
  const story = version.episode.story;
  const voiceId = story.voiceId ?? env().ELEVENLABS_DEFAULT_VOICE_ID;
  if (!voiceId) throw new Error("No narrator voice selected for this story and ELEVENLABS_DEFAULT_VOICE_ID is not set.");
  const text = joinNarration(version.scenes);
  const settings = await getVoiceSettings();
  const pricing = await getPricing();
  await assertWithinBudget(input.cost, speechCost(pricing, text.length));

  const last = await db.voiceover.aggregate({ where: { episodeVersion: { episodeId: version.episodeId } }, _max: { version: true } });
  const row = await db.voiceover.create({
    data: {
      episodeVersionId: version.id,
      version: (last._max.version ?? 0) + 1,
      status: "GENERATING",
      voiceId,
      modelId: (await getModels()).speech,
      settings,
      text,
      characterCount: text.length,
    },
  });

  try {
    const result = await withRetry(
      () => withTimeout("Voiceover", 5 * 60_000, () => input.deps.speech.synthesize({ voiceId, text, settings })),
      { attempts: 3, baseDelayMs: 3000, shouldRetry: (e) => !/voice.*not.*found|unauthori[sz]ed|quota/i.test(String((e as Error)?.message)) },
    );
    const durationMs = mp3DurationMs(result.mp3);
    if (!durationMs) throw new Error("Could not read the duration of the generated MP3.");
    const words = alignmentToWords(result.alignment);
    const costUsd = speechCost(pricing, text.length);
    await recordCost(input.cost, { provider: "ELEVENLABS", model: result.modelId, operation: "voiceover", usage: { characters: text.length, durationMs }, costUsd, estimated: true });

    const uploaded = await uploadAsset(paths.voiceover(story.id, version.episodeId, row.version), result.mp3, "audio/mpeg");
    await db.$transaction([
      db.voiceover.update({
        where: { id: row.id },
        data: {
          status: "SUCCEEDED",
          url: uploaded.url,
          blobPath: uploaded.pathname,
          durationMs,
          alignment: result.alignment,
          words: words.map(({ text, startMs, endMs }) => ({ text, startMs, endMs })),
          modelId: result.modelId,
          costUsd: costUsd.toFixed(6),
        },
      }),
      db.episodeVersion.update({ where: { id: version.id }, data: { voiceoverId: row.id, timing: Prisma.DbNull } }),
    ]);
    return { voiceoverId: row.id, durationMs };
  } catch (err) {
    await db.voiceover.update({ where: { id: row.id }, data: { status: "FAILED", error: String((err as Error)?.message ?? err).slice(0, 2000) } });
    throw err;
  }
}

/** Derives scene boundaries and captions from the current voiceover's real alignment. */
export async function synchronizeNarration(versionId: string) {
  const version = await db.episodeVersion.findUniqueOrThrow({
    where: { id: versionId },
    include: { voiceover: true, scenes: { orderBy: { sceneNumber: "asc" } } },
  });
  const vo = version.voiceover;
  if (!vo || vo.status !== "SUCCEEDED" || !vo.alignment || !vo.durationMs) throw new Error("Voiceover is missing; generate it before synchronising.");
  if (vo.text !== joinNarration(version.scenes)) throw new Error("Voiceover text does not match the current script; regenerate the voiceover.");
  const timing = buildEpisodeTiming({
    scenes: version.scenes.map((s) => ({ sceneNumber: s.sceneNumber, narration: s.narration })),
    alignment: vo.alignment as CharAlignment,
    audioDurationMs: vo.durationMs,
    tailMs: VIDEO.tailMs,
  });
  await db.episodeVersion.update({ where: { id: versionId }, data: { timing } });
  return timing;
}
