import type { NextConfig } from "next";
import { fileURLToPath } from "node:url";

// Published as static files. On GitHub Pages the site lives under /strata;
// set BASE_PATH="" when it moves to its own domain.
const basePath = process.env.BASE_PATH ?? "/strata";

const nextConfig: NextConfig = {
  output: "export",
  basePath: basePath || undefined,
  trailingSlash: true,
  images: { unoptimized: true },
  // The app at the repo root has its own lockfile; this site is a separate project.
  turbopack: { root: fileURLToPath(new URL(".", import.meta.url)) },
  env: { NEXT_PUBLIC_BASE_PATH: basePath },
};

export default nextConfig;
