import { expect, test } from "@playwright/test";

// Task 16.2 — Start/flow e2e.
//
// Verifies the start screen presents the start control and controls cheatsheet,
// and that activating start moves to the In_Game_View with a live score of 0 and
// a persistent cheatsheet.
// Req 11.1, 11.2, 11.3, 12.1, 12.2, 20.1, 20.3, 20.5.

test("start flow: start screen -> in-game with score 0 and persistent cheatsheet", async ({
  page,
}) => {
  await page.goto("/");

  // Start_Screen: start control + Controls_Cheatsheet are visible (Req 11.1, 12.1, 20.1, 20.5).
  const startButton = page.getByTestId("start-button");
  await expect(startButton).toBeVisible();
  await expect(page.getByTestId("controls-cheatsheet")).toBeVisible();

  // Activate start (Req 11.2).
  await startButton.click();

  // In_Game_View: live score present, equal to "0" (Req 11.3, 20.3).
  const score = page.getByTestId("score");
  await expect(score).toBeVisible();
  await expect(score).toHaveText("0");

  // Controls_Cheatsheet remains visible in-game (Req 12.2, 20.5).
  await expect(page.getByTestId("controls-cheatsheet")).toBeVisible();
});
