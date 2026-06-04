import { expect, type Page } from "@playwright/test";

export async function startGame(page: Page) {
  await page.goto("/");
  await page.getByTestId("start-button").click();
  await expect(page.getByTestId("score")).toHaveText("0");
}

export async function getLuminesApi(page: Page) {
  await page.waitForFunction(() => typeof window.__lumines !== "undefined");
  return page.evaluateHandle(() => window.__lumines);
}
