/** The two block colours. Empty cell = null. */
export type Color = 0 | 1;
export type Cell = Color | null;

/** 10 rows × 16 cols. Row 0 = top. */
export type Grid = Cell[][];

/** A 2×2 piece definition: [topRow, bottomRow], each [left, right]. */
export type PieceDef = [[Color, Color], [Color, Color]];

/** The active falling piece with position. */
export interface ActivePiece {
  cells: PieceDef;
  row: number; // top-left row
  col: number; // top-left col
}

/** Marked cell coordinate. */
export interface MarkedCell {
  row: number;
  col: number;
}

/** Full game state. */
export interface GameState {
  grid: Grid; // settled cells only (no active piece)
  activePiece: ActivePiece | null;
  markedCells: Set<string>; // "row,col" keys
  score: number;
  sweepX: number; // 0–16 float
  gameOver: boolean;
  // Accumulators for current sweep traversal
  sweepCellsDeleted: number;
  sweepSquaresCleared: number;
  lastSweepColumn: number; // last integer column the sweep cleared (-1 at start)
}

/** State snapshot returned by test API. */
export interface StateSnapshot {
  grid: Grid;
  score: number;
  gameOver: boolean;
  sweepX: number;
}

/** The test API interface exposed on window.__lumines. */
export interface LuminesTestApi {
  seed(n: number): void;
  state(): StateSnapshot;
  marked(): MarkedCell[];
  spawn(piece: PieceDef): void;
  tick(): void;
  sweepNow(): void;
  sweepProgress(dtMs: number): void;
}

declare global {
  interface Window {
    __lumines?: LuminesTestApi;
  }
}
