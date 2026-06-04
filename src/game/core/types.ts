/**
 * Pure game-core types. No React / Pixi / DOM / time imports anywhere in
 * `src/game/core/**` — this module is the single source of truth and is fully
 * unit-testable.
 */

/** The two block colours: A = 0, B = 1. */
export type Color = 0 | 1;

/** A grid cell: a colour, or null when empty. */
export type Cell = Color | null;

/** Grid is addressed `grid[row][col]`; row 0 = TOP. 10 rows x 16 cols. */
export type Grid = Cell[][];

/** A 2x2 piece: [topRow, bottomRow], each row [left, right]. */
export type Piece = [[Color, Color], [Color, Color]];

/** Position of a piece's top-left cell. */
export interface PiecePos {
  row: number;
  col: number;
}

/** The active, still-falling piece. */
export interface ActivePiece {
  cells: Piece;
  pos: PiecePos;
}

/** A marked cell coordinate. */
export interface MarkedCell {
  row: number;
  col: number;
}

/** Result of square detection over the settled grid. */
export interface MarkResult {
  marked: MarkedCell[];
  /** Number of distinct completed 2x2 squares (by top-left corner). */
  distinctSquares: number;
}

/**
 * Internal sweep-pass tracking. A "pass" is one full left-to-right traversal.
 * The marked set + distinct-square count are snapshotted at pass start (design
 * D5) so deletion is column-by-column but scoring is per completed pass. Not
 * exposed by the test `state()`.
 */
export interface SweepPass {
  /** Snapshot: rows marked for deletion, grouped by column. */
  markedByCol: number[][];
  /** Snapshot: distinct completed 2x2 squares present at pass start. */
  distinctSquares: number;
  /** Cells actually deleted so far this pass. */
  deletedCount: number;
  /** Columns already processed (0..COLS). */
  processedCols: number;
}

/**
 * Full deterministic game state. Settled stack (`grid`) and the falling piece
 * (`active`) are kept distinct internally; `viewGrid()` composites them.
 */
export interface GameState {
  grid: Grid;
  active: ActivePiece | null;
  score: number;
  gameOver: boolean;
  /** Sweep column position, float in [0, 16]. */
  sweepX: number;
  /** Mulberry32 RNG state (uint32). */
  rngState: number;
  /** Active sweep pass, or null when none is in progress. Internal. */
  sweepPass?: SweepPass | null;
}
