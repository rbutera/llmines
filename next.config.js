/**
 * Run `build` or `dev` with `SKIP_ENV_VALIDATION` to skip env validation. This is especially useful
 * for Docker builds.
 */
import "./src/env.js";

/** @type {import("next").NextConfig} */
const config = {
  // Allow an alternate build output dir (set by the production-start e2e config)
  // so its non-test bundle never overwrites the TEST_MODE `.next` build. Defaults
  // to Next's standard `.next` when unset.
  ...(process.env.NEXT_DIST_DIR ? { distDir: process.env.NEXT_DIST_DIR } : {}),
};

export default config;
