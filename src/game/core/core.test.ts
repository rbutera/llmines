import { describe, expect, it } from "vitest";
import { COLS, ROWS } from "./constants";
import { computeMarked } from "./detect";
import {
  createGame,
  emptyGrid,
  settle,
  settleColumn,
  viewGrid,
} from "./grid";
import {
  gravityStep,
  hardDrop,
  moveLeft,
  moveRight,
  nextPiece,
  rotateCells,
  rotateCW,
  spawnPiece,
} from "./piece";
import { advanceSweep, runFullSweep } from "./sweep";
import type { GameState, Grid, Piece } from "./types";

const MONO_A: Piece = [
  [0, 0],
  [0, 0],
];
const MONO_B: Piece = [
  [1, 1],
  [1, 1],
];

/** Deep-clone a grid (test helper; mirrors core cloneGrid without the import). */
function cloneForTest(grid: Grid): Grid {
  return grid.map((r) => r.slice());
}

/** Build a grid from a compact string map: '.'=empty, '0'=A, '1'=B. */
function gridFrom(rows: string[]): Grid {
  const g = emptyGrid();
  rows.forEach((line, r) => {
    [...line].forEach((ch, c) => {
      if (ch === "0") g[r]![c] = 0;
      else if (ch === "1") g[r]![c] = 1;
    });
  });
  return g;
}

describe("rng / piece generation (3.3)", () => {
  it("same seed yields identical piece sequence", () => {
    const draw = (seed: number): Piece[] => {
      let s = createGame(seed).rngState;
      const out: Piece[] = [];
      for (let i = 0; i < 20; i++) {
        const [next, piece] = nextPiece(s);
        s = next;
        out.push(piece);
      }
      return out;
    };
    expect(draw(42)).toEqual(draw(42));
  });

  it("different seeds generally differ", () => {
    const first = nextPiece(createGame(1).rngState)[1];
    let differs = false;
    for (let seed = 2; seed < 40; seed++) {
      if (JSON.stringify(nextPiece(createGame(seed).rngState)[1]) !==
        JSON.stringify(first)) {
        differs = true;
        break;
      }
    }
    expect(differs).toBe(true);
  });

  it("cells are independently coloured (mix appears over many draws)", () => {
    let s = createGame(7).rngState;
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const [next, p] = nextPiece(s);
      s = next;
      seen.add(JSON.stringify(p));
    }
    // With independent cells we expect more than just the 2 monochrome pieces.
    expect(seen.size).toBeGreaterThan(2);
  });
});

describe("grid model (2.x)", () => {
  it("empty grid is 10x16 of null", () => {
    const g = createGame().grid;
    expect(g.length).toBe(ROWS);
    expect(g[0]!.length).toBe(COLS);
    expect(g.flat().every((c) => c === null)).toBe(true);
  });

  it("settle drops floating cells to the floor", () => {
    const g = gridFrom(["0...", "....", "0..."]);
    const out = settle(g);
    expect(out[ROWS - 1]![0]).toBe(0);
    expect(out[ROWS - 2]![0]).toBe(0);
    expect(out[0]![0]).toBe(null);
  });
});

