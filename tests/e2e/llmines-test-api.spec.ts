import { expect, test } from "@playwright/test";

import { startGame } from "./fixtures";

test("exposes the deterministic test API in test mode", async ({ page }) => {
  await startGame(page);
  const apiShape = await page.evaluate(() => ({
    seed: typeof window.__lumines?.seed,
    state: typeof window.__lumines?.state,
    marked: typeof window.__lumines?.marked,
    spawn: typeof window.__lumines?.spawn,
    tick: typeof window.__lumines?.tick,
    sweepNow: typeof window.__lumines?.sweepNow,
    sweepProgress: typeof window.__lumines?.sweepProgress,
  }));

  expect(apiShape).toEqual({
    seed: "function",
    state: "function",
    marked: "function",
    spawn: "function",
    tick: "function",
    sweepNow: "function",
    sweepProgress: "function",
  });
});

test("advances sweep progress deterministically", async ({ page }) => {
  await startGame(page);
  await page.evaluate(() => window.__lumines!.sweepProgress(250));
  await expect
    .poll(() => page.evaluate(() => window.__lumines!.state().sweepX))
    .toBe(1);
});
