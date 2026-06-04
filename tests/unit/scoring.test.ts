import { describe, expect, it } from "vitest";

import { calculateSweepScore } from "~/lib/llmines/scoring";

describe("scoring", () => {
  it("multiplies deleted cells by distinct cleared squares", () => {
    expect(calculateSweepScore(4, 1)).toBe(4);
    expect(calculateSweepScore(6, 3)).toBe(18);
  });

  it("does not score empty clears", () => {
    expect(calculateSweepScore(0, 4)).toBe(0);
    expect(calculateSweepScore(4, 0)).toBe(0);
  });
});
