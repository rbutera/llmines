import { describe, expect, it } from "vitest";
import { scoreForClear } from "~/game/core/scoring";
import type { ClearedCell, Color } from "~/game/core/types";

function block(r0: number, c0: number, h: number, w: number, color: Color): ClearedCell[] {
  const out: ClearedCell[] = [];
  for (let r = r0; r < r0 + h; r++) for (let c = c0; c < c0 + w; c++) out.push({ row: r, col: c, color });
  return out;
}

describe("scoring", () => {
  it("scores a single 2x2 as 4 (4 cells x 1 square)", () => {
    expect(scoreForClear(block(0, 0, 2, 2, 0))).toBe(4);
  });

  it("scores a 2x3 region as 12 (6 cells x 2 squares)", () => {
    expect(scoreForClear(block(0, 0, 2, 3, 1))).toBe(12);
  });

  it("scores a 3x3 region as 36 (9 cells x 4 squares)", () => {
    expect(scoreForClear(block(0, 0, 3, 3, 0))).toBe(36);
  });

  it("scores three separate 2x2 squares as 36 (12 cells x 3 squares)", () => {
    const cleared = [
      ...block(0, 0, 2, 2, 0),
      ...block(0, 5, 2, 2, 1),
      ...block(5, 0, 2, 2, 0),
    ];
    expect(scoreForClear(cleared)).toBe(36);
  });

  it("scores nothing when no cells were cleared", () => {
    expect(scoreForClear([])).toBe(0);
  });
});
