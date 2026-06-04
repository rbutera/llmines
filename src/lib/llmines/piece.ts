import type { Piece } from "./types";

export function rotatePieceClockwise(piece: Piece): Piece {
  return [
    [piece[1][0], piece[0][0]],
    [piece[1][1], piece[0][1]],
  ];
}
