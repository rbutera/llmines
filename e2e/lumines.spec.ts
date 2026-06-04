import { expect, test } from "@playwright/test";

import { MS_PER_COL } from "../src/game/constants";
import type { LuminesTestApi, Piece } from "../src/game/types";

type LuminesWindow = Window & { __lumines?: LuminesTestApi };

const solid = (color: 0 | 1): Piece => [
  [color, color],
  [color, color],
];

const start = async (page: import("@playwright/test").Page) => {
  await page.goto("/");
  await expect(page.getByTestId("start-button")).toBeVisible();
  await expect(page.getByTestId("controls-cheatsheet")).toContainText("space");
  await page.getByTestId("start-button").click();
  await page.waitForFunction(() =>
    Boolean((window as LuminesWindow).__lumines),
  );
};

test("start screen, in-game controls, and audio fixture are present", async ({
  page,
}) => {
  await page.goto("/");

  await expect(page.getByTestId("start-button")).toBeVisible();
  await expect(page.getByTestId("controls-cheatsheet")).toContainText(
    "hard-drop",
  );

  const audio = page.locator("audio");
  await expect(audio).toHaveAttribute("src", "/backing-track.mp3");
  await expect(audio).toHaveJSProperty("loop", true);

  await page.getByTestId("start-button").click();
  await expect(page.getByTestId("score")).toHaveText("0");
  await expect(page.getByTestId("controls-cheatsheet")).toContainText("rotate");
});

test("test API spawns, moves, rotates, and hard-drops a piece", async ({
  page,
}) => {
  await start(page);

  await page.evaluate((piece) => {
    const api = (window as LuminesWindow).__lumines!;
    api.spawn(piece);
  }, solid(0));

  await page.keyboard.press("h");
  let state = await page.evaluate(() =>
    (window as LuminesWindow).__lumines!.state(),
  );
  expect(state.grid[0]?.[6]).toBe(0);

  await page.keyboard.press("l");
  await page.keyboard.press("k");
  await page.keyboard.press(" ");
  state = await page.evaluate(() =>
    (window as LuminesWindow).__lumines!.state(),
  );
  expect(state.grid[8]?.[7]).toBe(0);
  expect(state.grid[9]?.[8]).toBe(0);
});

test("sweep clears a constructed square and updates score", async ({
  page,
}) => {
  await start(page);

  const result = await page.evaluate((piece) => {
    const api = (window as LuminesWindow).__lumines!;
    api.spawn(piece);
    for (let i = 0; i < 9; i++) api.tick();
    const markedBefore = api.marked();
    api.sweepNow();
    return { markedBefore, state: api.state() };
  }, solid(0));

  expect(result.markedBefore).toHaveLength(4);
  expect(result.state.score).toBe(4);
  await expect(page.getByTestId("score")).toHaveText("4");
});

test("cells collapse after a sweep deletion", async ({ page }) => {
  await start(page);

  const state = await page.evaluate(
    ({ bottom, top }) => {
      const api = (window as LuminesWindow).__lumines!;
      api.spawn(bottom);
      for (let i = 0; i < 9; i++) api.tick();
      api.spawn(top);
      for (let i = 0; i < 7; i++) api.tick();
      api.sweepNow();
      return api.state();
    },
    {
      bottom: solid(0),
      top: [
        [1, 0],
        [1, 0],
      ] satisfies Piece,
    },
  );

  expect(state.score).toBe(4);
  expect(state.grid[8]?.[7]).toBe(1);
  expect(state.grid[9]?.[7]).toBe(1);
  expect(state.grid[8]?.[8]).toBe(0);
  expect(state.grid[9]?.[8]).toBe(0);
});

test("deterministic sweep timing matches eight beats at 120 BPM", async ({
  page,
}) => {
  await start(page);

  const positions = await page.evaluate((msPerColumn) => {
    const api = (window as LuminesWindow).__lumines!;
    api.sweepProgress(msPerColumn);
    const oneColumn = api.state().sweepX;
    api.sweepProgress(msPerColumn * 15);
    return { afterFullSweep: api.state().sweepX, oneColumn };
  }, MS_PER_COL);

  expect(positions.oneColumn).toBeCloseTo(1);
  expect(positions.afterFullSweep).toBeCloseTo(0);
});

test("game over appears on stack overflow and restart returns to play", async ({
  page,
}) => {
  await start(page);

  await page.evaluate(
    (pieces) => {
      const api = (window as LuminesWindow).__lumines!;
      api.spawn(pieces[0]!);
      api.spawn(pieces[1]!);
    },
    [solid(0), solid(1)],
  );

  await expect(page.getByTestId("game-over")).toBeVisible();
  await page.getByTestId("restart").click();
  await expect(page.getByTestId("game-over")).toBeHidden();
  await expect(page.getByTestId("score")).toHaveText("0");
});
