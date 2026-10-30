import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { normalizeTitle } from "@/lib/text";
import { MetricInputSchema, type MetricInput, ReferenceInputSchema, type ReferenceInput, type Platform } from "@/lib/schemas/topics";
import { STARTER_REFERENCES } from "./starter-references";

/*
 * The reference library: successful manufacturing videos by others, kept as
 * evidence of audience interest. Details come from the producer or from the
 * platforms' official endpoints (oEmbed, YouTube Data API). Nothing is scraped,
 * and a number nobody observed is stored as null, never guessed.
 */

export async function createReference(input: ReferenceInput) {
  const data = ReferenceInputSchema.parse(input);
  return db.manufacturingContentReference.create({
    data: { ...data, normalizedProduct: normalizeTitle(data.product), verification: data.url ? "USER_ENTERED" : "NEEDS_SOURCE" },
  });
}

/** Editing a confirmed reference's URL un-confirms it. */
export async function updateReference(id: string, input: ReferenceInput) {
  const data = ReferenceInputSchema.parse(input);
  const current = await db.manufacturingContentReference.findUniqueOrThrow({ where: { id } });
  const verification = !data.url ? "NEEDS_SOURCE" : data.url === current.url && current.verification === "SOURCE_CONFIRMED" ? "SOURCE_CONFIRMED" : "USER_ENTERED";
  return db.manufacturingContentReference.update({ where: { id }, data: { ...data, normalizedProduct: normalizeTitle(data.product), verification } });
}

export async function deleteReference(id: string) {
  await db.manufacturingContentReference.delete({ where: { id } });
}

/** Records numbers the producer saw on the platform, dated, as unverified. */
export async function addMetricObservation(referenceId: string, input: MetricInput) {
  const data = MetricInputSchema.parse(input);
  return db.referenceMetricObservation.create({ data: { referenceId, ...data, source: "MANUAL" } });
}

export async function deleteMetricObservation(id: string) {
  await db.referenceMetricObservation.delete({ where: { id } });
}

export async function getReference(id: string) {
  return db.manufacturingContentReference.findUnique({ where: { id }, include: { metrics: { orderBy: { observedAt: "desc" } } } });
}

/** Adds the curated starter set. Skips any already in the library. */
export async function addStarterReferences() {
  let added = 0;
  for (const s of STARTER_REFERENCES) {
    const exists = await db.manufacturingContentReference.findFirst({ where: s.url ? { url: s.url } : { title: s.title, creator: s.creator } });
    if (exists) continue;
    await db.manufacturingContentReference.create({ data: { ...s, normalizedProduct: normalizeTitle(s.product) } });
    added++;
  }
  return added;
}

// ── Metadata import (official endpoints only) ─────────────────────────

export function detectPlatform(url: string): Platform {
  const host = new URL(url).hostname.replace(/^www\./, "");
  if (host === "youtu.be" || host.endsWith("youtube.com")) return "youtube";
  if (host.endsWith("tiktok.com")) return "tiktok";
  if (host.endsWith("instagram.com")) return "instagram";
  return "other";
}

export function youtubeId(url: string): string | null {
  const u = new URL(url);
  if (u.hostname === "youtu.be") return u.pathname.slice(1) || null;
  if (u.searchParams.get("v")) return u.searchParams.get("v");
  const m = /\/(shorts|embed|live)\/([\w-]{6,})/.exec(u.pathname);
  return m?.[2] ?? null;
}

const OEMBED: Partial<Record<Platform, string>> = {
  youtube: "https://www.youtube.com/oembed?format=json&url=",
  tiktok: "https://www.tiktok.com/oembed?url=",
};

export type ImportedMetadata = {
  platform: Platform;
  title: string | null;
  creator: string | null;
  publishedAt: string | null;
  durationSec: number | null;
  /** Only from an API that reports them; never inferred. */
  metrics: { views: number | null; likes: number | null; comments: number | null } | null;
  method: string;
};

/** ISO 8601 duration (PT1H2M3S) to seconds. */
export function isoDurationSec(d: string): number | null {
  const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(d);
  return m ? Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0) : null;
}

const num = (v: unknown) => (typeof v === "string" && /^\d+$/.test(v) ? Number(v) : null);

/**
 * Reads public details for a video URL from the platform's official oEmbed
 * endpoint, and from the YouTube Data API when YOUTUBE_API_KEY is set (the
 * only source of verified view counts). Returns null when nothing is supported.
 */
export async function fetchVideoMetadata(url: string, fetcher: typeof fetch = fetch): Promise<ImportedMetadata | null> {
  const platform = detectPlatform(url);
  const key = env().YOUTUBE_API_KEY;
  const id = platform === "youtube" ? youtubeId(url) : null;
  if (id && key) {
    const res = await fetcher(`https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics,contentDetails&id=${encodeURIComponent(id)}&key=${key}`);
    if (res.ok) {
      const item = ((await res.json()) as { items?: { snippet?: { title?: string; channelTitle?: string; publishedAt?: string }; statistics?: Record<string, string>; contentDetails?: { duration?: string } }[] }).items?.[0];
      if (item) {
        const s = item.statistics ?? {};
        return {
          platform,
          title: item.snippet?.title ?? null,
          creator: item.snippet?.channelTitle ?? null,
          publishedAt: item.snippet?.publishedAt ?? null,
          durationSec: item.contentDetails?.duration ? isoDurationSec(item.contentDetails.duration) : null,
          metrics: { views: num(s.viewCount), likes: num(s.likeCount), comments: num(s.commentCount) },
          method: "YouTube Data API",
        };
      }
    }
  }
  const endpoint = OEMBED[platform];
  if (!endpoint) return null;
  const res = await fetcher(`${endpoint}${encodeURIComponent(url)}`);
  if (!res.ok) return null;
  const body = (await res.json()) as { title?: string; author_name?: string };
  return { platform, title: body.title ?? null, creator: body.author_name ?? null, publishedAt: null, durationSec: null, metrics: null, method: `${platform === "youtube" ? "YouTube" : "TikTok"} oEmbed` };
}

/**
 * Refreshes a saved reference from its platform: title and creator confirm the
 * source, and API-reported numbers are stored as a verified, dated observation.
 */
export async function importReferenceMetadata(id: string, fetcher: typeof fetch = fetch) {
  const ref = await db.manufacturingContentReference.findUniqueOrThrow({ where: { id } });
  if (!ref.url) throw new Error("Add the video's URL first.");
  const meta = await fetchVideoMetadata(ref.url, fetcher);
  if (!meta || (!meta.title && !meta.creator)) throw new Error("No supported way to read this video's details. Enter them by hand.");
  await db.manufacturingContentReference.update({
    where: { id },
    data: {
      title: meta.title ?? ref.title,
      creator: meta.creator ?? ref.creator,
      publishedAt: meta.publishedAt ? new Date(meta.publishedAt) : ref.publishedAt,
      durationSec: meta.durationSec ?? ref.durationSec,
      verification: "SOURCE_CONFIRMED",
    },
  });
  const m = meta.metrics;
  if (m && [m.views, m.likes, m.comments].some((x) => x !== null)) {
    await db.referenceMetricObservation.create({ data: { referenceId: id, ...m, shares: null, observedAt: new Date(), source: "YOUTUBE_API", note: meta.method } });
  }
  return meta;
}
