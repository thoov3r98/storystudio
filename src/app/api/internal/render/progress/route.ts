import { z } from "zod";
import { getRenderProgress } from "@remotion/vercel";
import { authorizeInternal } from "@/lib/render/auth";

const Body = z.object({ sandboxId: z.string().min(1), cmdId: z.string().min(1) });

export async function POST(request: Request) {
  const denied = authorizeInternal(request);
  if (denied) return denied;
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid body" }, { status: 400 });
  return Response.json(await getRenderProgress(parsed.data));
}
