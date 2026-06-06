import { defineConfig, devices } from "@playwright/test";

/**
 * E2E config. The web server is started with NEXT_PUBLIC_TEST_MODE=1 so the
 * deterministic `window.__lumines` interface is exposed and the audio-synced
 * auto-loop is paused. Tests drive the game via that interface (no wall-clock,
 * audio decode, or pixel scraping).
 */
const PORT = 3100;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "line" : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: `NEXT_PUBLIC_TEST_MODE=1 SKIP_ENV_VALIDATION=1 pnpm exec next build && NEXT_PUBLIC_TEST_MODE=1 pnpm exec next start -p ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: {
      NEXT_PUBLIC_TEST_MODE: "1",
      NEXTAUTH_URL: `http://localhost:${PORT}`,
    },
  },
});