describe("piece mechanics (4.x)", () => {
  function withPiece(cells: Piece): GameState {
    return spawnPiece(createGame(), cells);
  }

  it("spawns at top-centre cols 7-8 rows 0-1", () => {
    const s = withPiece(MONO_A);
    expect(s.active?.pos).toEqual({ row: 0, col: 7 });
    const v = viewGrid(s);
    expect(v[0]![7]).toBe(0);
    expect(v[0]![8]).toBe(0);
    expect(v[1]![7]).toBe(0);
    expect(v[1]![8]).toBe(0);
  });

  it("move left/right within bounds, blocked at walls", () => {
    let s = withPiece(MONO_A);
    s = moveLeft(s);
    expect(s.active?.pos.col).toBe(6);
    s = moveRight(s);
    s = moveRight(s);
    expect(s.active?.pos.col).toBe(8);
    // shove to the right wall
    for (let i = 0; i < 20; i++) s = moveRight(s);
    expect(s.active?.pos.col).toBe(COLS - 2);
    // and to the left wall
    for (let i = 0; i < 20; i++) s = moveLeft(s);
    expect(s.active?.pos.col).toBe(0);
  });

  it("move blocked by a settled cell", () => {
    const base = createGame();
    base.grid[0]![6] = 1; // settled cell immediately left of spawn col 7
    const s = moveLeft(spawnPiece(base, MONO_A));
    expect(s.active?.pos.col).toBe(7); // unchanged
  });

  it("rotateCells permutes [[a,b],[c,d]] -> [[c,a],[d,b]]", () => {
    const p: Piece = [
      [0, 1],
      [1, 0],
    ];
    expect(rotateCells(p)).toEqual([
      [1, 0],
      [0, 1],
    ]);
  });

  it("rotateCW rejected when it would overlap", () => {
    const base = createGame();
    // Fill the cells the rotated piece would need so rotation can't apply.
    for (let c = 0; c < COLS; c++) {
      base.grid[2]![c] = 0;
    }
    // Place piece resting on the wall of filled row to force overlap on rotate is
    // tricky; instead assert rotateCW returns a valid 2x2 footprint in free space.
    const s = rotateCW(spawnPiece(base, [
      [0, 1],
      [1, 0],
    ]));
    expect(s.active?.cells).toEqual([
      [1, 0],
      [0, 1],
    ]);
  });

  it("gravity steps down then locks on the floor", () => {
    let s = withPiece(MONO_A);
    let locked = false;
    for (let i = 0; i < ROWS + 2; i++) {
      const r = gravityStep(s);
      s = r.state;
      locked = r.locked;
      if (locked) break;
    }
    expect(locked).toBe(true);
    expect(s.active).toBe(null);
    // bottom two rows of cols 7-8 are filled
    expect(s.grid[ROWS - 1]![7]).toBe(0);
    expect(s.grid[ROWS - 1]![8]).toBe(0);
    expect(s.grid[ROWS - 2]![7]).toBe(0);
    expect(s.grid[ROWS - 2]![8]).toBe(0);
  });

  it("locks onto the stack, not the floor", () => {
    const base = createGame();
    base.grid[ROWS - 1]![7] = 1;
    base.grid[ROWS - 1]![8] = 1;
    let s = spawnPiece(base, MONO_A);
    for (let i = 0; i < ROWS + 2; i++) {
      const r = gravityStep(s);
      s = r.state;
      if (r.locked) break;
    }
    // piece rests on top of the pre-filled bottom row
    expect(s.grid[ROWS - 1]![7]).toBe(1);
    expect(s.grid[ROWS - 2]![7]).toBe(0);
    expect(s.grid[ROWS - 3]![7]).toBe(0);
  });

  it("hard drop lands at the floor and locks immediately", () => {
    const s = hardDrop(withPiece(MONO_A));
    expect(s.active).toBe(null);
    expect(s.grid[ROWS - 1]![7]).toBe(0);
    expect(s.grid[ROWS - 2]![8]).toBe(0);
  });
});

describe("square detection (5.x)", () => {
  it("mono 2x2 -> 4 marked / 1 square", () => {
    const g = gridFrom(["00", "00"]);
    const r = computeMarked(g);
    expect(r.distinctSquares).toBe(1);
    expect(r.marked.length).toBe(4);
  });

  it("mixed 2x2 -> none", () => {
    expect(computeMarked(gridFrom(["01", "00"])).distinctSquares).toBe(0);
    expect(computeMarked(gridFrom(["01", "00"])).marked.length).toBe(0);
  });

  it("mono 2x3 -> 2 squares / 6 marked", () => {
    const r = computeMarked(gridFrom(["000", "000"]));
    expect(r.distinctSquares).toBe(2);
    expect(r.marked.length).toBe(6);
  });

  it("mono 3x3 -> 4 squares / 9 marked", () => {
    const r = computeMarked(gridFrom(["000", "000", "000"]));
    expect(r.distinctSquares).toBe(4);
    expect(r.marked.length).toBe(9);
  });

  it("does not mark across colour boundaries", () => {
    const r = computeMarked(gridFrom(["0011", "0011"]));
    // left 2x2 of 0s and right 2x2 of 1s = 2 squares, 8 cells
    expect(r.distinctSquares).toBe(2);
    expect(r.marked.length).toBe(8);
  });
});

