import { expect, test } from "@playwright/test";

import { startGame } from "./fixtures";

test("deterministically clears a constructed 2x2 square and scores it", async ({
  page,
}) => {
  await startGame(page);

  await page.evaluate(() => {
    for (let i = 0; i < 9; i += 1) window.__lumines!.tick();
    window.__lumines!.spawn([
      [0, 0],
      [0, 0],
    ]);
    for (let i = 0; i < 9; i += 1) window.__lumines!.tick();
  });

  const marked = await page.evaluate(() => window.__lumines!.marked());
  expect(marked.length).toBeGreaterThanOrEqual(4);

  await page.evaluate(() => window.__lumines!.sweepNow());
  const state = await page.evaluate(() => window.__lumines!.state());
  expect(state.score).toBe(4);
  await expect
    .poll(() => page.evaluate(() => window.__lumines!.marked().length))
    .toBe(0);
});
