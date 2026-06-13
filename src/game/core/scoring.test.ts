import { describe, expect, it } from "vitest";
import {
  ALL_CLEAR_BONUS,
  COLS,
  ROWS,
  SINGLE_COLOUR_BONUS,
} from "./constants";
import { createGame } from "./grid";
import { boardStateBonus, nextCombo, passPackage, passScore } from "./scoring";
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

describe("passPackage (faithful base: 40/square then the 640 big-clear package)", () => {
  it("1-3 squares score 40 each (40 / 80 / 120)", () => {
    expect(passPackage(1)).toBe(40);
    expect(passPackage(2)).toBe(80);
    expect(passPackage(3)).toBe(120);
  });

  it("4 squares score the 640 package (not 4 x 40)", () => {
    expect(passPackage(4)).toBe(640);
  });

  it("5 and 6 squares add 160 each (800, 960)", () => {
    expect(passPackage(5)).toBe(800);
    expect(passPackage(6)).toBe(960);
  });

  it("0 squares score 0", () => {
    expect(passPackage(0)).toBe(0);
  });
});

describe("passScore (faithful package x streak multiplier [1,2,3,4])", () => {
  it("one square scores 40 with no streak", () => {
    expect(passScore(1, 0)).toBe(40);
  });

  it("three squares score 120 (sub-4: never multiplied)", () => {
    expect(passScore(3, 0)).toBe(120);
    // 3 squares never gets a multiplier even with a high streak count.
    expect(passScore(3, 5)).toBe(120);
  });

  it("FIRST qualifying pass (4 squares, no streak) pays the bare package 640, NOT 2560", () => {
    expect(passScore(4, 0)).toBe(640);
    expect(passScore(4, 0)).not.toBe(2560);
  });

  it("the multiplier applies to the PACKAGE, not per square (4 squares at x2 = 1280)", () => {
    expect(passScore(4, 1)).toBe(640 * 2);
  });

  it("the streak curve escalates x1,x2,x3,x4 over the package and caps at x4", () => {
    expect(passScore(4, 0)).toBe(640 * 1); // 640
    expect(passScore(4, 1)).toBe(640 * 2); // 1280
    expect(passScore(4, 2)).toBe(640 * 3); // 1920
    expect(passScore(4, 3)).toBe(640 * 4); // 2560
    // capped beyond the curve length
    expect(passScore(4, 4)).toBe(640 * 4);
    expect(passScore(4, 99)).toBe(640 * 4);
  });

  it("a big-clear package times the streak (6 squares at x3 = 960 x 3)", () => {
    expect(passScore(6, 2)).toBe(960 * 3);
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
    // FIRST qualifying pass: package(4)=640 x streak x1 = 640, board emptied ->
    // + all-clear bonus. (No double-counted x4: the package IS the x4.)
    const firstDelta = 640 + ALL_CLEAR_BONUS;
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
    // streak was 1 -> x2 over the package: 640 x 2 = 1280, board emptied again.
    expect(s2.score).toBe(firstDelta + 640 * 2 + ALL_CLEAR_BONUS);
    expect(s2.combo).toBe(2);
  });

  it("a 6-square pass banks the 960 package end-to-end (no prior streak)", () => {
    // A mono 1x7 band = 6 distinct squares; first qualifying pass -> 960 x x1.
    let s = bandOfSquares(6, 0);
    s = advanceSweep(s, COLS);
    expect(s.score).toBe(960 + ALL_CLEAR_BONUS);
    expect(s.combo).toBe(1);
  });

  it("no board-state bonus on a pass that cleared nothing (single-colour board)", () => {
    // A lone single-colour cell, no square -> nothing clears -> no bonus.
    const base = createGame();
    base.grid[ROWS - 1]![0] = 1;
    const s = advanceSweep(base, COLS);
    expect(s.score).toBe(0);
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
    // streak restarted -> package(4)=640 x x1 = 640, board emptied -> all-clear.
    expect(s3.score - before).toBe(640 + ALL_CLEAR_BONUS);
  });
});
