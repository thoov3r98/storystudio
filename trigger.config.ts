import { defineConfig } from "@trigger.dev/sdk";
import { prismaExtension } from "@trigger.dev/build/extensions/prisma";

export default defineConfig({
  // Set TRIGGER_PROJECT_REF (e.g. "proj_abc123") from your Trigger.dev project settings.
  project: process.env.TRIGGER_PROJECT_REF ?? "proj_REPLACE_ME",
  runtime: "node",
  dirs: ["./src/trigger"],
  maxDuration: 3600,
  retries: {
    enabledInDev: false,
    default: { maxAttempts: 3, minTimeoutInMs: 2_000, maxTimeoutInMs: 30_000, factor: 2, randomize: true },
  },
  build: {
    // Rendering happens in Vercel Sandbox (or locally in dev), never inside the Trigger.dev worker,
    // so the Remotion renderer/bundler stay out of the deployed task bundle.
    external: ["@remotion/bundler", "@remotion/renderer"],
    extensions: [prismaExtension({ mode: "modern" })],
  },
});
