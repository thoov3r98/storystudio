import { z } from "zod";
import { Sandbox } from "@vercel/sandbox";
import { authorizeInternal } from "@/lib/render/auth";

const Body = z.object({ sandboxId: z.string().min(1) });

export async function POST(request: Request) {
  const denied = authorizeInternal(request);
  if (denied) return denied;
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid body" }, { status: 400 });
  try {
    const sandbox = await Sandbox.get({ sandboxId: parsed.data.sandboxId });
    await sandbox.stop();
  } catch {
    // Already stopped or expired.
  }
  return Response.json({ ok: true });
}
