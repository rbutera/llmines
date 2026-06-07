import { describe, expect, it } from "vitest";

import { COLS, ROWS } from "~/game/constants";
import { blockCells, cloneGrid, emptyGrid, inBounds, isOccupied } from "~/game/grid";
import { canPlace } from "~/game/rules";
import type { ActiveBlock, Piece } from "~/game/types";

const piece: Piece = [
  [0, 1],
  [1, 0],
];

describe("emptyGrid", () => {
  it("has ROWS rows and COLS columns, all null", () => {
    const grid = emptyGrid();
    expect(grid).toHaveLength(ROWS);
    for (const row of grid) {
      expect(row).toHaveLength(COLS);
      expect(row.every((cell) => cell === null)).toBe(true);
    }
  });
});

describe("cloneGrid", () => {
  it("deep-clones each row so mutations do not leak", () => {
    const grid = emptyGrid();
    const clone = cloneGrid(grid);
    const cloneRow0 = clone[0];
    expect(cloneRow0).toBeDefined();
    cloneRow0![0] = 1;
    expect(grid[0]![0]).toBeNull();
  });
});

describe("inBounds", () => {
  it("accepts in-range coordinates and rejects out-of-range ones", () => {
    expect(inBounds(0, 0)).toBe(true);
    expect(inBounds(ROWS - 1, COLS - 1)).toBe(true);
    expect(inBounds(-1, 0)).toBe(false);
    expect(inBounds(0, -1)).toBe(false);
    expect(inBounds(ROWS, 0)).toBe(false);
    expect(inBounds(0, COLS)).toBe(false);
  });
});

describe("isOccupied", () => {
  it("is false for empty cells and out-of-bounds, true for filled cells", () => {
    const grid = emptyGrid();
    expect(isOccupied(grid, 0, 0)).toBe(false);
    expect(isOccupied(grid, -1, 0)).toBe(false);
    grid[5]![3] = 1;
    expect(isOccupied(grid, 5, 3)).toBe(true);
  });
});

describe("blockCells", () => {
  it("returns the four footprint cells with correct coords and colours", () => {
    const block: ActiveBlock = { piece, row: 2, col: 4 };
    expect(blockCells(block)).toEqual([
      { row: 2, col: 4, color: 0 },
      { row: 2, col: 5, color: 1 },
      { row: 3, col: 4, color: 1 },
      { row: 3, col: 5, color: 0 },
    ]);
  });
});

describe("canPlace", () => {
  it("allows placement on an empty grid in bounds", () => {
    const grid = emptyGrid();
    expect(canPlace(grid, { piece, row: 0, col: 7 })).toBe(true);
  });

  it("rejects placement that leaves the right edge", () => {
    const grid = emptyGrid();
    // col 15 would put the right cells at col 16 (out of bounds).
    expect(canPlace(grid, { piece, row: 0, col: COLS - 1 })).toBe(false);
  });

  it("rejects placement that leaves the bottom edge", () => {
    const grid = emptyGrid();
    expect(canPlace(grid, { piece, row: ROWS - 1, col: 0 })).toBe(false);
  });

  it("rejects placement overlapping an occupied stack cell", () => {
    const grid = emptyGrid();
    grid[3]![5] = 0; // collides with bottom-right of a block at (2,4)
    expect(canPlace(grid, { piece, row: 2, col: 4 })).toBe(false);
  });
});
