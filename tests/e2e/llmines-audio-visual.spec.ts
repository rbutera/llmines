import { expect, test } from "@playwright/test";

import { startGame } from "./fixtures";

test("configures looping backing audio and renders a Pixi canvas", async ({
  page,
}) => {
  await startGame(page);
  const audio = page.locator('audio[src="/backing-track.mp3"]');
  await expect(audio).toHaveAttribute("loop", "");
  await expect(page.locator("canvas")).toBeVisible();
});
