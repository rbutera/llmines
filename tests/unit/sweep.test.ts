import { describe, expect, it } from "vitest";

import { createInitialState, sweepNow } from "~/lib/llmines/engine";

describe("sweep", () => {
  it("clears marked cells, scores, and applies gravity", () => {
    const state = createInitialState();
    state.grid[6]![2] = 1;
    state.grid[8]![2] = 0;
    state.grid[8]![3] = 0;
    state.grid[9]![2] = 0;
    state.grid[9]![3] = 0;

    const swept = sweepNow(state);

    expect(swept.score).toBe(4);
    expect(swept.grid[9]![2]).toBe(1);
    expect(swept.grid[8]![2]).toBeNull();
    expect(swept.grid[9]![3]).toBeNull();
  });

  it("scores overlapping square clears with a distinct-square multiplier", () => {
    const state = createInitialState();
    for (let row = 7; row <= 9; row += 1) {
      for (let col = 4; col <= 6; col += 1) {
        state.grid[row]![col] = 1;
      }
    }

    const swept = sweepNow(state);
    expect(swept.score).toBe(36);
  });
});
