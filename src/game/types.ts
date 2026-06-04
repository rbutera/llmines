export type Color = 0 | 1;
export type Cell = Color | null;
export type Grid = Cell[][];
export type Piece = [[Color, Color], [Color, Color]];

export interface ActivePiece {
  matrix: Piece;
  row: number;
  col: number;
}

export interface MarkedCell {
  row: number;
  col: number;
}

export interface SquareInfo {
  row: number;
  col: number;
  color: Color;
  cells: MarkedCell[];
}

export interface GameSnapshot {
  grid: Grid;
  settled: Grid;
  active: ActivePiece | null;
  score: number;
  gameOver: boolean;
  sweepX: number;
  marked: MarkedCell[];
  distinctSquares: number;
}

export interface LuminesTestApi {
  seed(n: number): void;
  state(): {
    grid: Grid;
    score: number;
    gameOver: boolean;
    sweepX: number;
  };
  marked(): MarkedCell[];
  spawn(piece: Piece): void;
  tick(): void;
  sweepNow(): void;
  sweepProgress(dtMs: number): void;
}
