import { describe, expect, it } from "vitest";
import { GRID_COLS, GRID_ROWS, SPAWN_COL, SPAWN_ROW } from "~/game/constants";
import { createGrid } from "~/game/core/grid";
import {
  collides,
  pieceCells,
  rotateCells,
  spawnPiece,
  tryFall,
  tryMove,
  tryRotate,
} from "~/game/core/piece";
import type { Piece } from "~/game/core/types";

const P: Piece = [
  [0, 1],
  [1, 0],
];

describe("piece", () => {
  it("spawns at the pinned top-centre position (cols 7-8, rows 0-1)", () => {
    const p = spawnPiece(P);
    expect(p.row).toBe(SPAWN_ROW);
    expect(p.col).toBe(SPAWN_COL);
    const cells = pieceCells(p);
    expect(cells.map((c) => [c.row, c.col])).toEqual([
      [0, 7],
      [0, 8],
      [1, 7],
      [1, 8],
    ]);
  });

  it("moves left/right when clear and refuses to leave the grid", () => {
    const g = createGrid();
    const p = { cells: P, row: 4, col: 4 };
    expect(tryMove(g, p, -1)?.col).toBe(3);
    expect(tryMove(g, p, +1)?.col).toBe(5);
    const atLeftWall = { cells: P, row: 4, col: 0 };
    expect(tryMove(g, atLeftWall, -1)).toBeNull();
    const atRightWall = { cells: P, row: 4, col: GRID_COLS - 2 };
    expect(tryMove(g, atRightWall, +1)).toBeNull();
  });

  it("refuses to move into a settled cell", () => {
    const g = createGrid();
    g[4]![3] = 0; // occupy to the left
    const p = { cells: P, row: 4, col: 4 };
    expect(tryMove(g, p, -1)).toBeNull();
  });

  it("rotates the 2x2 colour matrix 90deg clockwise", () => {
    // [[0,1],[1,0]] CW -> [[1,0],[0,1]]
    expect(rotateCells(P)).toEqual([
      [1, 0],
      [0, 1],
    ]);
  });

  it("rejects a rotation that would not fit in bounds", () => {
    const g = createGrid();
    // place piece flush against the right wall: occupies last two cols, still 2x2 so rotation fits;
    // instead block a neighbour cell so the rotated piece collides identically — rotation of a 2x2
    // keeps the same footprint, so verify rejection when the footprint overlaps a settled cell.
    g[5]![GRID_COLS - 1] = 1;
    const p = { cells: P, row: 4, col: GRID_COLS - 2 };
    // footprint rows 4-5, cols 14-15; (5,15) occupied -> any placement there collides
    expect(collides(g, { ...p, cells: rotateCells(p.cells) })).toBe(true);
    expect(tryRotate(g, p)).toBeNull();
  });

  it("falls until it reaches the floor", () => {
    const g = createGrid();
    let p = { cells: P, row: SPAWN_ROW, col: SPAWN_COL };
    let steps = 0;
    for (;;) {
      const next = tryFall(g, p);
      if (!next) break;
      p = next;
      steps++;
      if (steps > 100) throw new Error("did not settle");
    }
    // 2x2 piece bottom row rests on the floor (row GRID_ROWS-1)
    expect(p.row + 1).toBe(GRID_ROWS - 1);
  });
});
