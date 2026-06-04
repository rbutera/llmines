import { describe, expect, it } from "vitest";

import {
  createInitialState,
  restartRound,
  spawnPiece,
} from "~/lib/llmines/engine";
import type { Piece } from "~/lib/llmines/types";

const piece: Piece = [
  [0, 0],
  [0, 0],
];

describe("game over and restart", () => {
  it("ends the game when spawn cells are occupied", () => {
    const state = createInitialState();
    state.grid[0]![7] = 1;

    const next = spawnPiece(state, piece, { autoSpawn: false });
    expect(next.gameOver).toBe(true);
    expect(next.activePiece).toBeNull();
  });

  it("restart returns to a fresh round", () => {
    const state = restartRound(1);
    expect(state.score).toBe(0);
    expect(state.gameOver).toBe(false);
    expect(state.activePiece).not.toBeNull();
  });
});
