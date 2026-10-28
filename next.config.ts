import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  serverExternalPackages: ["@remotion/vercel", "@remotion/bundler", "@remotion/renderer", "@vercel/sandbox", "@prisma/client"],
  // The prebuilt Remotion bundle (pnpm remotion:bundle) is uploaded into the render sandbox.
  outputFileTracingIncludes: {
    "/api/internal/render/start": ["./remotion-bundle/**/*"],
  },
  images: {
    remotePatterns: [{ protocol: "https", hostname: "*.public.blob.vercel-storage.com" }],
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
