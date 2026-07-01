import type { NextConfig } from "next";

// Mobile build (Capacitor) needs static export.
// Vercel deployment needs server-side rendering for API routes.
// Use NEXT_BUILD_TARGET=mobile to build for Capacitor.
const isMobileBuild = process.env.NEXT_BUILD_TARGET === "mobile";

const nextConfig: NextConfig = {
  ...(isMobileBuild
    ? {
        output: "export",
        trailingSlash: true,
        images: { unoptimized: true },
      }
    : {
        // Vercel: full server-side, API routes work normally
        images: { unoptimized: true },
      }),
};

export default nextConfig;
