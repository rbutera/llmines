import { describe, expect, it } from "vitest";
import {
  createGame,
  emptyGrid,
  freshHold,
  GRAVITY_INTERVAL_MS,
  releaseHold,
  ROWS,
  spawnPiece,
  type GameState,
  type Piece,
} from "../core";
import { computeFallProgress } from "./fall-progress";

const MONO_A: Piece = [
  [0, 0],
  [0, 0],
];

/** A game with the active piece resting with its bottom cells on the floor. */
function restingOnFloor(): GameState {
  const base = createGame(1);
  // place the 2x2 so its bottom row is the last grid row (cannot descend)
  return {
    ...base,
    active: { cells: MONO_A, pos: { row: ROWS - 2, col: 7 } },
  };
}

/** A game with the active piece mid-air, falling (hold already released). */
function midAir(): GameState {
  // spawnPiece now starts the block held; release it so it represents a
  // genuinely-falling piece for the interpolation cases below.
  return releaseHold(spawnPiece(createGame(1), MONO_A));
}

describe("computeFallProgress", () => {
  const interval = GRAVITY_INTERVAL_MS;

  it("is 0 for a piece resting on the bottom row even at near-full accum", () => {
    // The bug: a resting piece must NOT be offset below its row.
    const p = computeFallProgress(
      restingOnFloor(),
      interval - 1,
      interval,
      false,
    );
    expect(p).toBe(0);
  });

  it("is 0 for a piece resting atop the stack mid-board", () => {
    const grid = emptyGrid();
    grid[5]![7] = 0; // a block at row 5, col 7
    grid[5]![8] = 0;
    const state: GameState = {
      ...createGame(1),
      grid,
      // 2x2 sitting on rows 3-4 above the row-5 blocks: next row illegal
      active: { cells: MONO_A, pos: { row: 3, col: 7 } },
    };
    expect(computeFallProgress(state, interval - 1, interval, false)).toBe(0);
  });

  it("interpolates for a mid-air piece that can still descend", () => {
    const p = computeFallProgress(midAir(), interval / 2, interval, false);
    expect(p).toBeCloseTo(0.5, 5);
  });

  it("clamps to [0,1] for a mid-air piece", () => {
    expect(computeFallProgress(midAir(), interval * 5, interval, false)).toBe(
      1,
    );
    expect(computeFallProgress(midAir(), -100, interval, false)).toBe(0);
  });

  it("is 0 in test mode regardless of accum", () => {
    expect(computeFallProgress(midAir(), interval / 2, interval, true)).toBe(0);
  });

  it("is 0 when there is no active piece", () => {
    expect(
      computeFallProgress(createGame(1), interval / 2, interval, false),
    ).toBe(0);
  });

  it("is 0 for a held piece even mid-board with accum", () => {
    const state: GameState = {
      ...createGame(1),
      active: { cells: MONO_A, pos: { row: 0, col: 7 } },
      hold: freshHold(),
    };
    expect(computeFallProgress(state, interval / 2, interval, false)).toBe(0);
  });
});
