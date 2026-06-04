import { describe, expect, it } from "vitest";

import { COLS, LuminesEngine, ROWS, SPAWN_X, SWEEP_PERIOD_MS } from "./engine";
import type { Piece } from "./types";

function lockActive(engine: LuminesEngine) {
  for (let i = 0; i < ROWS + 1; i += 1) {
    engine.tick();
  }
}

describe("LuminesEngine", () => {
  it("spawns a provided 2x2 piece at the pinned top-center position", () => {
    const engine = new LuminesEngine({ autoSpawn: false });
    engine.reset(false);
    engine.spawn([
      [0, 1],
      [1, 0],
    ]);

    const grid = engine.state().grid;
    expect(grid).toHaveLength(ROWS);
    expect(grid[0]).toHaveLength(COLS);
    expect(grid[0]?.[SPAWN_X]).toBe(0);
    expect(grid[0]?.[SPAWN_X + 1]).toBe(1);
    expect(grid[1]?.[SPAWN_X]).toBe(1);
    expect(grid[1]?.[SPAWN_X + 1]).toBe(0);
  });

  it("moves, rotates, hard-drops, and locks without auto-spawning in test mode", () => {
    const engine = new LuminesEngine({ autoSpawn: false });
    engine.reset(false);
    engine.spawn([
      [0, 1],
      [1, 1],
    ]);

    engine.command("left");
    expect(engine.state().grid[0]?.[SPAWN_X - 1]).toBe(0);

    engine.command("rotate");
    const rotated = engine.state().grid;
    expect(rotated[0]?.[SPAWN_X - 1]).toBe(1);
    expect(rotated[0]?.[SPAWN_X]).toBe(0);

    engine.command("hardDrop");
    const locked = engine.snapshot();
    expect(locked.active).toBeNull();
    expect(locked.grid[ROWS - 2]?.[SPAWN_X - 1]).toBe(1);
  });

  it("detects all aligned 2x2 squares in larger monochrome regions", () => {
    const engine = new LuminesEngine({ autoSpawn: false });
    engine.reset(false);
    const square: Piece = [
      [0, 0],
      [0, 0],
    ];
    engine.spawn(square);
    lockActive(engine);
    engine.spawn(square);
    lockActive(engine);

    expect(engine.marked()).toHaveLength(8);
    engine.sweepNow();

    expect(engine.state().score).toBe(24);
    expect(engine.state().grid.flat().filter((cell) => cell !== null)).toHaveLength(0);
  });

  it("clears one square with pinned scoring and collapses cells above deleted cells", () => {
    const engine = new LuminesEngine({ autoSpawn: false });
    engine.reset(false);
    engine.spawn([
      [0, 0],
      [0, 0],
    ]);
    lockActive(engine);
    engine.spawn([
      [1, 0],
      [0, 1],
    ]);
    lockActive(engine);

    expect(engine.marked()).toHaveLength(4);
    engine.sweepNow();

    const state = engine.state();
    expect(state.score).toBe(4);
    expect(state.grid[ROWS - 2]?.[SPAWN_X]).toBe(1);
    expect(state.grid[ROWS - 2]?.[SPAWN_X + 1]).toBe(0);
    expect(state.grid[ROWS - 1]?.[SPAWN_X]).toBe(0);
    expect(state.grid[ROWS - 1]?.[SPAWN_X + 1]).toBe(1);
  });

  it("advances sweep timing deterministically and wraps after one traversal", () => {
    const engine = new LuminesEngine({ autoSpawn: false });
    engine.reset(false);

    engine.sweepProgress(250);
    expect(engine.state().sweepX).toBe(1);

    engine.sweepProgress(SWEEP_PERIOD_MS - 250);
    expect(engine.state().sweepX).toBe(0);
  });

  it("uses seeded randomness for repeatable generated pieces", () => {
    const first = new LuminesEngine({ autoSpawn: true });
    const second = new LuminesEngine({ autoSpawn: true });
    first.seed(42);
    second.seed(42);
    first.reset(true);
    second.reset(true);

    expect(first.state().grid).toEqual(second.state().grid);
  });

  it("enters game over when spawn cells are blocked", () => {
    const engine = new LuminesEngine({ autoSpawn: false });
    engine.reset(false);
    engine.spawn([
      [0, 0],
      [0, 0],
    ]);
    engine.spawn([
      [1, 1],
      [1, 1],
    ]);

    expect(engine.state().gameOver).toBe(true);
  });
});
