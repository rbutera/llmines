import { describe, expect, it } from "vitest";
import { floodFill, floodFillOrdered } from "./chain";
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

  // Rai's explicit spec: the gem extends only over VERTICAL/HORIZONTAL adjacency.
  // A same-colour cell that touches only DIAGONALLY (no H/V path) is NOT part of
  // the component. This pins the 4-connected (NOT 8-connected) contract.
  it("is 4-connected: a diagonal-only same-colour cell is excluded", () => {
    const g = emptyGrid();
    // origin at (9,0); a same-colour cell at (8,1) touches it ONLY diagonally
    // (no orthogonal path: (9,1) and (8,0) are empty), so it must NOT be reached.
    g[ROWS - 1]![0] = 0;
    g[ROWS - 2]![1] = 0;
    const comp = floodFill(g, (ROWS - 1) * COLS + 0, 0);
    expect(comp.size).toBe(1);
    expect(comp.has((ROWS - 1) * COLS + 0)).toBe(true);
    expect(comp.has((ROWS - 2) * COLS + 1)).toBe(false);
  });

  it("reaches a diagonal cell only when an H/V path connects it", () => {
    const g = emptyGrid();
    // origin (9,0) -> (9,1) -> (8,1): the diagonal (8,1) IS included because an
    // orthogonal path through (9,1) reaches it. (Diagonal reachable via H/V.)
    g[ROWS - 1]![0] = 0;
    g[ROWS - 1]![1] = 0;
    g[ROWS - 2]![1] = 0;
    const comp = floodFill(g, (ROWS - 1) * COLS + 0, 0);
    expect(comp.size).toBe(3);
    expect(comp.has((ROWS - 2) * COLS + 1)).toBe(true);
  });

  // CROWN-JEWEL / owner spec: the gem clear is UNLIMITED — it floods the ENTIRE
  // connected same-colour component over H/V adjacency, however large. No size
  // cap. Build a large (>10 cell) snake of same-colour cells connected only via
  // H/V steps and assert every cell is in the component.
  it("clears an arbitrarily LARGE connected component (no size cap)", () => {
    const g = emptyGrid();
    // Serpentine path of colour 0 weaving through the grid, all H/V-connected:
    // full bottom row, up one, full row back, up one, ... (a boustrophedon).
    const cells: number[] = [];
    let row = ROWS - 1;
    let goingRight = true;
    // Lay 4 rows of the snake with vertical joins at alternating ends.
    for (let band = 0; band < 4; band++) {
      const cols = goingRight
        ? Array.from({ length: COLS }, (_, c) => c)
        : Array.from({ length: COLS }, (_, c) => COLS - 1 - c);
      for (const c of cols) {
        g[row]![c] = 0;
        cells.push(row * COLS + c);
      }
      // vertical join into the next band at the row's far end (kept colour 0).
      if (band < 3) {
        const joinCol = goingRight ? COLS - 1 : 0;
        g[row - 1]![joinCol] = 0;
        // the join cell is the first of the next band; it's added in that band's
        // loop, so don't double-count here.
      }
      row -= 1;
      goingRight = !goingRight;
    }
    const expected = new Set(cells);
    expect(expected.size).toBeGreaterThan(10);
    const comp = floodFill(g, cells[0]!, 0);
    // Every laid cell is reached; the component is exactly the snake.
    expect(comp).toEqual(expected);
    // floodFillOrdered tags the same set (membership identical), proving the
    // render record covers every cell of a big clear too.
    const orderedSet = new Set(
      floodFillOrdered(g, cells[0]!, 0).map((o) => o.cell),
    );
    expect(orderedSet).toEqual(expected);
  });
});

