import { db } from "@/lib/db";
import { generateStructured } from "@/lib/ai/structured";
import { channelDesignPrompt, pitchPickPrompt, pitchPrompt } from "@/lib/ai/channel-prompts";
import { type ChannelGuide, ChannelDesignSchema, parseProfile, PitchBatchSchema, PitchPickSchema } from "@/lib/schemas/channel";
import { DEFAULT_STYLE } from "@/lib/constants";
import { normalizeTitle } from "@/lib/text";
import { dedupeCandidates } from "@/lib/similarity";
import { getModels, getPricing, getVoices } from "@/lib/settings";
import { assertWithinBudget, type CostContext } from "@/lib/costs/record";
import { setJobStage, assertNotCanceled } from "@/lib/jobs";
import type { PipelineDeps } from "./deps";
import type { Channel, Story } from "@/generated/prisma/client";

/** Pitches shown to the producer per request; more are written so weak ones and repeats can be dropped. */
export const PITCHES_SHOWN = 3;
const PITCHES_WRITTEN = 6;

export function channelGuide(channel: Pick<Channel, "name" | "format" | "profile">): ChannelGuide {
  return { name: channel.name, format: channel.format, profile: parseProfile(channel.profile) };
}

/** Designs a channel from the producer's prompt and saves it, ready to edit. */
export async function createChannelFromBrief(input: { brief: string; deps: PipelineDeps }): Promise<Channel> {
  const [pricing, models, existing, voices] = await Promise.all([getPricing(), getModels(), db.channel.findMany({ select: { name: true } }), getVoices()]);
  const design = await generateStructured({
    client: input.deps.text,
    pricing,
    model: models.main,
    ...channelDesignPrompt({ brief: input.brief, existingNames: existing.map((c) => c.name) }),
    schema: ChannelDesignSchema,
    schemaName: "channel_design",
    validate: (v) => [
      ...(v.minParts < 1 || v.minParts > 5 ? ["minParts must be 1–5."] : []),
      ...(v.maxParts < v.minParts || v.maxParts > 6 ? ["maxParts must be between minParts and 6."] : []),
      ...(v.profile.examples.length < 3 ? ["Give at least three examples."] : []),
    ],
    cost: { ctx: {}, operation: "channel-design" },
  });
  return db.channel.create({
    data: {
      name: design.name.trim(),
      brief: input.brief,
      format: "PROCESS_EXPLAINER",
      profile: design.profile,
      minParts: design.minParts,
      maxParts: design.maxParts,
      voiceId: voices[0]?.id ?? null,
      styleKey: DEFAULT_STYLE,
    },
  });
}

