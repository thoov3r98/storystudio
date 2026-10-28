import { put } from "@vercel/blob";
import { requireEnv } from "@/lib/env";

/**
 * Asset storage on Vercel Blob. Blobs use public access with random suffixes
 * so the Remotion renderer inside Vercel Sandbox can fetch them without
 * credentials; URLs are unguessable but not secret. See README "Security".
 */
export async function uploadAsset(pathname: string, body: Buffer | Uint8Array | Blob, contentType: string) {
  const token = requireEnv("BLOB_READ_WRITE_TOKEN", "storing generated images, audio and video");
  const result = await put(pathname, body instanceof Uint8Array && !(body instanceof Buffer) ? Buffer.from(body) : body, {
    access: "public",
    contentType,
    addRandomSuffix: true,
    token,
  });
  return { url: result.url, pathname: result.pathname, downloadUrl: result.downloadUrl };
}

export async function fetchAsset(url: string, timeoutMs = 60_000): Promise<Buffer> {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`Failed to fetch asset ${url}: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

export const paths = {
  sceneImage: (storyId: string, episodeId: string, sceneNumber: number, version: number) =>
    `stories/${storyId}/episodes/${episodeId}/scenes/${String(sceneNumber).padStart(2, "0")}-v${version}.png`,
  voiceover: (storyId: string, episodeId: string, version: number) => `stories/${storyId}/episodes/${episodeId}/voiceover-v${version}.mp3`,
  render: (storyId: string, episodeId: string, version: number) => `stories/${storyId}/episodes/${episodeId}/render-v${version}.mp4`,
};
