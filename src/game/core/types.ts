// Pure core types — no React / Pixi / DOM / timer imports allowed in this folder.

export type Color = 0 | 1; // A = 0, B = 1
export type Cell = Color | null; // null = empty

/** Grid is indexed [row][col]; row 0 is the TOP. 10 rows x 16 cols. */
export type Grid = Cell[][];

/** 2x2 piece: [topRow, bottomRow], each row = [left, right]. */
export type Piece = [[Color, Color], [Color, Color]];

export type Phase = "start" | "playing" | "gameover";

export interface ActivePiece {
  cells: Piece;
  /** top-left row of the 2x2 origin */
  row: number;
  /** top-left col of the 2x2 origin */
  col: number;
}

export interface MarkedCell {
  row: number;
  col: number;
}

/** A cleared cell remembers its colour so per-traversal square counts are exact. */
export interface ClearedCell extends MarkedCell {
  color: Color;
}

export interface GameState {
  phase: Phase;
  /** SETTLED cells only (does not include the active falling piece). */
  grid: Grid;
  /** current falling piece, or null between lock and next spawn. */
  active: ActivePiece | null;
  score: number;
  /** mirror of phase === "gameover" for the test API. */
  gameOver: boolean;
  /** current sweep column position, 0..GRID_COLS (float). */
  sweepX: number;
  /** mulberry32 RNG state; advances as pieces are generated. */
  rngState: number;
  /** cells cleared so far in the in-progress sweep traversal. */
  sweepCleared: ClearedCell[];
  /** marks frozen at the start of the current traversal (null between traversals). */
  sweepMarkSnapshot: MarkedCell[] | null;
}
