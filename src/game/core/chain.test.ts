import { describe, expect, it } from "vitest";
import { floodFill } from "./chain";
import { ALL_CLEAR_BONUS, COLS, ROWS, SINGLE_COLOUR_BONUS } from "./constants";
import { createGame } from "./grid";
import { advanceSweep, runFullSweep } from "./sweep";
import type { GameState, Grid } from "./types";

function emptyGrid(): Grid {
  return Array.from({ length: ROWS }, () =>
    Array.from({ length: COLS }, () => null),
  );
}

describe("floodFill (4-connected, order-independent)", () => {
  it("returns the connected same-colour component including the start", () => {
    const g = emptyGrid();
    // An L of colour 0: (9,0),(9,1),(8,1)
    g[ROWS - 1]![0] = 0;
    g[ROWS - 1]![1] = 0;
    g[ROWS - 2]![1] = 0;
    // a disconnected 0 elsewhere
    g[ROWS - 1]![5] = 0;
    const comp = floodFill(g, (ROWS - 1) * COLS + 0, 0);
    expect(comp.size).toBe(3);
    expect(comp.has((ROWS - 1) * COLS + 0)).toBe(true);
    expect(comp.has((ROWS - 1) * COLS + 1)).toBe(true);
    expect(comp.has((ROWS - 2) * COLS + 1)).toBe(true);
    expect(comp.has((ROWS - 1) * COLS + 5)).toBe(false);
  });

  it("does not cross colour boundaries", () => {
    const g = emptyGrid();
    g[ROWS - 1]![0] = 0;
    g[ROWS - 1]![1] = 1; // different colour blocks the fill
    g[ROWS - 1]![2] = 0;
    const comp = floodFill(g, (ROWS - 1) * COLS + 0, 0);
    expect(comp.size).toBe(1);
  });
});

/**
 * Build a board with a mono-0 2x2 square in cols 0-1 (rows 8-9) and a long
 * same-colour-0 horizontal tail running across the floor from col 2..tailEnd.
 * Mark the square's bottom-left cell as a chain special. When the sweep clears
 * the square, the chain floods the whole connected 0 region (square + tail).
 */
function chainBoard(tailEnd: number): GameState {
  const base = createGame();
  // mono square cols 0-1
  base.grid[ROWS - 1]![0] = 0;
  base.grid[ROWS - 1]![1] = 0;
  base.grid[ROWS - 2]![0] = 0;
  base.grid[ROWS - 2]![1] = 0;
  // tail along the floor, same colour, connected to the square at col 1->2
  for (let c = 2; c <= tailEnd; c++) base.grid[ROWS - 1]![c] = 0;
  // chain special on the square's bottom-left cell
  base.specials = new Set([(ROWS - 1) * COLS + 0]);
  return base;
}

