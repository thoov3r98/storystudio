import { z } from "zod";
import { env, requireEnv } from "@/lib/env";
import { VIDEO } from "@/lib/constants";
import type { EpisodeProps } from "@/remotion/schema";

/*
 * Render providers.
 *
 * vercel-sandbox (production): Trigger.dev calls a secret-authenticated route
 * on the Vercel deployment. That route (which has Vercel OIDC credentials)
 * creates a Sandbox, uploads the prebuilt Remotion bundle and starts a
 * DETACHED render that uploads the MP4 to Vercel Blob itself. The route
 * returns immediately; Trigger.dev polls progress. No video is rendered inside
 * a request handler.
 *
 * local (development): renders with @remotion/renderer on the machine running
 * the Trigger.dev dev worker. Real rendering, not a mock.
 */

export type RenderProgressUpdate = { progress: number; stage: string };
export type RenderOutcome = { url: string; sizeBytes: number; sandboxId?: string; commandId?: string; renderSeconds: number };

export interface RenderClient {
  render(args: { props: EpisodeProps; blobPath: string; onProgress: (u: RenderProgressUpdate) => Promise<void>; onStarted?: (ids: { sandboxId: string; commandId: string }) => Promise<void> }): Promise<RenderOutcome>;
}

const StartResponse = z.object({ sandboxId: z.string(), cmdId: z.string() });
const ProgressResponse = z.discriminatedUnion("stage", [
  z.object({ stage: z.literal("starting"), overallProgress: z.number() }),
  z.object({ stage: z.literal("opening-browser"), overallProgress: z.number() }),
  z.object({ stage: z.literal("selecting-composition"), overallProgress: z.number() }),
  z.object({ stage: z.literal("render-progress"), overallProgress: z.number() }).passthrough(),
  z.object({ stage: z.literal("uploading"), overallProgress: z.number() }),
  z.object({ stage: z.literal("done"), url: z.string(), size: z.number(), overallProgress: z.number() }).passthrough(),
  z.object({ stage: z.literal("error"), message: z.string() }).passthrough(),
  z.object({ stage: z.literal("expired") }),
]);

function internalHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    authorization: `Bearer ${requireEnv("RENDER_API_SECRET", "authenticating render requests")}`,
  };
  const bypass = env().VERCEL_AUTOMATION_BYPASS_SECRET;
  if (bypass) headers["x-vercel-protection-bypass"] = bypass;
  return headers;
}

async function callInternal(path: string, body: unknown, timeoutMs: number) {
  const base = requireEnv("STUDIO_APP_URL", "reaching the render endpoint").replace(/\/$/, "");
  const res = await fetch(`${base}${path}`, { method: "POST", headers: internalHeaders(), body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
  const text = await res.text();
  if (!res.ok) throw new Error(`Render endpoint ${path} returned ${res.status}: ${text.slice(0, 500)}`);
  return JSON.parse(text) as unknown;
}

export const sandboxRenderClient: RenderClient = {
  async render({ props, blobPath, onProgress, onStarted }) {
    const started = Date.now();
    await onProgress({ progress: 0.02, stage: "Creating render sandbox" });
    const { sandboxId, cmdId } = StartResponse.parse(await callInternal("/api/internal/render/start", { inputProps: props, blobPath }, 14 * 60_000));
    await onStarted?.({ sandboxId, commandId: cmdId });

    const deadline = Date.now() + 40 * 60_000;
    let failuresInARow = 0;
    try {
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 5000));
        let progress: z.infer<typeof ProgressResponse>;
        try {
          progress = ProgressResponse.parse(await callInternal("/api/internal/render/progress", { sandboxId, cmdId }, 60_000));
          failuresInARow = 0;
        } catch (err) {
          if (++failuresInARow >= 6) throw err;
          continue;
        }
        switch (progress.stage) {
          case "done":
            return { url: progress.url, sizeBytes: progress.size, sandboxId, commandId: cmdId, renderSeconds: (Date.now() - started) / 1000 };
          case "error":
            throw new Error(`Render failed in sandbox: ${progress.message}`);
          case "expired":
            throw new Error("The render sandbox expired before the render finished.");
          case "uploading":
            await onProgress({ progress: 0.97, stage: "Uploading MP4" });
            break;
          default:
            await onProgress({ progress: 0.05 + 0.9 * progress.overallProgress, stage: progress.stage === "render-progress" ? "Rendering frames" : progress.stage });
        }
      }
      throw new Error("Render timed out after 40 minutes.");
    } finally {
      await callInternal("/api/internal/render/stop", { sandboxId }, 60_000).catch(() => {});
    }
  },
};

export const localRenderClient: RenderClient = {
  async render({ props, blobPath, onProgress }) {
    const started = Date.now();
    const path = await import("node:path");
    const os = await import("node:os");
    const fs = await import("node:fs/promises");
    // Kept as runtime imports so production bundles never load the local renderer.
    const bundler = "@remotion/bundler";
    const renderer = "@remotion/renderer";
    const { bundle } = (await import(/* webpackIgnore: true */ bundler)) as typeof import("@remotion/bundler");
    const { renderMedia, selectComposition } = (await import(/* webpackIgnore: true */ renderer)) as typeof import("@remotion/renderer");
    const { uploadAsset } = await import("@/lib/storage");

    await onProgress({ progress: 0.02, stage: "Bundling composition" });
    const prebuilt = path.join(process.cwd(), "remotion-bundle");
    const serveUrl = await fs
      .access(path.join(prebuilt, "index.html"))
      .then(() => prebuilt)
      .catch(() => bundle({ entryPoint: path.join(process.cwd(), "src/remotion/index.ts") }));
    // Remotion downloads its own headless browser; REMOTION_BROWSER_EXECUTABLE overrides it on machines where that build fails.
    const browserExecutable = process.env.REMOTION_BROWSER_EXECUTABLE || null;
    const composition = await selectComposition({ serveUrl, id: VIDEO.compositionId, inputProps: props, browserExecutable });
    const out = path.join(os.tmpdir(), `iws-${Date.now()}.mp4`);
    await renderMedia({
      composition,
      serveUrl,
      codec: "h264",
      audioCodec: "aac",
      outputLocation: out,
      inputProps: props,
      browserExecutable,
      onProgress: ({ progress }) => void onProgress({ progress: 0.05 + 0.85 * progress, stage: "Rendering frames" }),
    });
    await onProgress({ progress: 0.95, stage: "Uploading MP4" });
    const file = await fs.readFile(out);
    const uploaded = await uploadAsset(blobPath, file, "video/mp4");
    await fs.rm(out, { force: true });
    return { url: uploaded.url, sizeBytes: file.length, renderSeconds: (Date.now() - started) / 1000 };
  },
};

export function renderClient(): RenderClient {
  return env().RENDER_PROVIDER === "local" ? localRenderClient : sandboxRenderClient;
}
