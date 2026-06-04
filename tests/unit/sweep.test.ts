import { describe, expect, it } from "vitest";
import { GRID_ROWS, SWEEP_FULL_MS, SWEEP_MS_PER_COL } from "~/game/constants";
import { createInitialState, sweepNow, sweepProgress } from "~/game/core/engine";
import { markedCells } from "~/game/core/marking";
import type { Color, GameState } from "~/game/core/types";

function withSquare(color: Color, r: number, c: number): GameState {
  const s = createInitialState();
  s.phase = "playing";
  s.grid[r]![c] = color;
  s.grid[r]![c + 1] = color;
  s.grid[r + 1]![c] = color;
  s.grid[r + 1]![c + 1] = color;
  return s;
}

describe("sweep timing", () => {
  it("advances exactly one column per 250ms", () => {
    let s = createInitialState();
    s.phase = "playing";
    s = sweepProgress(s, SWEEP_MS_PER_COL);
    expect(s.sweepX).toBeCloseTo(1, 6);
  });

  it("completes a full 16-column traversal in 4000ms and wraps", () => {
    let s = createInitialState();
    s.phase = "playing";
    s = sweepProgress(s, SWEEP_FULL_MS);
    expect(s.sweepX).toBeCloseTo(0, 6);
  });
});

describe("sweep clearing + scoring", () => {
  it("sweepNow deletes a 2x2 and scores 4, then gravity settles", () => {
    let s = withSquare(0, GRID_ROWS - 2, 5);
    expect(markedCells(s.grid)).toHaveLength(4);
    s = sweepNow(s);
    expect(s.score).toBe(4);
    expect(markedCells(s.grid)).toHaveLength(0);
    // cells are gone
    expect(s.grid[GRID_ROWS - 1]![5]).toBeNull();
    expect(s.grid[GRID_ROWS - 1]![6]).toBeNull();
  });

  it("sweepProgress over the square's columns clears and scores it within a traversal", () => {
    let s = withSquare(1, GRID_ROWS - 2, 2);
    s = sweepProgress(s, SWEEP_FULL_MS);
    expect(s.score).toBe(4);
    expect(s.grid[GRID_ROWS - 1]![2]).toBeNull();
  });

  it("scores a 3x3 region as 36", () => {
    let s = createInitialState();
    s.phase = "playing";
    for (let r = GRID_ROWS - 3; r < GRID_ROWS; r++)
      for (let c = 4; c < 7; c++) s.grid[r]![c] = 0;
    s = sweepNow(s);
    expect(s.score).toBe(36);
  });

  it("leaves cells above a cleared region to fall by gravity", () => {
    let s = withSquare(0, GRID_ROWS - 2, 8);
    // put a lone cell of the other colour above the square
    s.grid[GRID_ROWS - 3]![8] = 1;
    s = sweepNow(s);
    // the lone cell should have fallen to the floor of column 8
    expect(s.grid[GRID_ROWS - 1]![8]).toBe(1);
  });
});
