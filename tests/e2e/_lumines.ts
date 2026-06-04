import { expect } from "@playwright/test";
import type { Page } from "@playwright/test";

export type Color = 0 | 1;
export type Piece = [[Color, Color], [Color, Color]];

export interface LuminesApi {
  seed(n: number): void;
  state(): {
    grid: (Color | null)[][];
    score: number;
    gameOver: boolean;
    sweepX: number;
  };
  marked(): { row: number; col: number }[];
  spawn(p: Piece): void;
  tick(): void;
  sweepNow(): void;
  sweepProgress(dtMs: number): void;
}

/** Navigate, click start, and wait for the deterministic API to be installed. */
export async function startGame(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.getByTestId("start-button")).toBeVisible();
  await expect(page.getByTestId("controls-cheatsheet")).toBeVisible();
  await expect(page.getByTestId("game-over")).toHaveCount(0);
  await page.getByTestId("start-button").click();
  await page.waitForFunction(
    () => typeof (window as unknown as { __lumines?: unknown }).__lumines !== "undefined",
  );
}
