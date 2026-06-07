import { expect, test } from "@playwright/test";

// Task 16.3 — Deterministic mechanics e2e via window.__lumines.
//
// Drives the deterministic Test_Api to build a monochrome 2x2 in the settled
// stack, asserts it is marked, sweeps it, and asserts the pinned scoring rule
// (deletedCells * distinctSquares). Also asserts the sweep advances at the
// documented rate (0.25 s/col).
// Req 7.1, 18.2, 19.1, 19.3, 19.4, 6.1.

// Types mirror the LuminesTestApi surface; declared locally so each
// page.evaluate body is self-contained (closures cannot capture outer scope).
type Color = 0 | 1;
type Piece = [[Color, Color], [Color, Color]];

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("start-button").click();
  await expect(page.getByTestId("score")).toBeVisible();
  // The Test_Api is installed on mount; make sure it is present before driving it.
  await page.waitForFunction(
    () =>
      typeof (window as unknown as { __lumines?: unknown }).__lumines !==
      "undefined",
  );
});

test("build a monochrome 2x2 and sweep it: score = cells * squares = 4", async ({
  page,
}) => {
  const result = await page.evaluate(() => {
    interface Api {
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
    const api = (window as unknown as { __lumines?: Api }).__lumines;
    if (!api) {
      throw new Error("window.__lumines is not installed");
    }

    const mono: Piece = [
      [0, 0],
      [0, 0],
    ];
    api.seed(1);
    // First spawn places the active block at rows 0-1, cols 7-8.
    api.spawn(mono);
    // Second spawn locks the first block into the stack at rows 0-1, cols 7-8,
    // which is itself a same-colour 2x2 in the settled stack.
    api.spawn(mono);

    const before = api.state();
    const marked = api.marked();

    const want: [number, number][] = [
      [0, 7],
      [0, 8],
      [1, 7],
      [1, 8],
    ];
    const markedSet = new Set(marked.map((m) => `${m.row},${m.col}`));
    const allFourMarked = want.every(([r, c]) => markedSet.has(`${r},${c}`));

    const beforeCells = [
      before.grid[0]?.[7] ?? null,
      before.grid[0]?.[8] ?? null,
      before.grid[1]?.[7] ?? null,
      before.grid[1]?.[8] ?? null,
    ];

    // Sweep the whole field: deletes the 4 marked cells and scores.
    api.sweepNow();
    const after = api.state();
    const afterCells = [
      after.grid[0]?.[7] ?? null,
      after.grid[0]?.[8] ?? null,
      after.grid[1]?.[7] ?? null,
      after.grid[1]?.[8] ?? null,
    ];

    return {
      beforeCells,
      allFourMarked,
      markedCount: marked.length,
      score: after.score,
      afterCells,
    };
  });

  // The spawned cells are present in the composite grid before the sweep.
  expect(result.beforeCells).toEqual([0, 0, 0, 0]);
  // The four cells of the 2x2 are marked for deletion (Req 5, 19.1).
  expect(result.allFourMarked).toBe(true);
  expect(result.markedCount).toBeGreaterThanOrEqual(4);
  // Scoring rule: 4 deleted cells * 1 distinct square = 4 (Req 7.1, 19.3).
  expect(result.score).toBe(4);
  // After the sweep the cells are cleared (Req 6.3).
  expect(result.afterCells).toEqual([null, null, null, null]);
});

test("sweepProgress advances the bar at 0.25 s/col (1000ms -> ~4 cols)", async ({
  page,
}) => {
  const sweepX = await page.evaluate(() => {
    interface Api {
      state(): { sweepX: number };
      sweepProgress(dtMs: number): void;
    }
    const api = (window as unknown as { __lumines?: Api }).__lumines;
    if (!api) {
      throw new Error("window.__lumines is not installed");
    }
    // Fresh session: sweepX starts at 0. 1000ms / 250ms-per-col = 4 columns.
    api.sweepProgress(1000);
    return api.state().sweepX;
  });

  // Within a small tolerance of 4 columns (Req 19.4, 6.1).
  expect(sweepX).toBeGreaterThan(3.99);
  expect(sweepX).toBeLessThan(4.01);
});
