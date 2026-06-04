import { describe, expect, it } from "vitest";
import { createGrid } from "~/game/core/grid";
import { distinctSquares, markedCells } from "~/game/core/marking";
import type { Color, Grid } from "~/game/core/types";

/** Fill a w x h block of one colour with its top-left at (r0,c0). */
function fillBlock(g: Grid, r0: number, c0: number, h: number, w: number, color: Color) {
  for (let r = r0; r < r0 + h; r++) for (let c = c0; c < c0 + w; c++) g[r]![c] = color;
}

describe("marking", () => {
  it("marks a 2x2 monochrome square (4 cells, 1 distinct square)", () => {
    const g = createGrid();
    fillBlock(g, 4, 4, 2, 2, 0);
    expect(markedCells(g)).toHaveLength(4);
    expect(distinctSquares(g)).toBe(1);
  });

  it("counts a 2x3 region as 2 distinct squares and marks all 6 cells", () => {
    const g = createGrid();
    fillBlock(g, 2, 2, 2, 3, 1); // 2 rows x 3 cols
    expect(markedCells(g)).toHaveLength(6);
    expect(distinctSquares(g)).toBe(2);
  });

  it("counts a 3x3 region as 4 distinct squares and marks all 9 cells", () => {
    const g = createGrid();
    fillBlock(g, 1, 1, 3, 3, 0);
    expect(markedCells(g)).toHaveLength(9);
    expect(distinctSquares(g)).toBe(4);
  });

  it("does not mark a mixed-colour 2x2", () => {
    const g = createGrid();
    g[5]![5] = 0;
    g[5]![6] = 1;
    g[6]![5] = 0;
    g[6]![6] = 0;
    expect(markedCells(g)).toHaveLength(0);
    expect(distinctSquares(g)).toBe(0);
  });
});