/** Pitches ideas for a channel from the producer's idea (or "Surprise me") and keeps the best few for the producer to choose from. */
export async function runChannelIdeation(input: { batchId: string; jobId: string; deps: PipelineDeps }) {
  const batch = await db.batch.findUniqueOrThrow({ where: { id: input.batchId }, include: { channel: true } });
  const channel = batch.channel;
  if (!channel) throw new Error("This batch was made before channels and can't be run again. Start a new one from Generate.");
  const guide = channelGuide(channel);
  const [pricing, models] = await Promise.all([getPricing(), getModels()]);
  const cost: CostContext = { jobId: input.jobId, batchId: batch.id, budgetUsd: Number(batch.maxBudgetUsd), budgetScope: "batch" };

  // Retry safety: pitches already saved are kept.
  const saved = await db.concept.count({ where: { batchId: batch.id } });
  if (saved > 0) return { pitches: saved, shown: Math.min(saved, PITCHES_SHOWN), resumed: true };

  await setJobStage(input.jobId, "GENERATING_IDEAS", batch.customDirection ? "Pitching takes on your idea" : "Pitching fresh ideas", 0.05);
  const existing = await db.story.findMany({ where: { channelId: channel.id }, select: { title: true, premise: true, keywords: true }, orderBy: { createdAt: "desc" }, take: 300 });
  await assertWithinBudget(cost, 0.05);
  const { pitches } = await generateStructured({
    client: input.deps.text,
    pricing,
    model: models.main,
    ...pitchPrompt({
      channel: guide,
      idea: batch.customDirection,
      count: PITCHES_WRITTEN,
      avoidTitles: existing.slice(0, 150).map((s) => s.title),
      parts: [channel.minParts, channel.maxParts],
    }),
    schema: PitchBatchSchema,
    schemaName: "pitch_batch",
    validate: (v) => (v.pitches.length < PITCHES_WRITTEN - 1 ? [`Return ${PITCHES_WRITTEN} pitches (got ${v.pitches.length}).`] : []),
    cost: { ctx: cost, operation: "pitch" },
  });

  // A producer's own idea is meant to repeat itself across pitches; only Surprise me is checked against the channel's stories.
  const { unique, duplicates } = batch.customDirection ? { unique: pitches, duplicates: [] } : dedupeCandidates(pitches, existing);
  await assertNotCanceled(input.jobId);
  await setJobStage(input.jobId, "EVALUATING_CONCEPTS", "Choosing the strongest pitches", 0.6);
  const keep = Math.min(PITCHES_SHOWN, unique.length);
  const { picks } = await generateStructured({
    client: input.deps.text,
    pricing,
    model: models.reviewer?.trim() || models.main,
    ...pitchPickPrompt({ channel: guide, idea: batch.customDirection, pitches: unique, keep }),
    schema: PitchPickSchema,
    schemaName: "pitch_pick",
    validate: (v) => {
      const ids = v.picks.map((p) => p.index);
      return [
        ...(ids.length !== keep ? [`Choose exactly ${keep}.`] : []),
        ...(ids.some((i) => i < 0 || i >= unique.length) ? [`Indexes must be 0–${unique.length - 1}.`] : []),
        ...(new Set(ids).size !== ids.length ? ["Choose each pitch once."] : []),
      ];
    },
    cost: { ctx: cost, operation: "pitch-pick" },
  });

  const rows = [
    ...picks.map((p, rank) => ({ pitch: unique[p.index], status: "CANDIDATE" as const, rank: rank + 1, reason: p.reason })),
    ...unique.filter((_, i) => !picks.some((p) => p.index === i)).map((pitch) => ({ pitch, status: "REJECTED" as const, rank: null, reason: null })),
  ];
  await db.concept.createMany({
    data: [
      ...rows.map((r) => ({
        batchId: batch.id,
        title: r.pitch.title,
        normalizedTitle: normalizeTitle(r.pitch.title),
        premise: r.pitch.premise,
        logline: r.pitch.openingSituation ? `${r.pitch.logline} Opening: ${r.pitch.openingSituation}` : r.pitch.logline,
        keywords: r.pitch.keywords.map((k) => k.toLowerCase()),
        seriesPotential: r.pitch.arc,
        storySeed: { beatSketch: r.pitch.arc },
        scores: r.reason ? { summary: r.reason } : undefined,
        rank: r.rank,
        status: r.status,
      })),
      ...duplicates.map((d) => ({
        batchId: batch.id,
        title: d.candidate.title,
        normalizedTitle: normalizeTitle(d.candidate.title),
        premise: d.candidate.premise,
        logline: d.candidate.logline,
        keywords: d.candidate.keywords,
        seriesPotential: d.candidate.arc,
        status: "DUPLICATE" as const,
        duplicateOfTitle: d.duplicateOf.title,
        similarity: d.score,
      })),
    ],
  });
  return { pitches: pitches.length, shown: keep, duplicates: duplicates.length, resumed: false };
}

/** Turns a chosen pitch into a story of its channel, with Part 1 ready to write. */
export async function storyFromPitch(conceptId: string): Promise<Story & { episodes: { id: string }[] }> {
  const concept = await db.concept.findUniqueOrThrow({ where: { id: conceptId }, include: { batch: { include: { channel: true } }, story: { include: { episodes: true } } } });
  if (concept.story) return concept.story;
  const channel = concept.batch.channel;
  if (!channel) throw new Error("This pitch was made before channels.");
  const story = await db.story.create({
    data: {
      title: concept.title,
      normalizedTitle: concept.normalizedTitle,
      premise: concept.premise,
      logline: concept.logline,
      storySeed: concept.storySeed ?? undefined,
      keywords: concept.keywords,
      styleKey: channel.styleKey,
      voiceId: channel.voiceId ?? concept.batch.voiceId,
      channelId: channel.id,
      targetDurationSec: channel.targetDurationSec,
      // The planner picks the real count within the channel's range when it writes Part 1.
      plannedParts: channel.maxParts,
      quality: channel.quality,
      conceptId: concept.id,
      episodes: { create: { partNumber: 1, title: concept.title } },
    },
    include: { episodes: true },
  });
  await db.concept.update({ where: { id: conceptId }, data: { status: "SELECTED" } });
  return story;
}
