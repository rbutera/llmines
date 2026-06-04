import { describe, it, expect } from "vitest";
import { rotateCW, canFall } from "./piece";
import { createGrid } from "./board";
import type { ActivePiece } from "./types";

describe("piece", () => {
  it("rotateCW rotates the 2x2 90 degrees clockwise", () => {
    expect(rotateCW([[0, 1], [1, 0]])).toEqual([[1, 0], [0, 1]]);
    expect(rotateCW([[0, 0], [1, 1]])).toEqual([[1, 0], [1, 0]]);
  });

  it("four rotations return to the original", () => {
    const start: [[0 | 1, 0 | 1], [0 | 1, 0 | 1]] = [[0, 1], [1, 1]];
    expect(rotateCW(rotateCW(rotateCW(rotateCW(start))))).toEqual(start);
  });

  it("canFall is true over empty space and false at the floor", () => {
    const g = createGrid();
    const a: ActivePiece = { cells: [[0, 0], [0, 0]], row: 0, col: 7 };
    expect(canFall(g, a)).toBe(true);
    a.row = 8; // bottom cells at row 9 (floor)
    expect(canFall(g, a)).toBe(false);
  });

  it("canFall is false when a settled cell blocks below", () => {
    const g = createGrid();
    g[5]![7] = 1; // blocker directly under the left column
    const a: ActivePiece = { cells: [[0, 0], [0, 0]], row: 3, col: 7 };
    expect(canFall(g, a)).toBe(false);
  });
});
