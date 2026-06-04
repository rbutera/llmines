import { describe, expect, it } from "vitest";

import { createInitialState } from "~/lib/llmines/engine";
import { createLuminesTestApi } from "~/lib/llmines/test-api";
import type { GameState } from "~/lib/llmines/types";

describe("test sweep progress API", () => {
  it("advances 250ms per column and 4000ms per traversal", () => {
    let state: GameState = createInitialState();
    const api = createLuminesTestApi(
      () => state,
      (updater) => {
        state = updater(state);
      },
    );

    api.sweepProgress(250);
    expect(api.state().sweepX).toBe(1);
    api.sweepProgress(3_750);
    expect(api.state().sweepX).toBe(16);
  });
});
