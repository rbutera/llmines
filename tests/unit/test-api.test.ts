import { describe, expect, it } from "vitest";

import { createInitialState } from "~/lib/llmines/engine";
import { createLuminesTestApi } from "~/lib/llmines/test-api";
import type { GameState, Piece } from "~/lib/llmines/types";

const piece: Piece = [
  [0, 0],
  [0, 0],
];

describe("test API", () => {
  it("spawns, snapshots, ticks without auto-spawn, and reports marked cells", () => {
    let state: GameState = createInitialState();
    const api = createLuminesTestApi(
      () => state,
      (updater) => {
        state = updater(state);
      },
    );

    api.seed(12);
    api.spawn(piece);
    expect(api.state().grid[0]![7]).toBe(0);

    for (let i = 0; i < 10; i += 1) api.tick();
    expect(api.state().grid[8]![7]).toBe(0);
    expect(api.state().grid[0]![7]).toBeNull();
    expect(api.marked()).toHaveLength(4);
  });
});
