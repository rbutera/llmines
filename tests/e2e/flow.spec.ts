import { expect, test } from "@playwright/test";
import { startGame, type LuminesApi, type Piece } from "./_lumines";

const SOLID: Piece = [
  [0, 0],
  [0, 0],
];

test("start → play → game over → restart flow", async ({ page }) => {
  await startGame(page);

  await expect(page.getByTestId("score")).toHaveText("0");
  await expect(page.getByTestId("controls-cheatsheet")).toBeVisible();

  // Fill the spawn zone until a spawn is rejected (stack reaches the top).
  await page.evaluate((piece) => {
    const api = (window as unknown as { __lumines: LuminesApi }).__lumines;
    for (let i = 0; i < 40; i++) {
      api.spawn(piece as Piece);
      if (api.state().gameOver) break;
    }
  }, SOLID);

  await expect(page.getByTestId("game-over")).toBeVisible();
  await expect(page.getByTestId("restart")).toBeVisible();

  await page.getByTestId("restart").click();
  await expect(page.getByTestId("score")).toHaveText("0");
  await expect(page.getByTestId("game-over")).toHaveCount(0);

  const empty = await page.evaluate(() => {
    const api = (window as unknown as { __lumines: LuminesApi }).__lumines;
    return api.state().grid.flat().every((c) => c === null);
  });
  expect(empty).toBe(true);
});
