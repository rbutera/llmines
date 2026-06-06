import { describe, expect, it } from "vitest";
import {
  ALL_CLEAR_BONUS,
  COLS,
  ROWS,
  SINGLE_COLOUR_BONUS,
} from "./constants";
import { createGame } from "./grid";
import { boardStateBonus, nextCombo, passScore } from "./scoring";
import { advanceSweep } from "./sweep";
import type { GameState, Grid } from "./types";

/**
 * Place `n` horizontally-adjacent mono columns on the floor forming a 1xN-wide
 * mono band two rows tall -> (N-1) distinct 2x2 squares. So width `n+1` gives `n`
 * squares. Returns a fresh game with that band.
 */
function bandOfSquares(squares: number, color: 0 | 1 = 0): GameState {
  const base = createGame();
  const width = squares + 1;
  for (let c = 0; c < width; c++) {
    base.grid[ROWS - 1]![c] = color;
    base.grid[ROWS - 2]![c] = color;
  }
  return base;
}

describe("passScore (faithful rule: squares x 40 x combo-curve)", () => {
  it("one square scores 40 with no combo", () => {
    expect(passScore(1, 0)).toBe(40);
  });

  it("three squares score 120 (no 4+ multiplier)", () => {
    expect(passScore(3, 0)).toBe(120);
  });

  it("four squares trigger the first multiplier (x4)", () => {
    expect(passScore(4, 0)).toBe(4 * 40 * 4);
  });

  it("the combo curve escalates 4,8,12,16 and caps at 16", () => {
    expect(passScore(4, 0)).toBe(4 * 40 * 4);
    expect(passScore(4, 1)).toBe(4 * 40 * 8);
    expect(passScore(4, 2)).toBe(4 * 40 * 12);
    expect(passScore(4, 3)).toBe(4 * 40 * 16);
    // capped beyond the curve length
    expect(passScore(4, 4)).toBe(4 * 40 * 16);
    expect(passScore(4, 99)).toBe(4 * 40 * 16);
  });

  it("the multiplier only applies at >= 4 squares", () => {
    // 3 squares never gets a multiplier even with a high combo count.
    expect(passScore(3, 5)).toBe(3 * 40);
  });

  it("is always an integer (no floats)", () => {
    for (let s = 0; s <= 12; s++) {
      for (let c = 0; c <= 6; c++) {
        expect(Number.isInteger(passScore(s, c))).toBe(true);
      }
    }
  });
});

describe("nextCombo", () => {
  it("bumps on >= 4 squares, resets on < 4", () => {
    expect(nextCombo(0, 4)).toBe(1);
    expect(nextCombo(1, 4)).toBe(2);
    expect(nextCombo(3, 3)).toBe(0);
    expect(nextCombo(5, 0)).toBe(0);
  });
});

describe("boardStateBonus", () => {
  function gridWith(cells: [number, number, 0 | 1][]): Grid {
    const g: Grid = Array.from({ length: ROWS }, () =>
      Array.from({ length: COLS }, () => null),
    );
    for (const [r, c, v] of cells) g[r]![c] = v;
    return g;
  }

  it("all-clear bonus on an empty board", () => {
    expect(boardStateBonus(gridWith([]))).toBe(ALL_CLEAR_BONUS);
  });

  it("single-colour bonus when only one colour remains", () => {
    expect(
      boardStateBonus(
        gridWith([
          [ROWS - 1, 0, 1],
          [ROWS - 1, 1, 1],
        ]),
      ),
    ).toBe(SINGLE_COLOUR_BONUS);
  });

  it("no bonus when two colours remain", () => {
    expect(
      boardStateBonus(
        gridWith([
          [ROWS - 1, 0, 0],
          [ROWS - 1, 1, 1],
        ]),
      ),
    ).toBe(0);
  });
});

describe("combo across consecutive sweeps (integration)", () => {
  it("a 4-square pass then another 4-square pass follows the curve", () => {
    // Two separate 4-square bands stacked so each clears on its own pass would
    // be complex; instead drive two independent 4-square boards sharing combo.
    let s = bandOfSquares(4); // 4 squares of colour 0
    s = advanceSweep(s, COLS);
    // 4 x 40 x 4 = 640, board emptied -> + all-clear bonus.
    const firstDelta = 4 * 40 * 4 + ALL_CLEAR_BONUS;
    expect(s.score).toBe(firstDelta);
    expect(s.combo).toBe(1);

    // Carry the combo into a second 4-square pass on a fresh board+snapshot.
    const grid2: Grid = Array.from({ length: ROWS }, () =>
      Array.from({ length: COLS }, () => null),
    );
    for (let c = 0; c < 5; c++) {
      grid2[ROWS - 1]![c] = 1;
      grid2[ROWS - 2]![c] = 1;
    }
    const refilled: GameState = { ...s, grid: grid2, sweepPass: null, sweepX: 0 };
    const s2 = advanceSweep(refilled, COLS);
    // combo was 1 -> multiplier x8 = 4 * 40 * 8 = 1280, board emptied again.
    expect(s2.score).toBe(firstDelta + 4 * 40 * 8 + ALL_CLEAR_BONUS);
    expect(s2.combo).toBe(2);
  });

  it("a sub-4 pass resets the combo to x1", () => {
    let s = bandOfSquares(4); // 4 squares -> qualifies
    s = advanceSweep(s, COLS);
    expect(s.combo).toBe(1);

    // A 1-square pass clears < 4 -> combo resets.
    const grid1: Grid = Array.from({ length: ROWS }, () =>
      Array.from({ length: COLS }, () => null),
    );
    grid1[ROWS - 1]![0] = 0;
    grid1[ROWS - 1]![1] = 0;
    grid1[ROWS - 2]![0] = 0;
    grid1[ROWS - 2]![1] = 0;
    const one: GameState = { ...s, grid: grid1, sweepPass: null, sweepX: 0 };
    const s2 = advanceSweep(one, COLS);
    expect(s2.combo).toBe(0);

    // The next 4-square pass starts the curve again at x4.
    const grid4: Grid = Array.from({ length: ROWS }, () =>
      Array.from({ length: COLS }, () => null),
    );
    for (let c = 0; c < 5; c++) {
      grid4[ROWS - 1]![c] = 1;
      grid4[ROWS - 2]![c] = 1;
    }
    const four: GameState = { ...s2, grid: grid4, sweepPass: null, sweepX: 0 };
    const before = s2.score;
    const s3 = advanceSweep(four, COLS);
    expect(s3.score - before).toBe(4 * 40 * 4 + ALL_CLEAR_BONUS);
  });
});
