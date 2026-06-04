export type Color = 0 | 1;
export type Cell = Color | null;
export type Grid = Cell[][];
export type Piece = [[Color, Color], [Color, Color]];

export type MoveCommand = "left" | "right" | "softDrop" | "rotate" | "hardDrop";

export interface ActivePiece {
  piece: Piece;
  x: number;
  y: number;
}

export interface MarkedCell {
  row: number;
  col: number;
}

export interface SquareMark {
  row: number;
  col: number;
  color: Color;
  cells: MarkedCell[];
}

export interface LuminesState {
  grid: Grid;
  score: number;
  gameOver: boolean;
  sweepX: number;
}

export interface LuminesSnapshot extends LuminesState {
  settled: Grid;
  active: ActivePiece | null;
  marked: MarkedCell[];
}

export interface LuminesTestApi {
  seed(n: number): void;
  state(): LuminesState;
  marked(): MarkedCell[];
  spawn(piece: Piece): void;
  tick(): void;
  sweepNow(): void;
  sweepProgress(dtMs: number): void;
}

declare global {
  interface Window {
    __lumines?: LuminesTestApi;
  }
}
