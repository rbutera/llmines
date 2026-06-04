import { describe, it, expect } from "vitest";
import {
  createGrid,
  cloneGrid,
  applyGravity,
  footprintValid,
  stampPiece,
  mergeActive,
} from "./board";
import { COLS, ROWS } from "./constants";
import type { ActivePiece } from "./types";

describe("board", () => {
  it("createGrid is ROWS x COLS of null", () => {
    const g = createGrid();
    expect(g.length).toBe(ROWS);
    expect(g[0]!.length).toBe(COLS);
    expect(g.flat().every((c) => c === null)).toBe(true);
  });

  it("cloneGrid is a deep copy", () => {
    const g = createGrid();
    const c = cloneGrid(g);
    c[0]![0] = 1;
    expect(g[0]![0]).toBe(null);
  });

  it("applyGravity compacts non-null cells to the bottom of each column", () => {
    const g = createGrid();
    g[0]![3] = 1; // floating
    g[9]![3] = 0; // floor
    applyGravity(g);
    expect(g[9]![3]).toBe(0);
    expect(g[8]![3]).toBe(1);
    expect(g[0]![3]).toBe(null);
  });

  it("footprintValid rejects out-of-bounds and occupied cells", () => {
    const g = createGrid();
    expect(footprintValid(g, 0, 7)).toBe(true);
    expect(footprintValid(g, ROWS - 1, 7)).toBe(false); // bottom row would overflow
    expect(footprintValid(g, 0, COLS - 1)).toBe(false); // right col would overflow
    g[1]![7] = 0;
    expect(footprintValid(g, 0, 7)).toBe(false); // occupied
  });

  it("stampPiece writes the 2x2 into the grid", () => {
    const g = createGrid();
    const p: ActivePiece = { cells: [[0, 1], [1, 0]], row: 0, col: 7 };
    stampPiece(g, p);
    expect(g[0]![7]).toBe(0);
    expect(g[0]![8]).toBe(1);
    expect(g[1]![7]).toBe(1);
    expect(g[1]![8]).toBe(0);
  });

  it("mergeActive overlays the active piece without mutating settled", () => {
    const g = createGrid();
    const p: ActivePiece = { cells: [[1, 1], [1, 1]], row: 0, col: 7 };
    const merged = mergeActive(g, p);
    expect(merged[0]![7]).toBe(1);
    expect(g[0]![7]).toBe(null); // settled untouched
  });
});