describe("floodFillOrdered (BFS-distance-tagged component, record-only)", () => {
  it("tags the origin dist 0 and each step out by graph distance", () => {
    const g = emptyGrid();
    // A horizontal run of colour 0 on the floor: cols 0..3 in the last row.
    for (let c = 0; c <= 3; c++) g[ROWS - 1]![c] = 0;
    const origin = (ROWS - 1) * COLS + 0;
    const ordered = floodFillOrdered(g, origin, 0);
    const distByCell = new Map(ordered.map((o) => [o.cell, o.dist]));
    expect(distByCell.get((ROWS - 1) * COLS + 0)).toBe(0);
    expect(distByCell.get((ROWS - 1) * COLS + 1)).toBe(1);
    expect(distByCell.get((ROWS - 1) * COLS + 2)).toBe(2);
    expect(distByCell.get((ROWS - 1) * COLS + 3)).toBe(3);
  });

  it("computes shortest-path (BFS) distance around an L-bend", () => {
    const g = emptyGrid();
    // L of colour 0: (9,0),(9,1),(8,1). From (9,0): (9,1) is 1, (8,1) is 2.
    g[ROWS - 1]![0] = 0;
    g[ROWS - 1]![1] = 0;
    g[ROWS - 2]![1] = 0;
    const origin = (ROWS - 1) * COLS + 0;
    const ordered = floodFillOrdered(g, origin, 0);
    const distByCell = new Map(ordered.map((o) => [o.cell, o.dist]));
    expect(distByCell.get((ROWS - 1) * COLS + 0)).toBe(0);
    expect(distByCell.get((ROWS - 1) * COLS + 1)).toBe(1);
    expect(distByCell.get((ROWS - 2) * COLS + 1)).toBe(2);
  });

  it("is emitted in nondecreasing distance (BFS visit) order", () => {
    const g = emptyGrid();
    for (let c = 0; c <= 4; c++) g[ROWS - 1]![c] = 0;
    g[ROWS - 2]![2] = 0; // a branch up from the middle
    const ordered = floodFillOrdered(g, (ROWS - 1) * COLS + 0, 0);
    for (let i = 1; i < ordered.length; i++) {
      expect(ordered[i]!.dist).toBeGreaterThanOrEqual(ordered[i - 1]!.dist);
    }
  });

  it("membership equals floodFill from the same origin (only adds distance)", () => {
    const g = emptyGrid();
    // A blob of colour 0 plus a disconnected 0 and a colour boundary.
    g[ROWS - 1]![0] = 0;
    g[ROWS - 1]![1] = 0;
    g[ROWS - 2]![0] = 0;
    g[ROWS - 2]![1] = 0;
    g[ROWS - 1]![2] = 1; // boundary
    g[ROWS - 1]![5] = 0; // disconnected
    const origin = (ROWS - 1) * COLS + 0;
    const orderedSet = new Set(floodFillOrdered(g, origin, 0).map((o) => o.cell));
    const flood = floodFill(g, origin, 0);
    expect(orderedSet).toEqual(flood);
    expect(orderedSet.has((ROWS - 1) * COLS + 5)).toBe(false);
  });

  it("does not cross colour boundaries", () => {
    const g = emptyGrid();
    g[ROWS - 1]![0] = 0;
    g[ROWS - 1]![1] = 1;
    g[ROWS - 1]![2] = 0;
    const ordered = floodFillOrdered(g, (ROWS - 1) * COLS + 0, 0);
    expect(ordered).toHaveLength(1);
    expect(ordered[0]).toEqual({ cell: (ROWS - 1) * COLS + 0, dist: 0 });
  });

  it("returns empty for an origin that is empty or the wrong colour", () => {
    const g = emptyGrid();
    g[ROWS - 1]![0] = 0;
    // origin is empty
    expect(floodFillOrdered(g, (ROWS - 2) * COLS + 0, 0)).toEqual([]);
    // origin is the wrong colour
    expect(floodFillOrdered(g, (ROWS - 1) * COLS + 0, 1)).toEqual([]);
  });
});

