import { describe, expect, it } from "vitest";
import { GRID_COLS, GRID_ROWS } from "~/game/constants";
import { createGrid } from "~/game/core/grid";
import { applyGravity } from "~/game/core/gravity";

describe("gravity", () => {
  it("drops floating cells to the bottom of their column", () => {
    const g = createGrid();
    g[0]![3] = 1; // floating at top
    const out = applyGravity(g);
    expect(out[GRID_ROWS - 1]![3]).toBe(1);
    expect(out[0]![3]).toBeNull();
  });

  it("collapses a gap and preserves vertical order", () => {
    const g = createGrid();
    g[GRID_ROWS - 1]![0] = 0; // bottom
    g[GRID_ROWS - 3]![0] = 1; // floating above a gap
    const out = applyGravity(g);
    expect(out[GRID_ROWS - 1]![0]).toBe(0);
    expect(out[GRID_ROWS - 2]![0]).toBe(1);
    expect(out[GRID_ROWS - 3]![0]).toBeNull();
  });

  it("leaves a full-but-settled column unchanged", () => {
    const g = createGrid();
    for (let r = 0; r < GRID_ROWS; r++) g[r]![5] = (r % 2) as 0 | 1;
    const out = applyGravity(g);
    for (let r = 0; r < GRID_ROWS; r++) expect(out[r]![5]).toBe((r % 2) as 0 | 1);
    // untouched columns stay empty
    expect(out[GRID_ROWS - 1]![GRID_COLS - 1]).toBeNull();
  });
});
