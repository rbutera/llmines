import { describe, expect, it } from "vitest";

import { createInitialState, sweepProgress } from "~/lib/llmines/engine";
import { sweepXFromElapsedMs } from "~/lib/llmines/sweep";

describe("sweep timing", () => {
  it("maps 250ms to one column and 4000ms to a full traversal", () => {
    expect(sweepXFromElapsedMs(250)).toBe(1);
    expect(sweepXFromElapsedMs(4_000)).toBe(16);
  });

  it("advances deterministic progress exactly", () => {
    let state = createInitialState();
    state = sweepProgress(state, 250);
    expect(state.sweep.x).toBe(1);
    state = sweepProgress(state, 3_750);
    expect(state.sweep.x).toBe(16);
  });
});
