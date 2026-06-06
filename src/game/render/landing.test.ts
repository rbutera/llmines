import { describe, expect, it } from "vitest";
import { ROWS, type ActivePiece } from "../core";
import { emptyGrid } from "../core/grid";
import { boundedActivePieceYOffset } from "./landing";

const CELL = 40;
const MONO_ACTIVE: ActivePiece = {
  cells: [
    [0, 0],
    [0, 0],
  ],
  pos: { row: 0, col: 7 },
};

describe("boundedActivePieceYOffset", () => {
  it("allows normal one-row interpolation before the floor", () => {
    const active: ActivePiece = {
      ...MONO_ACTIVE,
      pos: { row: ROWS - 3, col: 7 },
    };

    expect(boundedActivePieceYOffset(emptyGrid(), active, CELL, CELL)).toBe(
      CELL,
    );
  });

  it("prevents a floor-resting piece from interpolating below the grid", () => {
    const active: ActivePiece = {
      ...MONO_ACTIVE,
      pos: { row: ROWS - 2, col: 7 },
    };

    expect(boundedActivePieceYOffset(emptyGrid(), active, CELL / 2, CELL)).toBe(
      0,
    );
  });

  it("prevents interpolation through a near-bottom stack", () => {
    const grid = emptyGrid();
    grid[ROWS - 1]![7] = 1;
    grid[ROWS - 1]![8] = 1;
    const active: ActivePiece = {
      ...MONO_ACTIVE,
      pos: { row: ROWS - 3, col: 7 },
    };

    expect(boundedActivePieceYOffset(grid, active, CELL / 2, CELL)).toBe(0);
  });

  it("clamps to the last legal space above a stack", () => {
    const grid = emptyGrid();
    grid[ROWS - 1]![7] = 1;
    grid[ROWS - 1]![8] = 1;
    const active: ActivePiece = {
      ...MONO_ACTIVE,
      pos: { row: ROWS - 4, col: 7 },
    };

    expect(boundedActivePieceYOffset(grid, active, CELL * 2, CELL)).toBe(CELL);
  });
});
