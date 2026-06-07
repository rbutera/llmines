// Core data models for LLMines.
// This module is part of the pure game core: it imports nothing from React or PixiJS.

/** A cell colour: exactly two values. 0 = Color A, 1 = Color B (Req 1.3). */
export type Color = 0 | 1;

/** A single grid cell: empty (`null`) or one of the two colours. */
export type Cell = Color | null;

/**
 * The Playfield grid, addressed `[row][col]` with row 0 at the top and col 0
 * at the left. Sized 10 rows x 16 cols (Req 17.2).
 */
export type Grid = Cell[][];

/**
 * A 2x2 block of four independently-coloured cells, ordered
 * `[topRow, bottomRow]`, each row `[leftCol, rightCol]` (Glossary).
 */
export type Piece = [[Color, Color], [Color, Color]];

/** The block currently falling under player control, plus its top-left position. */
export interface ActiveBlock {
  piece: Piece;
  /** Row of the block's top cells. */
  row: number;
  /** Column of the block's left cells. */
  col: number;
}

/** The single immutable source of truth for the game (Req 17). */
export interface GameState {
  /** Settled Stack only; the Active_Block is kept separate in `active`. */
  grid: Grid;
  /** Current falling block, or `null` when the field is quiescent. */
  active: ActiveBlock | null;
  /** Marked designation per Stack cell, addressed `[row][col]` (Req 5). */
  marked: boolean[][];
  /** Cumulative player score (Req 7). */
  score: number;
  /** Whether the game has ended (Req 9). */
  gameOver: boolean;
  /** Timeline_Bar position, a continuous value in `[0, COLS]` (Req 17.1). */
  sweepX: number;
  /** Whether soft-drop is currently active (Req 4.3). */
  softDrop: boolean;
  /** Current seeded RNG state (Req 18.1). */
  rngState: number;
}