describe("chain flood-fill clear (shares the sweep delete step)", () => {
  it("a chain in a cleared square floods the whole connected same-colour region", () => {
    const s = runFullSweep(chainBoard(8)); // tail to col 8
    // every 0 cell (square + tail) is gone
    for (let c = 0; c <= 8; c++) {
      expect(s.grid[ROWS - 1]![c]).toBe(null);
    }
    expect(s.specials.size).toBe(0);
  });

  it("flooded extras score nothing: only the snapshot square counts", () => {
    const s = runFullSweep(chainBoard(8));
    // 1 square x 40 = 40; the flood cleared the whole board -> all-clear bonus.
    // The tail cells (extras) add NOTHING to the square score.
    expect(s.score).toBe(40 + ALL_CLEAR_BONUS);
    expect(s.combo).toBe(0); // 1 square < 4 -> no qualifying combo
  });

  it("a chain NOT part of a cleared square does not flood", () => {
    const base = createGame();
    // A lone 0 with a same-colour tail, but NO 2x2 square anywhere -> no clear.
    base.grid[ROWS - 1]![0] = 0;
    base.grid[ROWS - 1]![1] = 0;
    base.grid[ROWS - 1]![2] = 0;
    base.specials = new Set([(ROWS - 1) * COLS + 0]);
    const s = runFullSweep(base);
    // nothing cleared: the row of 0s survives, special intact.
    expect(s.grid[ROWS - 1]![0]).toBe(0);
    expect(s.grid[ROWS - 1]![2]).toBe(0);
    expect(s.specials.has((ROWS - 1) * COLS + 0)).toBe(true);
    expect(s.score).toBe(0);
  });

  it("flood reaches cells ahead of the bar (cleared immediately)", () => {
    // Tail extends far to the right (ahead of where the bar starts). Use the
    // incremental advanceSweep so the bar processes columns left-to-right; the
    // chain in col 0's square must clear the entire tail in the same step, even
    // the far-right cells the bar has not reached yet.
    const s = advanceSweep(chainBoard(12), 2.5); // bar only past cols 0,1
    for (let c = 0; c <= 12; c++) {
      expect(s.grid[ROWS - 1]![c]).toBe(null);
    }
  });

  it("two chain cells in one region resolve as a single flood (no double-count)", () => {
    const base = chainBoard(8);
    // add a second chain special inside the same connected region (col 5).
    base.specials = new Set([
      (ROWS - 1) * COLS + 0,
      (ROWS - 1) * COLS + 5,
    ]);
    const s = runFullSweep(base);
    for (let c = 0; c <= 8; c++) expect(s.grid[ROWS - 1]![c]).toBe(null);
    // still scored as exactly one square (40) + all-clear; the second chain did
    // not add a second square or re-score the region.
    expect(s.score).toBe(40 + ALL_CLEAR_BONUS);
    expect(s.specials.size).toBe(0);
  });

  /**
   * REGRESSION (Codex review gate): chain flood + mid-pass settle must NOT delete
   * innocent cells in not-yet-processed columns.
   *
   * Mechanism of the original bug: the pass snapshotted raw (row,col) marks. When
   * the bar processed the chain column, the flood cleared a same-colour strip
   * AHEAD of the bar and the grid settled, dropping innocent cells into the snapshot
   * rows of a later column; when the bar reached that column it deleted those stale
   * rows — destroying innocent cells. Fixed by making marks identity-based: marks
   * fall with their cells through every per-column settle and are cleared for any
   * cell a flood consumes, so deletion only ever removes an originally-marked cell.
   */
  it("flood+settle does not delete innocent cells in a later column (Codex repro)", () => {
    const base = createGame();
    // colour-0 strip cols 0-3, rows 8-9 -> 3 distinct squares (cols 0-1,1-2,2-3).
    for (let c = 0; c <= 3; c++) {
      base.grid[8]![c] = 0;
      base.grid[9]![c] = 0;
    }
    // chain special on the strip's bottom-left square.
    base.specials = new Set([8 * COLS + 0]);
    // innocent colour-1 cells stacked above col 3 (rows 5,6,7) — never part of any
    // square, must survive untouched.
    base.grid[5]![3] = 1;
    base.grid[6]![3] = 1;
    base.grid[7]![3] = 1;

    const s = advanceSweep(base, COLS); // full traversal

    // All 3 innocent colour-1 cells survive (settled to the floor of col 3).
    let ones = 0;
    for (let r = 0; r < ROWS; r++) if (s.grid[r]![3] === 1) ones++;
    expect(ones).toBe(3);
    // All colour-0 is gone (flood consumed the whole connected strip).
    let zeros = 0;
    for (let r = 0; r < ROWS; r++)
      for (let c = 0; c < COLS; c++) if (s.grid[r]![c] === 0) zeros++;
    expect(zeros).toBe(0);
    // Score = 3 squares x 40 = 120, PLUS the single-colour bonus (1,000): clearing
    // all colour-0 legitimately leaves a single-colour (colour-1) board, so the
    // bonus is correct and is NOT a corruption artifact — the same board WITHOUT a
    // chain special clears the same 3 squares and ends single-colour too. The bug
    // never inflated the *score*; it corrupted the *board* (and deleting innocents
    // happened to keep it single-colour for a different reason). See the
    // multi-colour variant below for the clean 120-only assertion.
    expect(s.score).toBe(120 + SINGLE_COLOUR_BONUS);
  });

  it("flood+settle leaves a multi-colour board: pure 3x40=120, no bonus (Codex repro, isolated)", () => {
    const base = createGame();
    // Same flooding colour-0 strip (3 squares), same chain special.
    for (let c = 0; c <= 3; c++) {
      base.grid[8]![c] = 0;
      base.grid[9]![c] = 0;
    }
    base.specials = new Set([8 * COLS + 0]);
    // Innocent colour-1 cells above col 3 (will be deleted by the bug).
    base.grid[5]![3] = 1;
    base.grid[6]![3] = 1;
    base.grid[7]![3] = 1;
    // A second, different innocent colour far away so the FINAL board is
    // multi-colour -> no single-colour bonus -> the score isolates the square
    // score alone. This survivor is what the corruption-free path must preserve.
    base.grid[9]![10] = 0; // lone colour-0, NOT connected to the strip
    base.grid[9]![11] = 1; // lone colour-1 neighbour keeps it multi-colour

    const s = advanceSweep(base, COLS);

    // Innocent col-3 ones survive.
    let ones = 0;
    for (let r = 0; r < ROWS; r++) if (s.grid[r]![3] === 1) ones++;
    expect(ones).toBe(3);
    // The far lone cells survive (not part of any square, not flood-connected).
    expect(s.grid[9]![10]).toBe(0);
    expect(s.grid[9]![11]).toBe(1);
    // Multi-colour board -> no bonus. Pure square score: 3 x 40 = 120.
    expect(s.score).toBe(120);
  });

  it("leaves an unrelated other-colour region untouched (and scores its bonus)", () => {
    const base = chainBoard(4); // 0-region cols 0..4
    // a separate single 1 cell far away survives the flood.
    base.grid[ROWS - 1]![10] = 1;
    const s = runFullSweep(base);
    for (let c = 0; c <= 4; c++) expect(s.grid[ROWS - 1]![c]).toBe(null);
    expect(s.grid[ROWS - 1]![10]).toBe(1);
    // 1 square (40); board reduced to a single colour (the lone 1) -> single
    // colour bonus.
    expect(s.score).toBe(40 + SINGLE_COLOUR_BONUS);
  });
});
