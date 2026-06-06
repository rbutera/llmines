import { describe, expect, it } from "vitest";
import { COLS, ROWS, type Grid } from "../core";
import { computeCollapseOffsets } from "./renderer";

const CELL = 40;

function empty(): Grid {
  return Array.from({ length: ROWS }, () =>
    Array.from({ length: COLS }, () => null),
  );
}

/**
 * Render regression (8.1): the collapse animation diff must handle a per-column
 * INCREMENTAL settle the same as a batch one. When the bar clears a column's
 * lower cells and the stack above falls (the deferred-gravity fix), the next
 * RenderState's column has cells at lower rows; the diff must produce a starting
 * offset so they animate down smoothly rather than teleporting.
 */
describe("computeCollapseOffsets (incremental settle animation)", () => {
  it("a cell that fell N rows gets a -N*CELL starting offset at its new position", () => {
    const oldGrid = empty();
    oldGrid[2]![0] = 1; // a cell up high in col 0
    const newGrid = empty();
    newGrid[ROWS - 1]![0] = 1; // same cell, now on the floor (fell)
    const offsets = computeCollapseOffsets(oldGrid, newGrid, CELL);
    const key = (ROWS - 1) * COLS + 0;
    expect(offsets.get(key)).toBe((2 - (ROWS - 1)) * CELL); // negative (started above)
  });

  it("an incremental settle that drops the upper part of a stack animates it", () => {
    // Realistic incremental-settle frame for a tall stack ABOVE a swept square:
    // Before: a deep stack of B in col 0 (rows 0..ROWS-3) sitting on a 2-high A
    // square at the floor. The diff is taken between the pre-clear frame and the
    // post-incremental-settle frame, where the B stack has dropped by 2 rows
    // (the square's height) and the A square is gone. The bottom-up stack match
    // pairs the surviving B cells, each of which fell exactly 2 rows -> a
    // -2*CELL starting offset, so the whole overhang eases down smoothly.
    const oldGrid = empty();
    oldGrid[ROWS - 1]![0] = 0; // A square (floor)
    oldGrid[ROWS - 2]![0] = 0;
    for (let r = 0; r <= ROWS - 3; r++) oldGrid[r]![0] = 1; // B stack on top
    const newGrid = empty();
    // After clear+settle: the B stack fell 2 rows to the floor; A is gone.
    for (let r = 2; r <= ROWS - 1; r++) newGrid[r]![0] = 1;
    const offsets = computeCollapseOffsets(oldGrid, newGrid, CELL);
    // Every surviving B cell fell exactly 2 rows -> offset -2*CELL.
    expect(offsets.size).toBeGreaterThan(0);
    for (const off of offsets.values()) expect(off).toBe(-2 * CELL);
  });

  it("no offsets when nothing moved", () => {
    const g = empty();
    g[ROWS - 1]![5] = 0;
    expect(computeCollapseOffsets(g, g, CELL).size).toBe(0);
  });

  it("does not offset cells that rose or stayed (only downward falls)", () => {
    const oldGrid = empty();
    oldGrid[ROWS - 1]![3] = 0;
    const newGrid = empty();
    newGrid[ROWS - 3]![3] = 0; // moved UP (not a real settle, but guard the sign)
    expect(computeCollapseOffsets(oldGrid, newGrid, CELL).size).toBe(0);
  });
});
