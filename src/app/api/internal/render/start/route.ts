import path from "node:path";
import { z } from "zod";
import { addBundleToSandbox, createSandbox, renderMediaOnVercel } from "@remotion/vercel";
import { authorizeInternal } from "@/lib/render/auth";
import { env, requireEnv } from "@/lib/env";
import { VIDEO } from "@/lib/constants";
import { EpisodePropsSchema } from "@/remotion/schema";

// Creating the sandbox (system deps + Chromium) takes a minute or two. The render itself runs
// detached inside the sandbox; this handler returns as soon as it has started.
// 300s is the Hobby-plan ceiling.
export const maxDuration = 300;

const Body = z.object({ inputProps: EpisodePropsSchema, blobPath: z.string().min(1).max(500) });

export async function POST(request: Request) {
  const denied = authorizeInternal(request);
  if (denied) return denied;

  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid body", issues: parsed.error.issues }, { status: 400 });

  const sandbox = await createSandbox({ resources: { vcpus: env().RENDER_SANDBOX_VCPUS } });
  try {
    // addBundleToSandbox creates remotion-bundle/<subdirs> but not remotion-bundle itself, and
    // @vercel/sandbox 1.x mkDir is not recursive.
    await sandbox.mkDir("remotion-bundle");
    await addBundleToSandbox({ sandbox, bundleDir: path.join(process.cwd(), "remotion-bundle") });
    const { sandboxId, cmdId } = await renderMediaOnVercel({
      sandbox,
      compositionId: VIDEO.compositionId,
      inputProps: parsed.data.inputProps,
      codec: "h264",
      audioCodec: "aac",
      crf: 20,
      detached: true,
      detachedSandboxTimeoutInMilliseconds: 40 * 60 * 1000,
      vercelBlob: { blobToken: requireEnv("BLOB_READ_WRITE_TOKEN", "uploading renders"), access: "public", blobPath: parsed.data.blobPath },
    });
    return Response.json({ sandboxId, cmdId });
  } catch (err) {
    await sandbox.stop().catch(() => {});
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
