import { defineConfig, devices } from "@playwright/test";

/**
 * PRODUCTION-START e2e config. Runs e2e/production-start.spec.ts against the REAL
 * production bundle (no NEXT_PUBLIC_TEST_MODE) so the actual Start-button flow
 * executes end to end. It builds into a SEPARATE output dir (`.next-prod` via
 * NEXT_DIST_DIR) so it never clobbers the TEST_MODE `.next` build used by the
 * default config. Kept in its own config (not a second project on the main one)
 * for exactly that build-isolation reason.
 */
const PORT = 3101;
const DIST = ".next-prod";

export default defineConfig({
  testDir: "./e2e",
  // production-start guard + the v2.7 audio-structure probe proof both need the
  // REAL production bundle (audio enabled, no TEST_MODE).
  testMatch: /(production-start|audio-structure|wrap-stall)\.spec\.ts/,
  // Serial: the audio-structure specs run long in-page clear loops that would
  // starve the rAF-driven sweep assertions in production-start if run in parallel
  // against the single shared prod server.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "line" : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "production-start",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    // Production build, NO test mode, into a dedicated dist dir.
    command: `NEXT_DIST_DIR=${DIST} SKIP_ENV_VALIDATION=1 pnpm exec next build && NEXT_DIST_DIR=${DIST} pnpm exec next start -p ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: { NEXT_DIST_DIR: DIST },
  },
});
