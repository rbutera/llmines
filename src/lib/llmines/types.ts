export type Color = 0 | 1;
export type Cell = Color | null;
export type Grid = Cell[][];
export type Piece = [[Color, Color], [Color, Color]];

export interface Coord {
  row: number;
  col: number;
}

export interface ActivePiece {
  piece: Piece;
  row: number;
  col: number;
}

export interface MarkedSquare {
  row: number;
  col: number;
  color: Color;
  cells: Coord[];
  key: string;
}

export interface ClearEvent {
  row: number;
  col: number;
  color: Color;
  at: number;
}

export interface CollapseEvent {
  fromRow: number;
  toRow: number;
  col: number;
  color: Color;
  at: number;
}

export interface SweepState {
  x: number;
  deletedCellsThisSweep: number;
  clearedSquareKeysThisSweep: string[];
  lastPassedColumns: number[];
}

export interface GameState {
  grid: Grid;
  activePiece: ActivePiece | null;
  score: number;
  gameOver: boolean;
  sweep: SweepState;
  rngSeed: number;
  lastClears: ClearEvent[];
  lastCollapses: CollapseEvent[];
}

export type InputCommand =
  | "left"
  | "right"
  | "softDrop"
  | "rotate"
  | "hardDrop";

export interface EngineOptions {
  autoSpawn: boolean;
}