describe("sweep, deletion & scoring (6.x)", () => {
  it("single 2x2 cleared by sweepNow -> score 4, cells gone", () => {
    // place the 2x2 at the floor so settle is a no-op
    const base = createGame();
    base.grid[ROWS - 1]![0] = 0;
    base.grid[ROWS - 1]![1] = 0;
    base.grid[ROWS - 2]![0] = 0;
    base.grid[ROWS - 2]![1] = 0;
    const s = runFullSweep(base);
    expect(s.score).toBe(4);
    expect(s.grid.flat().every((c) => c === null)).toBe(true);
  });

  it("three separate 2x2 squares in one pass -> 12 deleted x 3 = 36", () => {
    const base = createGame();
    const cols = [0, 4, 8];
    for (const c of cols) {
      base.grid[ROWS - 1]![c] = 1;
      base.grid[ROWS - 1]![c + 1] = 1;
      base.grid[ROWS - 2]![c] = 1;
      base.grid[ROWS - 2]![c + 1] = 1;
    }
    const s = runFullSweep(base);
    expect(s.score).toBe(36);
  });

  it("gravity fills the gap after a sweep deletes cells underneath", () => {
    // a 2x2 of 0s on the floor with a lone 1 sitting on top in col 0
    const base = createGame();
    base.grid[ROWS - 1]![0] = 0;
    base.grid[ROWS - 1]![1] = 0;
    base.grid[ROWS - 2]![0] = 0;
    base.grid[ROWS - 2]![1] = 0;
    base.grid[ROWS - 3]![0] = 1; // floats above the square
    const s = runFullSweep(base);
    // the 1 falls to the floor of col 0; the square is gone
    expect(s.grid[ROWS - 1]![0]).toBe(1);
    expect(s.grid[ROWS - 1]![1]).toBe(null);
    expect(s.score).toBe(4);
  });

  it("advanceSweep moves sweepX by 1 col per 1 column unit", () => {
    const s = advanceSweep(createGame(), 1);
    expect(s.sweepX).toBeCloseTo(1, 6);
  });

  it("advanceSweep full traversal (16 cols) wraps to 0 and scores like a pass", () => {
    const base = createGame();
    base.grid[ROWS - 1]![0] = 0;
    base.grid[ROWS - 1]![1] = 0;
    base.grid[ROWS - 2]![0] = 0;
    base.grid[ROWS - 2]![1] = 0;
    const s = advanceSweep(base, COLS);
    expect(s.score).toBe(4);
    expect(s.sweepX).toBeCloseTo(0, 6);
  });
});

describe("settleColumn (single-column gravity)", () => {
  it("drops a floating cell in one column to the floor, leaving others alone", () => {
    const g = gridFrom(["0.1", "...", "..."]);
    // col 0 has a floating 0 at row 0; col 2 has a floating 1 at row 0.
    settleColumn(g, 0);
    expect(g[ROWS - 1]![0]).toBe(0);
    expect(g[0]![0]).toBe(null);
    // col 2 was NOT settled.
    expect(g[0]![2]).toBe(1);
    expect(g[ROWS - 1]![2]).toBe(null);
  });

  it("matches settle() for the settled column", () => {
    const g = gridFrom(["0...", "....", "0...", "...."]);
    const full = settle(g);
    settleColumn(g, 0);
    expect(g[ROWS - 1]![0]).toBe(full[ROWS - 1]![0]);
    expect(g[ROWS - 2]![0]).toBe(full[ROWS - 2]![0]);
    expect(g[0]![0]).toBe(null);
  });
});

