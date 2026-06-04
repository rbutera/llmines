import { expect, test } from "@playwright/test";
import { startGame, type LuminesApi } from "./_lumines";

test("sweep advances 1 column per 250ms (0.25s/col)", async ({ page }) => {
  await startGame(page);

  const x1 = await page.evaluate(() => {
    const api = (window as unknown as { __lumines: LuminesApi }).__lumines;
    api.sweepProgress(250);
    return api.state().sweepX;
  });
  expect(x1).toBeCloseTo(1, 3);
});

test("a full 16-column traversal takes 8 beats = 4000ms and wraps", async ({ page }) => {
  await startGame(page);

  const xs = await page.evaluate(() => {
    const api = (window as unknown as { __lumines: LuminesApi }).__lumines;
    api.sweepProgress(4000);
    const full = api.state().sweepX;
    api.sweepProgress(1000); // 4 more columns
    return { full, partial: api.state().sweepX };
  });
  expect(xs.full).toBeCloseTo(0, 3); // wrapped back to start
  expect(xs.partial).toBeCloseTo(4, 3);
});

test("a backing audio source exists, loops, and points at /backing-track.mp3", async ({ page }) => {
  await startGame(page);

  const audio = await page.evaluate(() => {
    const el = document.querySelector("audio");
    if (!el) return null;
    return { loop: el.loop, src: el.getAttribute("src") ?? el.src };
  });
  expect(audio).not.toBeNull();
  expect(audio!.loop).toBe(true);
  expect(audio!.src).toContain("/backing-track.mp3");
});
