import { expect, test } from "@playwright/test";

test("keeps one main landmark and visible keyboard guidance", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator("main")).toHaveCount(1);
  await expect(page.getByTestId("controls-cheatsheet")).toBeVisible();
  await page.getByTestId("start-button").focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("score")).toHaveText("0");
  await expect(page.locator("main")).toHaveCount(1);
});
