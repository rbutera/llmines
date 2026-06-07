import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright configuration for LLMines end-to-end tests (Task 16, Req 16.2).
 *
 * The app is exercised in Test_Mode: `NEXT_PUBLIC_TEST_MODE` is inlined into the
 * client bundle at BUILD time, so the webServer command builds AND serves with
 * the flag set. The harness then drives deterministic state through
 * `window.__lumines` and the `data-testid` DOM hooks.
 */
const PORT = 3100;
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: "list",
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    // NEXT_PUBLIC_TEST_MODE must be set at build time so it is inlined into the
    // client bundle, then again at serve time for any runtime reads.
    command:
      "NEXT_PUBLIC_TEST_MODE=1 SKIP_ENV_VALIDATION=1 pnpm build && NEXT_PUBLIC_TEST_MODE=1 pnpm start -p 3100",
    url: BASE_URL,
    timeout: 180_000,
    reuseExistingServer: !process.env.CI,
  },
});
