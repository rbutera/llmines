import { describe, expect, it } from "vitest";

import { createEmptyGrid } from "~/lib/llmines/grid";
import {
  detectSquares,
  markedCellsFromSquares,
} from "~/lib/llmines/square-detection";

describe("square detection", () => {
  it("counts one monochrome 2x2 square by top-left coordinate", () => {
    const grid = createEmptyGrid();
    grid[7]![3] = 0;
    grid[7]![4] = 0;
    grid[8]![3] = 0;
    grid[8]![4] = 0;

    const squares = detectSquares(grid);
    expect(squares).toHaveLength(1);
    expect(squares[0]).toMatchObject({ row: 7, col: 3, color: 0 });
    expect(markedCellsFromSquares(squares)).toHaveLength(4);
  });

  it("counts overlapping squares in larger monochrome regions", () => {
    const grid = createEmptyGrid();
    for (let row = 5; row <= 7; row += 1) {
      for (let col = 4; col <= 6; col += 1) {
        grid[row]![col] = 1;
      }
    }

    expect(detectSquares(grid)).toHaveLength(4);
  });

  it("counts a 2x3 region as two distinct squares", () => {
    const grid = createEmptyGrid();
    for (let row = 6; row <= 7; row += 1) {
      for (let col = 1; col <= 3; col += 1) {
        grid[row]![col] = 0;
      }
    }

    expect(detectSquares(grid)).toHaveLength(2);
  });
});
