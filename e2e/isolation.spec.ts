import { expect, test } from "@playwright/test";

// Task 16.5 - Isolation + structure e2e.
//
// Structural checks that hold under the test-mode build:
//  - exactly one <main> landmark (Req 13.2)
//  - the NoCopyrightSounds music credit is present (Req 15.1)
//
// The flag-UNSET isolation check (window.__lumines undefined and no data-testid
// hooks) requires a separate NORMAL-mode build (NEXT_PUBLIC_TEST_MODE unset),
// because the flag is inlined into the client bundle at build time. The shared
// webServer here builds with NEXT_PUBLIC_TEST_MODE=1, so that assertion is
// documented and skipped below; it should be run against a production build
// with the flag unset. Req 16.1.

test("exactly one <main> landmark and the music credit are present", async ({
  page,
}) => {
  await page.goto("/");

  // Exactly one main landmark across the app shell (Req 13.2).
  await expect(page.locator("main")).toHaveCount(1);

  // Music attribution present somewhere on the page (Req 15.1).
  await expect(page.locator("body")).toContainText("NoCopyrightSounds");
});

// Req 16.1 - requires a build with NEXT_PUBLIC_TEST_MODE unset. Skipped here
// because the e2e webServer intentionally builds in test mode. To verify
// isolation, build/serve normally and assert that window.__lumines is
// undefined and no [data-testid] hooks are rendered.
test.skip("flag unset: no Test_Api and no data-testid hooks (needs normal-mode build)", async ({
  page,
}) => {
  await page.goto("/");
  const hasApi = await page.evaluate(
    () =>
      typeof (window as unknown as { __lumines?: unknown }).__lumines !==
      "undefined",
  );
  expect(hasApi).toBe(false);
  await expect(page.locator("[data-testid]")).toHaveCount(0);
});
