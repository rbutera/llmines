import { describe, expect, it } from "vitest";
import { COLS, ROWS, type Grid } from "../core";
import { shouldBurstOnClear } from "../fx/scoreFx";
import { clearedCellCount } from "./renderer";

/** Empty ROWS x COLS grid. */
function emptyGrid(): Grid {
  return Array.from({ length: ROWS }, () =>
    Array.from({ length: COLS }, () => null as Grid[number][number]),
  );
}

describe("score-burst gating: fires on square clear, NOT on soft-drop/settle", () => {
  it("a square clear (occupied count drops) yields a positive cleared count -> burst", () => {
    const prev = emptyGrid();
    // A settled 2x2 square at the bottom-left.
    prev[ROWS - 1]![0] = 0;
    prev[ROWS - 1]![1] = 0;
    prev[ROWS - 2]![0] = 0;
    prev[ROWS - 2]![1] = 0;
    const next = emptyGrid(); // the square got swept away

    const cleared = clearedCellCount(prev, next);
    expect(cleared).toBe(4);
    expect(shouldBurstOnClear(cleared)).toBe(true);
  });

  it("a soft-drop SETTLE (occupied count rises, nothing cleared) yields NO burst", () => {
    const prev = emptyGrid(); // mid-fall: active piece not in the settled grid
    const next = emptyGrid();
    // The piece just locked, ADDING 4 cells to the settled stack — no clear.
    next[ROWS - 1]![7] = 0;
    next[ROWS - 1]![8] = 0;
    next[ROWS - 2]![7] = 0;
    next[ROWS - 2]![8] = 0;

    const cleared = clearedCellCount(prev, next);
    expect(cleared).toBe(0);
    // Even though the authoritative score rose (soft-drop bonus banked on lock),
    // the burst must NOT fire because no cells were cleared.
    expect(shouldBurstOnClear(cleared)).toBe(false);
  });

  it("a no-op frame (identical grids) yields NO burst", () => {
    const g = emptyGrid();
    g[ROWS - 1]![3] = 1;
    const cleared = clearedCellCount(g, g.map((r) => r.slice()));
    expect(cleared).toBe(0);
    expect(shouldBurstOnClear(cleared)).toBe(false);
  });
});
