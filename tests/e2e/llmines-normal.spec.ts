import { expect, test } from "@playwright/test";

test("does not expose the deterministic test API in normal mode", async ({
  page,
}) => {
  await page.goto("/?normalMode=1");
  await page.getByTestId("start-button").click();
  await expect(page.getByTestId("score")).toHaveText("0");
  const exposed = await page.evaluate(() => "__lumines" in window);
  expect(exposed).toBe(false);
});