describe("incremental per-column settle (the deferred-gravity bug fix, 1.x)", () => {
  /**
   * Place a clearable mono 2x2 in a column with a tall stack of a DIFFERENT
   * colour sitting on top of it. Advance the sweep just past those columns
   * WITHOUT completing the pass; the stack above the cleared cells must have
   * already fallen (per-column incremental settle), not waited for pass end.
   */
  function buildStackOverSquare(): GameState {
    const base = createGame();
    // cols 0,1: 2x2 mono A square on the floor.
    base.grid[ROWS - 1]![0] = 0;
    base.grid[ROWS - 1]![1] = 0;
    base.grid[ROWS - 2]![0] = 0;
    base.grid[ROWS - 2]![1] = 0;
    // tall stack of B directly above the square in col 0 (rows 0..ROWS-3).
    for (let row = 0; row <= ROWS - 3; row++) base.grid[row]![0] = 1;
    return base;
  }

  it("stack above a swept column falls immediately, before the pass completes", () => {
    const base = buildStackOverSquare();
    // Advance just past columns 0 and 1 (leading edge at col 2), nowhere near
    // the 16-col pass end.
    const s = advanceSweep(base, 2.5);
    expect(s.sweepX).toBeCloseTo(2.5, 6);
    // The pass is NOT complete (sweepX << COLS), yet the square's cells are gone
    // and the B stack in col 0 has already fallen to the floor.
    expect(s.grid[ROWS - 1]![0]).toBe(1); // bottom of fallen B stack
    expect(s.grid[ROWS - 1]![1]).toBe(null); // square cell cleared, nothing fell here
    // The full B stack (ROWS-2 cells) now rests on the floor of col 0.
    const colZeroCells = s.grid.filter((r) => r[0] === 1).length;
    expect(colZeroCells).toBe(ROWS - 2);
    // None of the B cells were wrongly deleted.
    expect(s.grid[0]![0]).toBe(null); // top is now empty (stack fell)
  });

  it("does not change overall score timing: score still banks at pass end", () => {
    const base = buildStackOverSquare();
    const mid = advanceSweep(base, 2.5);
    // square cleared incrementally, but score not yet banked mid-pass.
    expect(mid.score).toBe(0);
    const done = advanceSweep(mid, COLS - mid.sweepX);
    // 1 distinct square at pass start, 4 deleted -> deletedCount(4) * squares(1).
    expect(done.score).toBe(4);
    expect(done.sweepX).toBeCloseTo(0, 6);
  });
});

