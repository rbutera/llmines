import { describe, it, expect } from "vitest";
import { LuminesEngine } from "./engine";
import { COLS, MS_PER_COL, ROWS, SPAWN_COL, SWEEP_MS } from "./constants";

describe("LuminesEngine", () => {
  it("spawns a piece at top-centre and reflects it in state().grid", () => {
    const e = new LuminesEngine();
    e.spawnPiece([[0, 1], [1, 0]]);
    const g = e.state().grid;
    expect(g[0]![SPAWN_COL]).toBe(0);
    expect(g[0]![SPAWN_COL + 1]).toBe(1);
    expect(g[1]![SPAWN_COL]).toBe(1);
    expect(g[1]![SPAWN_COL + 1]).toBe(0);
  });

  it("tick advances gravity by one row and never auto-spawns", () => {
    const e = new LuminesEngine();
    e.spawnPiece([[0, 0], [0, 0]]);
    e.tick();
    expect(e.state().grid[1]![SPAWN_COL]).toBe(0); // piece top now at row 1
    for (let i = 0; i < ROWS; i++) e.tick();
    const g = e.state().grid;
    expect(g[ROWS - 1]![SPAWN_COL]).toBe(0);
    expect(g[0]![SPAWN_COL]).toBe(null); // nothing new at the top
  });

  it("spawn locks the previous piece (gravity to the floor) then places the new one", () => {
    const e = new LuminesEngine();
    e.spawnPiece([[0, 0], [0, 0]]);
    e.spawnPiece([[1, 1], [1, 1]]); // locks the first to the bottom
    const g = e.state().grid;
    expect(g[ROWS - 1]![SPAWN_COL]).toBe(0); // first piece settled on the floor
    expect(g[ROWS - 2]![SPAWN_COL]).toBe(0);
    expect(g[0]![SPAWN_COL]).toBe(1); // second piece now falling at the top
  });

  it("moveLeft / moveRight / rotate affect the active piece", () => {
    const e = new LuminesEngine();
    e.spawnPiece([[0, 1], [1, 0]]);
    e.moveLeft();
    expect(e.state().grid[0]![SPAWN_COL - 1]).toBe(0);
    e.moveRight();
    e.moveRight();
    expect(e.state().grid[0]![SPAWN_COL + 1]).toBe(0);
    e.rotate(); // [[0,1],[1,0]] -> [[1,0],[0,1]]
    const g = e.state().grid;
    expect(g[0]![SPAWN_COL + 1]).toBe(1);
    expect(g[0]![SPAWN_COL + 2]).toBe(0);
  });

  it("hardDrop locks the piece to the floor immediately", () => {
    const e = new LuminesEngine();
    e.spawnPiece([[1, 1], [1, 1]]);
    e.hardDrop();
    const g = e.state().grid;
    expect(g[ROWS - 1]![SPAWN_COL]).toBe(1);
    expect(g[ROWS - 2]![SPAWN_COL]).toBe(1);
    expect(e.state().score).toBe(0); // no square formed yet
  });

  it("sweepNow clears a built 2x2 and scores cells x squares", () => {
    const e = new LuminesEngine();
    e.spawnPiece([[0, 0], [0, 0]]); // falling
    e.spawnPiece([[1, 1], [1, 1]]); // locks the 0-piece into rows 8-9 cols 7-8
    expect(e.marked()).toHaveLength(4);
    expect(e.countDistinctSquares()).toBe(1);
    e.sweepNow();
    expect(e.state().score).toBe(4); // 4 cells * 1 distinct square
    expect(e.marked()).toHaveLength(0); // the square is gone
  });

  it("game over when the spawn footprint is blocked", () => {
    const e = new LuminesEngine();
    for (let r = 0; r < ROWS; r++) {
      e.stateRef().settled[r]![SPAWN_COL] = 0;
      e.stateRef().settled[r]![SPAWN_COL + 1] = 0;
    }
    e.spawnPiece([[1, 1], [1, 1]]);
    expect(e.state().gameOver).toBe(true);
  });

  it("sweepProgress advances sweepX at 250ms/col and wraps after 4000ms", () => {
    const e = new LuminesEngine();
    e.sweepProgress(MS_PER_COL); // 250ms
    expect(e.state().sweepX).toBeCloseTo(1, 5);
    e.sweepProgress(MS_PER_COL * 3); // +3 cols
    expect(e.state().sweepX).toBeCloseTo(4, 5);
    e.sweepProgress(SWEEP_MS - MS_PER_COL * 4); // reach 4000ms total -> wrap
    expect(e.state().sweepX).toBeLessThan(1); // wrapped back near 0
    expect(MS_PER_COL * COLS).toBe(SWEEP_MS); // 250*16 = 4000
  });
});
