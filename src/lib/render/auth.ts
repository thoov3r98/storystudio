import { timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";

/**
 * Internal render routes are called by Trigger.dev, not by the browser.
 * Vercel Deployment Protection does not authenticate machine callers, so every
 * request must carry `Authorization: Bearer <RENDER_API_SECRET>`.
 */
export function authorizeInternal(request: Request): Response | null {
  const secret = env().RENDER_API_SECRET;
  if (!secret || secret.length < 32) {
    return Response.json({ error: "RENDER_API_SECRET is not configured (min 32 chars)." }, { status: 503 });
  }
  const header = request.headers.get("authorization") ?? "";
  const given = Buffer.from(header.startsWith("Bearer ") ? header.slice(7) : "");
  const expected = Buffer.from(secret);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}
