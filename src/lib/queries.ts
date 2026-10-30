import "server-only";
import { connection } from "next/server";
import { db } from "@/lib/db";
import { ACTIVE_JOB_STATUSES } from "@/lib/constants";
import type { Prisma } from "@/generated/prisma/client";
import type { StoryStatus } from "@/generated/prisma/enums";
import { computeStaleness, type RenderInputs } from "@/lib/invalidation";

/*
 * Every query starts with connection(): all data here is live, per-request
 * production state and must never be prerendered or cached.
 */

export async function getDashboard() {
  await connection();
  const [stories, openingEpisodes, completedVideos, activeJobs, failedJobs, spend, recentStories, recentRenders, scriptsToReview] = await Promise.all([
    db.story.count(),
    db.episode.count({ where: { partNumber: 1 } }),
    db.render.count({ where: { status: "SUCCEEDED" } }),
    db.job.count({ where: { status: { in: ACTIVE_JOB_STATUSES } } }),
    db.job.count({ where: { status: "FAILED" } }),
    db.costEntry.aggregate({ _sum: { costUsd: true } }),
    db.story.findMany({ where: { status: { not: "ARCHIVED" } }, orderBy: { lastActivityAt: "desc" }, take: 6, include: { _count: { select: { episodes: true } }, channel: { select: { name: true } } } }),
    db.render.findMany({
      where: { status: "SUCCEEDED" },
      orderBy: { completedAt: "desc" },
      take: 6,
      include: { episodeVersion: { include: { episode: { include: { story: { select: { id: true, title: true, thumbnailUrl: true } } } } } } },
    }),
    // Scripts waiting at the gate, so nothing sits unreviewed.
    db.episode.findMany({
      where: { status: "SCRIPTED", currentVersionId: { not: null }, story: { status: { not: "ARCHIVED" } } },
      orderBy: { updatedAt: "desc" },
      take: 20,
      select: { id: true, title: true, partNumber: true, updatedAt: true, story: { select: { title: true } }, currentVersion: { select: { summary: true } } },
    }),
  ]);
  return {
    stats: { stories, openingEpisodes, completedVideos, activeJobs, failedJobs, spendUsd: Number(spend._sum.costUsd ?? 0) },
    recentStories,
    recentRenders,
    scriptsToReview,
  };
}

export const STORY_FILTERS: { value: string; label: string; where: Prisma.StoryWhereInput }[] = [
  { value: "all", label: "All", where: { status: { not: "ARCHIVED" } } },
  { value: "concepts", label: "Concepts", where: { status: "CONCEPT" } },
  { value: "in-production", label: "In production", where: { status: "IN_PRODUCTION" } },
  { value: "ready", label: "Ready", where: { status: "READY" } },
  { value: "published", label: "Published manually", where: { status: "PUBLISHED" } },
  { value: "continuing", label: "Continuing", where: { status: "CONTINUING" } },
  { value: "archived", label: "Archived", where: { status: "ARCHIVED" } },
];

export async function listStories(params: { filter?: string; q?: string; channel?: string }) {
  await connection();
  const filter = STORY_FILTERS.find((f) => f.value === params.filter) ?? STORY_FILTERS[0];
  const q = params.q?.trim();
  const where: Prisma.StoryWhereInput = {
    AND: [
      filter.where,
      params.channel && params.channel !== "all" ? (params.channel === "none" ? { channelId: null } : { channelId: params.channel }) : {},
      q
        ? {
            OR: [
              { title: { contains: q, mode: "insensitive" } },
              { premise: { contains: q, mode: "insensitive" } },
              { keywords: { has: q.toLowerCase() } },
            ],
          }
        : {},
    ],
  };
  return db.story.findMany({
    where,
    orderBy: { lastActivityAt: "desc" },
    take: 200,
    include: { _count: { select: { episodes: true } }, channel: { select: { name: true } } },
  });
}

export async function getStory(storyId: string) {
  await connection();
  const story = await db.story.findUnique({
    where: { id: storyId },
    include: {
      channel: { select: { id: true, name: true, format: true } },
      episodes: {
        orderBy: { partNumber: "asc" },
        include: {
          currentVersion: {
            include: {
              renders: { where: { status: "SUCCEEDED" }, orderBy: { createdAt: "desc" }, take: 1 },
            },
          },
          metrics: { orderBy: { recordedAt: "desc" } },
          jobs: { where: { status: { in: ACTIVE_JOB_STATUSES } }, select: { id: true, status: true, stage: true, progress: true } },
        },
      },
      concept: true,
    },
  });
  if (!story) return null;
  const costs = await db.costEntry.groupBy({ by: ["provider"], where: { storyId }, _sum: { costUsd: true } });
  return { story, costs: costs.map((c) => ({ provider: c.provider, usd: Number(c._sum.costUsd ?? 0) })) };
}

