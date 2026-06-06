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

/**
 * A generated piece plus its (generation-time) chain-special decision. The
 * special is decided when the piece is generated so it can be shown in the
 * preview queue before it spawns. `cellIndex` is 0..3 reading the 2x2 in
 * row-major order: 0 = top-left, 1 = top-right, 2 = bottom-left, 3 = bottom-right.
 */
export interface GeneratedPiece {
  cells: Piece;
  /** Present when this piece carries a chain special on one of its cells. */
  special?: { cellIndex: 0 | 1 | 2 | 3 };
}

/** The active, still-falling piece. */
export interface ActivePiece {
  cells: Piece;
  pos: PiecePos;
  /** If this piece carries a chain special, which of its 4 cells holds it. */
  special?: { cellIndex: 0 | 1 | 2 | 3 };
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
  /**
   * Snapshot of which cells are marked for deletion, as a ROWS x COLS boolean
   * grid (`marks[row][col]`). Identity-based, NOT a fixed (row,col) list: when a
   * chain flood empties cells and the column settles, the marks fall with their
   * cells (mark-aware settle), so the bar always deletes the originally-marked
   * cell wherever gravity has since moved it — never an innocent cell that
   * happened to land on a stale snapshot row.
   */
  marks: boolean[][];
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
  /**
   * Consecutive qualifying-pass count (each clearing >= 4 squares). Indexes the
   * combo multiplier curve; reset to 0 by any pass clearing < 4 squares.
   */
  combo: number;
  /**
   * Coordinates (`row * COLS + col`) of settled cells that carry a chain
   * special. Sparse; parallel to the cell colour in `grid`.
   */
  specials: Set<number>;
  /**
   * Pre-generated upcoming pieces (depth >= PREVIEW_DEPTH + 1). The head spawns
   * next; drawn in the canonical RNG order so a seeded run is reproducible.
   */
  queue: GeneratedPiece[];
  /** Index into the ordered skin list (progression). */
  skinIndex: number;
  /** Squares cleared within the current skin (drives skin advancement). */
  clearsInSkin: number;
}
