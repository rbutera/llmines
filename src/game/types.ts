export type Color = 0 | 1;
export type Cell = Color | null;
export type Grid = Cell[][]; // [row][col], row 0 = top
export type Piece = [[Color, Color], [Color, Color]]; // [topRow, bottomRow]

export interface ActivePiece {
  cells: Piece;
  row: number; // top row of the 2x2
  col: number; // left col of the 2x2
}

export interface MarkedCell {
  row: number;
  col: number;
}

export interface GameState {
  settled: Grid; // always bottom-packed (no floating cells)
  active: ActivePiece | null;
  score: number;
  gameOver: boolean;
  sweepX: number; // 0..COLS
  rngState: number;
  // Snapshot for the current sweep pass:
  sweepMarked: boolean[][] | null;
  sweepSquares: number;
  sweepNextCol: number;
}
