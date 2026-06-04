/** The two block colours: A = 0, B = 1. */
export type Color = 0 | 1;

/** A single grid cell: a colour, or null when empty. */
export type Cell = Color | null;

/** The grid is indexed [row][col]; row 0 is the TOP. 16 cols x 10 rows. */
export type Grid = Cell[][];

/**
 * A falling piece: a 2x2 of colours, ordered [topRow, bottomRow], each row
 * [leftCol, rightCol]. Matches the test API `Piece` shape.
 */
export type Piece = [[Color, Color], [Color, Color]];

/** The active falling piece plus its top-left position on the grid. */
export interface ActivePiece {
  cells: Piece;
  /** Column of the top-left cell. */
  col: number;
  /** Row of the top-left cell. */
  row: number;
}

/** A grid coordinate. */
export interface CellCoord {
  row: number;
  col: number;
}

export type Phase = "start" | "playing" | "gameover";

/** Snapshot returned by the public test API `state()`. */
export interface PublicState {
  grid: Grid;
  score: number;
  gameOver: boolean;
  /** Current sweep column position, 0..16 (float ok). */
  sweepX: number;
}
