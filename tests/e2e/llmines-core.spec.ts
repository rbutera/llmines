import { expect, test } from "@playwright/test";

import { startGame } from "./fixtures";

test("starts a playable round with controls and keyboard movement", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator("main")).toHaveCount(1);
  await expect(page.getByTestId("controls-cheatsheet")).toContainText("space");
  await page.getByTestId("start-button").click();

  await expect(page.getByTestId("score")).toHaveText("0");
  await expect(page.getByTestId("controls-cheatsheet")).toContainText("Rotate");
  await expect(page.locator("canvas")).toBeVisible();

  const before = await page.evaluate(() => window.__lumines!.state().grid);
  await page.keyboard.press("h");
  const afterLeft = await page.evaluate(() => window.__lumines!.state().grid);
  expect(afterLeft).not.toEqual(before);

  await page.keyboard.press("k");
  await page.keyboard.press("j");
  await page.keyboard.press(" ");
  const afterDrop = await page.evaluate(() => window.__lumines!.state().grid);
  expect(afterDrop.flat().filter((cell) => cell !== null)).toHaveLength(4);
});

test("score element contains only the live numeric score", async ({ page }) => {
  await startGame(page);
  await expect(page.getByTestId("score")).toHaveText(/^\d+$/);
});
