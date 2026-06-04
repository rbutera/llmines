import { describe, expect, it } from "vitest";

import {
  applyCommand,
  createInitialState,
  hardDrop,
  spawnPiece,
  startRound,
  tick,
  visibleGrid,
} from "~/lib/llmines/engine";
import { SPAWN_COL, SPAWN_ROW } from "~/lib/llmines/constants";
import type { Piece } from "~/lib/llmines/types";

const piece: Piece = [
  [0, 1],
  [1, 0],
];

describe("engine core", () => {
  it("spawns a 2x2 piece at the pinned top-center position", () => {
    const state = spawnPiece(createInitialState(), piece, { autoSpawn: false });

    expect(state.activePiece?.row).toBe(SPAWN_ROW);
    expect(state.activePiece?.col).toBe(SPAWN_COL);
    expect(visibleGrid(state)[0]![7]).toBe(0);
    expect(visibleGrid(state)[0]![8]).toBe(1);
  });

  it("moves, rotates, soft-drops, hard-drops, and locks without crossing bounds", () => {
    let state = spawnPiece(createInitialState(), piece, { autoSpawn: false });
    state = applyCommand(state, "left", { autoSpawn: false });
    expect(state.activePiece?.col).toBe(6);

    state = applyCommand(state, "right", { autoSpawn: false });
    expect(state.activePiece?.col).toBe(7);

    state = applyCommand(state, "rotate", { autoSpawn: false });
    expect(state.activePiece?.piece).toEqual([
      [1, 0],
      [0, 1],
    ]);

    state = applyCommand(state, "softDrop", { autoSpawn: false });
    expect(state.activePiece?.row).toBe(1);

    state = hardDrop(state, { autoSpawn: false });
    expect(state.activePiece).toBeNull();
    expect(state.grid[8]![7]).toBe(1);
    expect(state.grid[9]![8]).toBe(1);
  });

  it("auto-spawns a new piece in normal play after a lock", () => {
    const state = hardDrop(startRound(2), { autoSpawn: true });
    expect(state.activePiece).not.toBeNull();
    expect(state.gameOver).toBe(false);
  });

  it("test-mode tick does not auto-spawn after lock", () => {
    let state = spawnPiece(createInitialState(), piece, { autoSpawn: false });
    for (let i = 0; i < 10; i += 1) {
      state = tick(state, { autoSpawn: false });
    }
    expect(state.activePiece).toBeNull();
  });
});
