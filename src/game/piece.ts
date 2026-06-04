import { footprintValid } from "./board";
import type { ActivePiece, Grid, Piece } from "./types";

// [[a,b],[c,d]] -> [[c,a],[d,b]]
export function rotateCW(p: Piece): Piece {
  return [
    [p[1][0], p[0][0]],
    [p[1][1], p[0][1]],
  ];
}

// Can the active piece move down one row? (footprint check on settled grid)
export function canFall(settled: Grid, a: ActivePiece): boolean {
  return footprintValid(settled, a.row + 1, a.col);
}
