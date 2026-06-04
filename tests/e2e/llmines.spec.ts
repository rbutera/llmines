import { expect, test, type Page } from "@playwright/test";

async function waitForLuminesApi(page: Page) {
  await expect
    .poll(async () => page.evaluate(() => typeof window.__lumines !== "undefined"))
    .toBe(true);
}

test("start screen, audio, controls legend, and deterministic API are available", async ({
  page,
}) => {
  await page.goto("/");

  await expect(page.getByTestId("start-button")).toBeVisible();
  await expect(page.getByTestId("controls-cheatsheet")).toContainText("space");
  await expect(page.locator("main")).toHaveCount(1);
  await expect(page.locator("audio")).toHaveAttribute("src", "/backing-track.mp3");

  const audioLoop = await page.locator("audio").evaluate((audio) => {
    return audio instanceof HTMLAudioElement && audio.loop;
  });
  expect(audioLoop).toBe(true);

  await waitForLuminesApi(page);

  await page.getByTestId("start-button").click();
  await expect(page.getByTestId("score")).toHaveText("0");
});

test("keyboard controls move a spawned piece through the test API", async ({ page }) => {
  await page.goto("/");
  await waitForLuminesApi(page);
  await page.getByTestId("start-button").click();
  await page.evaluate(() => window.__lumines?.spawn([[0, 1], [1, 0]]));

  const before = await page.evaluate(() => window.__lumines?.state().grid);
  expect(before?.[0]?.[7]).toBe(0);

  await page.keyboard.press("h");
  const afterLeft = await page.evaluate(() => window.__lumines?.state().grid);
  expect(afterLeft?.[0]?.[6]).toBe(0);

  await page.keyboard.press("k");
  const afterRotate = await page.evaluate(() => window.__lumines?.state().grid);
  expect(afterRotate?.[0]?.[6]).toBe(1);
});

test("sweepNow clears a constructed square and updates score", async ({ page }) => {
  await page.goto("/");
  await waitForLuminesApi(page);
  await page.getByTestId("start-button").click();
  await page.evaluate(() => {
    window.__lumines?.spawn([[0, 0], [0, 0]]);
    for (let i = 0; i < 11; i += 1) {
      window.__lumines?.tick();
    }
  });

  const marked = await page.evaluate(() => window.__lumines?.marked().length);
  expect(marked).toBe(4);

  await page.evaluate(() => window.__lumines?.sweepNow());
  await expect(page.getByTestId("score")).toHaveText("4");

  const remaining = await page.evaluate(
    () => window.__lumines?.state().grid.flat().filter((cell) => cell !== null).length,
  );
  expect(remaining).toBe(0);
});

test("sweepProgress uses 250ms per column and wraps at 4000ms", async ({ page }) => {
  await page.goto("/");
  await waitForLuminesApi(page);
  await page.evaluate(() => window.__lumines?.sweepProgress(250));

  const oneColumn = await page.evaluate(() => window.__lumines?.state().sweepX);
  expect(oneColumn).toBe(1);

  await page.evaluate(() => window.__lumines?.sweepProgress(3_750));
  const wrapped = await page.evaluate(() => window.__lumines?.state().sweepX);
  expect(wrapped).toBe(0);
});

test("game over screen appears and restart returns to a new game", async ({ page }) => {
  await page.goto("/");
  await waitForLuminesApi(page);
  await page.getByTestId("start-button").click();
  await page.evaluate(() => {
    window.__lumines?.spawn([[0, 0], [0, 0]]);
    window.__lumines?.spawn([[1, 1], [1, 1]]);
  });

  await expect(page.getByTestId("game-over")).toBeVisible();
  await page.getByTestId("restart").click();
  await expect(page.getByTestId("game-over")).toHaveCount(0);
  await expect(page.getByTestId("score")).toHaveText("0");
});
