import { describe, expect, it } from "vitest";

import { SWEEP_PERIOD_MS } from "./constants";
import { GameEngine } from "./engine";
import { applyGravity, squareTopLefts } from "./grid";
import { createGrid } from "./grid";
import type { Grid, Piece } from "./types";

const A: Piece = [
  [0, 0],
  [0, 0],
];
const B: Piece = [
  [1, 1],
  [1, 1],
];

function playing(): GameEngine {
  const e = new GameEngine();
  e.start(false); // test-style: no auto-spawn
  return e;
}

describe("square detection (distinct_squares)", () => {
  it("counts a 2x2 as 1, a 2x3 as 2, a 3x3 as 4", () => {
    const g2x2: Grid = createGrid();
    g2x2[0]![0] = 0;
    g2x2[0]![1] = 0;
    g2x2[1]![0] = 0;
    g2x2[1]![1] = 0;
    expect(squareTopLefts(g2x2).length).toBe(1);

    const g2x3: Grid = createGrid();
    for (let c = 0; c < 3; c++) {
      g2x3[0]![c] = 0;
      g2x3[1]![c] = 0;
    }
    expect(squareTopLefts(g2x3).length).toBe(2);

    const g3x3: Grid = createGrid();
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) g3x3[r]![c] = 1;
    expect(squareTopLefts(g3x3).length).toBe(4);
  });
});

describe("gravity", () => {
  it("collapses cells to the floor preserving order", () => {
    const g = createGrid();
    g[0]![0] = 0;
    g[5]![0] = 1;
    applyGravity(g);
    expect(g[9]![0]).toBe(1);
    expect(g[8]![0]).toBe(0);
    expect(g[7]![0]).toBe(null);
  });
});

describe("scoring rule", () => {
  it("a single 2x2 square scores 4 (4 cells x 1 square)", () => {
    const eng = playing();
    eng.placePiece(A); // spawns at cols 7-8 rows 0-1
    eng.hardDrop(); // lock at floor, cols 7-8
    expect(eng.score).toBe(0);
    eng.sweepNow();
    expect(eng.score).toBe(4);
    // Cells cleared.
    expect(
      eng
        .state()
        .grid.flat()
        .filter((c) => c !== null).length,
    ).toBe(0);
  });

  it("clearing 3 squares (a 2x4 block) scores cells x distinct squares", () => {
    // A 2-row x 4-col monochrome block: 8 cells, 3 distinct 2x2 squares => 24.
    const eng = playing();
    // place two A pieces side by side: cols 7-8 then 9-10... but spawn is fixed.
    // Instead build via consecutive spawns + hard drops at shifted columns.
    eng.placePiece(A);
    eng.moveLeft();
    eng.moveLeft();
    eng.moveLeft();
    eng.moveLeft();
    eng.moveLeft();
    eng.moveLeft();
    eng.moveLeft(); // to col 0
    eng.hardDrop(); // A at cols 0-1, rows 8-9
    eng.placePiece(A);
    for (let i = 0; i < 5; i++) eng.moveLeft(); // col 7 -> col 2
    eng.hardDrop(); // A at cols 2-3, rows 8-9
    // Now a 2x4 monochrome block at cols 0-3.
    expect(squareTopLefts(eng.state().grid).length).toBe(3);
    eng.sweepNow();
    expect(eng.score).toBe(8 * 3);
  });
});

describe("sweep timing", () => {
  it("advances 1 column per 250ms and a full traversal in 4000ms", () => {
    const e = playing();
    e.placePiece(A);
    e.hardDrop();
    e.sweepProgress(250);
    expect(e.sweepX).toBeCloseTo(1, 5);
    e.sweepProgress(250 * 3);
    expect(e.sweepX).toBeCloseTo(4, 5);
    // Total full traversal time.
    expect(SWEEP_PERIOD_MS).toBe(4000);
  });
});

describe("game over", () => {
  it("triggers when a spawn cannot enter", () => {
    const e = playing();
    // Fill the spawn columns to the top by repeatedly spawning + hard dropping
    // pieces that stack in cols 7-8.
    for (let i = 0; i < 10 && !e.state().gameOver; i++) {
      e.placePiece(B);
      e.hardDrop();
    }
    // Eventually a spawn fails.
    e.placePiece(B);
    expect(e.state().gameOver).toBe(true);
  });
});

describe("tick never auto-spawns in isolation", () => {
  it("leaves the board quiescent after a lock", () => {
    const e = playing();
    e.placePiece(A);
    // drop to floor
    for (let i = 0; i < 12; i++) e.tick();
    // piece locked; further ticks do nothing, no new piece appears
    const before = e
      .state()
      .grid.flat()
      .filter((c) => c !== null).length;
    e.tick();
    e.tick();
    const after = e
      .state()
      .grid.flat()
      .filter((c) => c !== null).length;
    expect(after).toBe(before);
    expect(before).toBe(4);
  });
});