describe("chain-clear record-only payload (lastChainClear)", () => {
  it("records the cleared component with origin-rooted BFS distances", () => {
    // mono-0 strip cols 0..4 on the floor; chain special at the left end.
    const base = createGame();
    for (let c = 0; c <= 4; c++) base.grid[ROWS - 1]![c] = 0;
    // make it a real 2x2 square so the chain actually fires (cols 0-1, rows 8-9).
    base.grid[ROWS - 2]![0] = 0;
    base.grid[ROWS - 2]![1] = 0;
    const origin = (ROWS - 1) * COLS + 0;
    base.specials = new Set([origin]);

    const s = runFullSweep(base);
    expect(s.lastChainClear).toBeDefined();
    expect(s.lastChainClear!.origin).toBe(origin);
    // origin reported at dist 0.
    const distByCell = new Map(
      s.lastChainClear!.cells.map((o) => [o.cell, o.dist]),
    );
    expect(distByCell.get(origin)).toBe(0);
    // the far-right floor cell is the deepest in the component.
    expect(distByCell.get((ROWS - 1) * COLS + 4)).toBe(4);
    // every cleared cell is present in the record.
    expect(s.lastChainClear!.cells.length).toBeGreaterThanOrEqual(6);
  });

  it("bumps the monotonic id on each new chain clear; carries forward when none", () => {
    const mk = (): GameState => {
      const base = createGame();
      for (let c = 0; c <= 3; c++) base.grid[ROWS - 1]![c] = 0;
      base.grid[ROWS - 2]![0] = 0;
      base.grid[ROWS - 2]![1] = 0;
      base.specials = new Set([(ROWS - 1) * COLS + 0]);
      return base;
    };
    const s1 = runFullSweep(mk());
    expect(s1.lastChainClear!.id).toBe(1);
    // A second chain clear from s1 (rebuild a clearable board on top of s1's id).
    const s2base: GameState = { ...mk(), lastChainClear: s1.lastChainClear };
    const s2 = runFullSweep(s2base);
    expect(s2.lastChainClear!.id).toBe(2);
    // A sweep with NO chain clear carries the prior record forward unchanged.
    const s3 = advanceSweep({ ...createGame(), lastChainClear: s2.lastChainClear }, COLS);
    expect(s3.lastChainClear).toEqual(s2.lastChainClear);
  });

  it("leaves lastChainClear undefined when no chain fires", () => {
    const base = createGame();
    // a 2x2 square but NO chain special -> ordinary clear, no record.
    base.grid[ROWS - 1]![0] = 0;
    base.grid[ROWS - 1]![1] = 0;
    base.grid[ROWS - 2]![0] = 0;
    base.grid[ROWS - 2]![1] = 0;
    const s = runFullSweep(base);
    expect(s.lastChainClear).toBeUndefined();
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

describe("a surviving gem's special travels with its cell through a sweep settle", () => {
  it("relocates the special coord to the cell's new row after the column drops", () => {
    const base = createGame(1);
    // A 2x2 colour-0 square at rows 8-9, cols 0-1 -> erased by the sweep.
    base.grid[8]![0] = 0;
    base.grid[8]![1] = 0;
    base.grid[9]![0] = 0;
    base.grid[9]![1] = 0;
    // A lone colour-1 GEM at row 7, col 0 — NOT part of any square, so it
    // survives the sweep and falls when the square below it is erased.
    base.grid[7]![0] = 1;
    base.specials = new Set([7 * COLS + 0]);
    // Keep the board multi-colour so no single-colour bonus path interferes.
    base.grid[9]![11] = 1;

    const s = advanceSweep(base, COLS);

    // The gem cell fell from row 7 to the floor of its (now-empty) column.
    expect(s.grid[9]![0]).toBe(1);
    // Its special MOVED with it: new coord present, stale coord gone.
    expect(s.specials.has(9 * COLS + 0)).toBe(true);
    expect(s.specials.has(7 * COLS + 0)).toBe(false);
    // No special ever points at an empty cell.
    for (const coord of s.specials) {
      const r = Math.floor(coord / COLS);
      const c = coord % COLS;
      expect(s.grid[r]![c]).not.toBeNull();
    }
  });
});
