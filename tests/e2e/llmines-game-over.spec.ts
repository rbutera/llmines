import { expect, test } from "@playwright/test";

import { startGame } from "./fixtures";

test("shows game over and restarts", async ({ page }) => {
  await startGame(page);

  await page.evaluate(() => {
    for (let i = 0; i < 5; i += 1) {
      window.__lumines!.spawn([
        [0, 0],
        [0, 0],
      ]);
    }
  });

  await expect(page.getByTestId("game-over")).toBeVisible();
  await page.getByTestId("restart").click();
  await expect(page.getByTestId("score")).toHaveText("0");
  await expect(page.getByTestId("game-over")).toHaveCount(0);
});
