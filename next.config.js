/**
 * Run `build` or `dev` with `SKIP_ENV_VALIDATION` to skip env validation. This is especially useful
 * for Docker builds.
 */
import "./src/env.js";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

/** @type {import("next").NextConfig} */
const config = {
  // Allow an alternate build output dir (set by the production-start e2e config)
  // so its non-test bundle never overwrites the TEST_MODE `.next` build. Defaults
  // to Next's standard `.next` when unset.
  ...(process.env.NEXT_DIST_DIR ? { distDir: process.env.NEXT_DIST_DIR } : {}),
  // Pin the file-tracing root to this app dir. A stray pnpm-lock.yaml in a
  // parent dir otherwise makes Next infer the wrong workspace root, which
  // breaks OpenNext's asset/server tracing.
  outputFileTracingRoot: dirname(fileURLToPath(import.meta.url)),
};

export default config;

// Enables Cloudflare bindings (getCloudflareContext) during local `next dev`.
// Harmless in production builds.
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
initOpenNextCloudflareForDev();