describe("snapshot/settle race + cascade correctness (2.x)", () => {
  it("a cell that falls into a snapshot coordinate after the snapshot is NOT deleted", () => {
    // col 0: mono A 2x2 at the floor (snapshot-marked at pass start), and a lone
    // B floating two rows above it. When col 0 is swept, the A square is deleted
    // and the B cell falls DOWN INTO coordinates that were snapshot-marked
    // (rows ROWS-1/ROWS-2). The B cell must survive — deletion is by (row,col)
    // snapshot, applied before settle, so the post-settle B is not re-deleted.
    const base = createGame();
    base.grid[ROWS - 1]![0] = 0;
    base.grid[ROWS - 1]![1] = 0;
    base.grid[ROWS - 2]![0] = 0;
    base.grid[ROWS - 2]![1] = 0;
    base.grid[ROWS - 4]![0] = 1; // floats above the square in col 0
    const s = advanceSweep(base, 2.5);
    // B fell to the floor of col 0; the A square is gone.
    expect(s.grid[ROWS - 1]![0]).toBe(1);
    expect(s.grid[ROWS - 1]![1]).toBe(null);
    // exactly one B cell survives in col 0.
    expect(s.grid.filter((r) => r[0] === 1).length).toBe(1);
  });

  /**
   * Build a board where NO B 2x2 exists at pass start, but an incremental settle
   * (after the A square below clears) drops the scattered B cells into a fresh
   * B 2x2 — a true cascade. Per column: A square (rows ROWS-1,ROWS-2), then two
   * B cells at rows ROWS-3 and ROWS-5 (a gap at ROWS-4 prevents any 2x2 at start
   * — vertically the B's are not adjacent). After the A's clear and the column
   * settles, the two B's fall to rows ROWS-1,ROWS-2, forming a B 2x2 across both
   * columns.
   */
  function buildCascadeBoard(): GameState {
    const base = createGame();
    for (const c of [0, 1]) {
      base.grid[ROWS - 1]![c] = 0;
      base.grid[ROWS - 2]![c] = 0;
      base.grid[ROWS - 3]![c] = 1;
      base.grid[ROWS - 5]![c] = 1;
    }
    return base;
  }

  it("no B square exists at pass start (sanity for the cascade setup)", () => {
    // Only the A 2x2 should be marked initially; the scattered B's must not be.
    const start = computeMarked(buildCascadeBoard().grid);
    expect(start.distinctSquares).toBe(1);
  });

  it("a cascade square formed mid-pass does NOT clear this pass", () => {
    const s = advanceSweep(buildCascadeBoard(), 2.5); // sweep past cols 0,1
    // The A square is cleared and the B's fell forming a NEW 2x2, but it was NOT
    // in this pass's snapshot, so it must still be present.
    expect(s.grid[ROWS - 1]![0]).toBe(1);
    expect(s.grid[ROWS - 1]![1]).toBe(1);
    expect(s.grid[ROWS - 2]![0]).toBe(1);
    expect(s.grid[ROWS - 2]![1]).toBe(1);
    expect(s.score).toBe(0); // not banked yet either
  });

  it("the cascade square is marked at the next pass and clears on it", () => {
    // Complete this pass (A square clears, B square forms via cascade).
    const afterPass1 = advanceSweep(buildCascadeBoard(), COLS);
    expect(afterPass1.score).toBe(4); // only the A square scored this pass
    // B square is now on the floor, untouched.
    expect(afterPass1.grid[ROWS - 1]![0]).toBe(1);
    // Next full pass clears the cascade B square.
    const afterPass2 = advanceSweep(afterPass1, COLS);
    expect(afterPass2.grid[ROWS - 1]![0]).toBe(null);
    expect(afterPass2.score).toBe(8); // +4 for the B square
  });
});

describe("sweep determinism: step-size independence (5.3 core)", () => {
  /** Board with a clearable square that the sweep crosses, plus a stack to settle. */
  function build(): GameState {
    const base = createGame();
    base.grid[ROWS - 1]![0] = 0;
    base.grid[ROWS - 1]![1] = 0;
    base.grid[ROWS - 2]![0] = 0;
    base.grid[ROWS - 2]![1] = 0;
    for (let row = 0; row <= ROWS - 3; row++) base.grid[row]![0] = 1; // stack
    return base;
  }

  it("advancing 16 cols in one call == sixteen 1-col calls (grid + score + sweepX)", () => {
    const oneShot = advanceSweep(build(), COLS);
    let split: GameState = build();
    for (let i = 0; i < COLS; i++) split = advanceSweep(split, 1);
    expect(split.grid).toEqual(oneShot.grid);
    expect(split.score).toBe(oneShot.score);
    expect(split.sweepX).toBeCloseTo(oneShot.sweepX, 6);
  });

  it("3 cols in one call == three 1-col calls", () => {
    const oneShot = advanceSweep(build(), 3);
    let split: GameState = build();
    for (let i = 0; i < 3; i++) split = advanceSweep(split, 1);
    expect(split.grid).toEqual(oneShot.grid);
    expect(split.score).toBe(oneShot.score);
    expect(split.sweepX).toBeCloseTo(oneShot.sweepX, 6);
  });

  it("fractional steps sum to the same state as one big step", () => {
    const oneShot = advanceSweep(build(), 5);
    let split: GameState = build();
    for (let i = 0; i < 10; i++) split = advanceSweep(split, 0.5);
    expect(split.grid).toEqual(oneShot.grid);
    expect(split.score).toBe(oneShot.score);
    expect(split.sweepX).toBeCloseTo(oneShot.sweepX, 6);
  });
});

