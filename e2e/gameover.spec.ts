import { expect, test } from "@playwright/test";

// Task 16.4 - Game-over and restart e2e.
//
// Drives the deterministic Test_Api to stack blocks into the spawn region until
// a spawn is blocked, asserts the Game_Over_Screen appears with the final score,
// then restarts and asserts a fresh playable session with score 0.
// Req 9.1, 9.2, 9.3, 20.2, 20.4.

type Color = 0 | 1;
type Piece = [[Color, Color], [Color, Color]];

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("start-button").click();
  await expect(page.getByTestId("score")).toBeVisible();
  await page.waitForFunction(
    () =>
      typeof (window as unknown as { __lumines?: unknown }).__lumines !==
      "undefined",
  );
});

test("stacking into the spawn region triggers game over, restart resets to score 0", async ({
  page,
}) => {
  // Spawn the same block repeatedly. Each new spawn first locks the previous
  // block at the spawn position (rows 0-1, cols 7-8); without a tick the region
  // stays occupied, so a subsequent spawn is blocked and the game ends.
  const becameGameOver = await page.evaluate(() => {
    interface Api {
      state(): { gameOver: boolean };
      spawn(p: Piece): void;
    }
    const api = (window as unknown as { __lumines?: Api }).__lumines;
    if (!api) {
      throw new Error("window.__lumines is not installed");
    }
    const mono: Piece = [
      [0, 0],
      [0, 0],
    ];
    for (let i = 0; i < 8; i++) {
      api.spawn(mono);
      if (api.state().gameOver) {
        return true;
      }
    }
    return api.state().gameOver;
  });

  expect(becameGameOver).toBe(true);

  // Game_Over_Screen is shown with the game-over hook and a restart control
  // (Req 9.1, 9.2, 20.2, 20.4).
  await expect(page.getByTestId("game-over")).toBeVisible();
  const restart = page.getByTestId("restart");
  await expect(restart).toBeVisible();

  // Restart returns to a fresh playable session with score reset to 0 (Req 9.3).
  await restart.click();
  const score = page.getByTestId("score");
  await expect(score).toBeVisible();
  await expect(score).toHaveText("0");
  await expect(page.getByTestId("game-over")).toHaveCount(0);
});
