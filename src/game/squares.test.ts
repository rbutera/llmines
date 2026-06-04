import { describe, it, expect } from "vitest";
import { computeMarkedGrid, countSquares, markedList } from "./squares";
import { createGrid } from "./board";

describe("squares", () => {
  it("marks a single monochrome 2x2 (4 cells, 1 square)", () => {
    const g = createGrid();
    g[8]![4] = 1;
    g[8]![5] = 1;
    g[9]![4] = 1;
    g[9]![5] = 1;
    expect(countSquares(g)).toBe(1);
    expect(markedList(g)).toHaveLength(4);
  });

  it("does not mark a 2x2 with mixed colours", () => {
    const g = createGrid();
    g[8]![4] = 1;
    g[8]![5] = 0;
    g[9]![4] = 1;
    g[9]![5] = 1;
    expect(countSquares(g)).toBe(0);
    expect(markedList(g)).toHaveLength(0);
  });

  it("counts a 2x3 monochrome block as 2 squares (6 cells marked)", () => {
    const g = createGrid();
    for (let c = 4; c <= 6; c++) {
      g[8]![c] = 0;
      g[9]![c] = 0;
    }
    expect(countSquares(g)).toBe(2);
    expect(markedList(g)).toHaveLength(6);
  });

  it("counts a 3x3 monochrome block as 4 squares (9 cells marked)", () => {
    const g = createGrid();
    for (let r = 7; r <= 9; r++)
      for (let c = 4; c <= 6; c++) g[r]![c] = 1;
    expect(countSquares(g)).toBe(4);
    expect(markedList(g)).toHaveLength(9);
  });

  it("computeMarkedGrid flags exactly the cells in markedList", () => {
    const g = createGrid();
    g[8]![4] = 1;
    g[8]![5] = 1;
    g[9]![4] = 1;
    g[9]![5] = 1;
    const m = computeMarkedGrid(g);
    expect(m[8]![4]).toBe(true);
    expect(m[9]![5]).toBe(true);
    expect(m[0]![0]).toBe(false);
  });
});