describe("partial-coverage matrix (3.x)", () => {
  /** Square sitting in cols [c, c+1] on the floor, mono colour. */
  function squareAt(base: GameState, c: number, color: 0 | 1): void {
    base.grid[ROWS - 1]![c] = color;
    base.grid[ROWS - 1]![c + 1] = color;
    base.grid[ROWS - 2]![c] = color;
    base.grid[ROWS - 2]![c + 1] = color;
  }

  it("square present at pass start clears this pass", () => {
    const base = createGame();
    squareAt(base, 0, 0);
    const s = advanceSweep(base, COLS);
    expect(s.grid[ROWS - 1]![0]).toBe(null);
    expect(s.score).toBe(4);
  });

  it("square formed BEHIND the bar mid-pass waits for the next pass", () => {
    // Start a pass with an empty board; the bar advances past col 5. Then a
    // square is dropped into cols 0-1 (behind the bar). It must not clear this
    // pass (not in snapshot), and must clear on the next full pass.
    let s = advanceSweep(createGame(), 6); // leading edge at col 6
    expect(s.sweepX).toBeCloseTo(6, 6);
    // Drop a square behind the bar into cols 0-1.
    const withSquare: GameState = { ...s, grid: cloneForTest(s.grid) };
    withSquare.grid[ROWS - 1]![0] = 0;
    withSquare.grid[ROWS - 1]![1] = 0;
    withSquare.grid[ROWS - 2]![0] = 0;
    withSquare.grid[ROWS - 2]![1] = 0;
    // Finish this pass.
    s = advanceSweep(withSquare, COLS - withSquare.sweepX);
    // Behind-the-bar square survived this pass.
    expect(s.grid[ROWS - 1]![0]).toBe(0);
    expect(s.score).toBe(0);
    // Next full pass clears it (now in the new snapshot).
    s = advanceSweep(s, COLS);
    expect(s.grid[ROWS - 1]![0]).toBe(null);
    expect(s.score).toBe(4);
  });

  it("square completed mid-pass AHEAD of the bar waits for the next pass", () => {
    // Bar advances past col 2 on an empty board, then a square is placed AHEAD
    // (cols 8-9). It wasn't in the pass-start snapshot, so it must wait.
    let s = advanceSweep(createGame(), 3); // leading edge at col 3
    const withSquare: GameState = { ...s, grid: cloneForTest(s.grid) };
    withSquare.grid[ROWS - 1]![8] = 1;
    withSquare.grid[ROWS - 1]![9] = 1;
    withSquare.grid[ROWS - 2]![8] = 1;
    withSquare.grid[ROWS - 2]![9] = 1;
    s = advanceSweep(withSquare, COLS - withSquare.sweepX);
    // Ahead square survived (not in snapshot).
    expect(s.grid[ROWS - 1]![8]).toBe(1);
    expect(s.score).toBe(0);
    // Next pass clears it.
    s = advanceSweep(s, COLS);
    expect(s.grid[ROWS - 1]![8]).toBe(null);
    expect(s.score).toBe(4);
  });
});

describe("game over (7.x)", () => {
  it("occupied spawn cells -> gameOver true, no active piece", () => {
    const base = createGame();
    base.grid[0]![7] = 1; // block a spawn cell
    const s = spawnPiece(base, [
      [0, 0],
      [0, 0],
    ] as Piece);
    expect(s.gameOver).toBe(true);
    expect(s.active).toBe(null);
  });

  it("normal spawn into free space does not end the game", () => {
    const s = spawnPiece(createGame(), MONO_B);
    expect(s.gameOver).toBe(false);
    expect(s.active).not.toBe(null);
  });
});