export async function getEpisode(episodeId: string) {
  await connection();
  const episode = await db.episode.findUnique({
    where: { id: episodeId },
    include: {
      story: { include: { episodes: { orderBy: { partNumber: "asc" }, select: { id: true, partNumber: true, status: true } } } },
      versions: { orderBy: { version: "desc" }, select: { id: true, version: true, status: true, reason: true, createdAt: true } },
      currentVersion: {
        include: {
          scenes: {
            orderBy: { sceneNumber: "asc" },
            include: { currentImage: true, images: { orderBy: { version: "desc" }, take: 8 } },
          },
          voiceover: true,
          voiceovers: { orderBy: { version: "desc" }, take: 5 },
          renders: { orderBy: { createdAt: "desc" }, take: 10 },
        },
      },
      jobs: { orderBy: { createdAt: "desc" }, take: 10 },
    },
  });
  if (!episode) return null;
  const v = episode.currentVersion;
  const latestRender = v?.renders.find((r) => r.status === "SUCCEEDED") ?? null;
  const staleness = v
    ? computeStaleness({
        scenes: v.scenes.map((s) => ({ sceneNumber: s.sceneNumber, currentImageId: s.currentImage?.status === "SUCCEEDED" ? s.currentImageId : null })),
        voiceoverId: v.voiceover?.status === "SUCCEEDED" ? v.voiceoverId : null,
        hasTiming: Boolean(v.timing),
        latestSucceededRender: latestRender ? { inputs: latestRender.inputs as RenderInputs } : null,
      })
    : null;
  const cost = await db.costEntry.aggregate({ where: { episodeId }, _sum: { costUsd: true } });
  return { episode, latestRender, staleness, costUsd: Number(cost._sum.costUsd ?? 0) };
}

export async function listJobs(params: { status?: string }) {
  await connection();
  const where: Prisma.JobWhereInput =
    params.status === "active" ? { status: { in: ACTIVE_JOB_STATUSES } } : params.status === "failed" ? { status: "FAILED" } : {};
  const jobs = await db.job.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 200,
    include: {
      story: { select: { id: true, title: true } },
      episode: { select: { id: true, partNumber: true, title: true } },
      batch: { select: { id: true, requestedCount: true } },
    },
  });
  const costs = await db.costEntry.groupBy({ by: ["jobId"], where: { jobId: { in: jobs.map((j) => j.id) } }, _sum: { costUsd: true } });
  const costByJob = new Map(costs.map((c) => [c.jobId, Number(c._sum.costUsd ?? 0)]));
  return jobs.map((j) => ({ ...j, costUsd: costByJob.get(j.id) ?? 0 }));
}

export async function getBatch(batchId: string) {
  await connection();
  const batch = await db.batch.findUnique({
    where: { id: batchId },
    include: {
      concepts: { orderBy: [{ rank: "asc" }, { createdAt: "asc" }], include: { story: { include: { episodes: { where: { partNumber: 1 }, select: { id: true, status: true } } } } } },
      jobs: { orderBy: { createdAt: "desc" } },
      channel: { select: { id: true, name: true, format: true } },
    },
  });
  if (!batch) return null;
  const spend = await db.costEntry.aggregate({ where: { batchId }, _sum: { costUsd: true } });
  return { batch, spentUsd: Number(spend._sum.costUsd ?? 0) };
}

export async function storyStatusCounts() {
  await connection();
  const rows = await db.story.groupBy({ by: ["status"], _count: true });
  return Object.fromEntries(rows.map((r) => [r.status, r._count])) as Partial<Record<StoryStatus, number>>;
}

export async function listChannels(params: { archived?: boolean } = {}) {
  await connection();
  return db.channel.findMany({
    where: { archivedAt: params.archived ? { not: null } : null },
    orderBy: { createdAt: "asc" },
    include: { _count: { select: { stories: { where: { archivedAt: null } } } } },
  });
}

export async function getChannel(channelId: string) {
  await connection();
  return db.channel.findUnique({
    where: { id: channelId },
    include: {
      stories: { where: { archivedAt: null }, orderBy: { lastActivityAt: "desc" }, take: 30, include: { _count: { select: { episodes: true } } } },
      batches: { orderBy: { createdAt: "desc" }, take: 8, include: { _count: { select: { concepts: true } } } },
    },
  });
}

/** Topic Research: the reference library (filtered) and recent proposals with their evidence. */
export async function getTopicResearch(params: { platform?: string; category?: string; q?: string }) {
  await connection();
  const q = params.q?.trim();
  const where: Prisma.ManufacturingContentReferenceWhereInput = {
    AND: [
      params.platform && params.platform !== "all" ? { platform: params.platform } : {},
      params.category && params.category !== "all" ? { category: params.category } : {},
      q ? { OR: [{ product: { contains: q, mode: "insensitive" } }, { title: { contains: q, mode: "insensitive" } }, { creator: { contains: q, mode: "insensitive" } }] } : {},
    ],
  };
  const [references, categories, total, candidates, activeJob, channels] = await Promise.all([
    db.manufacturingContentReference.findMany({ where, orderBy: { updatedAt: "desc" }, include: { metrics: { orderBy: { observedAt: "desc" } } } }),
    db.manufacturingContentReference.findMany({ distinct: ["category"], select: { category: true }, orderBy: { category: "asc" } }),
    db.manufacturingContentReference.count(),
    db.manufacturingTopicCandidate.findMany({
      where: { batchId: null },
      orderBy: [{ createdAt: "desc" }],
      take: 60,
      include: { evidence: { include: { reference: { include: { metrics: true } } } }, concept: { select: { story: { select: { id: true } } } } },
    }),
    db.job.findFirst({ where: { type: "TOPIC_DISCOVERY" }, orderBy: { createdAt: "desc" } }),
    db.channel.findMany({ where: { archivedAt: null }, orderBy: { createdAt: "asc" }, select: { id: true, name: true } }),
  ]);
  return { references, categories: categories.map((c) => c.category), total, candidates, activeJob, channels };
}

/** A story's storytelling decision and every hook written for it. */
export async function getStorytelling(storyId: string) {
  await connection();
  const [decision, hooks] = await Promise.all([
    db.manufacturingStorytellingDecision.findUnique({ where: { storyId } }),
    db.manufacturingHookCandidate.findMany({ where: { storyId }, orderBy: [{ createdAt: "desc" }, { rank: "asc" }] }),
  ]);
  return { decision, hooks };
}
