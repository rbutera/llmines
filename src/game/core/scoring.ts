import {
  ALL_CLEAR_BONUS,
  BIG_CLEAR_BASE,
  BIG_CLEAR_STEP,
  BIG_CLEAR_THRESHOLD,
  COMBO_MIN_SQUARES,
  COLS,
  ROWS,
  SINGLE_COLOUR_BONUS,
  SQUARE_BASE_SCORE,
  STREAK_CURVE,
} from "./constants";
import type { Cell, Grid } from "./types";

/**
 * The faithful single-pass package for `squares` distinct squares cleared this
 * pass (README §3b item 5, audit A7/D1). 1-3 squares = 40 each (40 / 80 / 120);
 * 4+ squares = the big-clear package 640 + 160 per square beyond 4 (4 = 640,
 * 5 = 800, 6 = 960). This package — NOT a linear per-square value — is the base
 * the streak multiplier multiplies. Integer-only.
 */
export function passPackage(squares: number): number {
  if (squares <= 0) return 0;
  if (squares < BIG_CLEAR_THRESHOLD) return squares * SQUARE_BASE_SCORE;
  return BIG_CLEAR_BASE + (squares - BIG_CLEAR_THRESHOLD) * BIG_CLEAR_STEP;
}

/**
 * Faithful Lumines pass score (design D3): the faithful {@link passPackage}
 * multiplied by the cross-pass STREAK multiplier (a documented Lumines II+ house
 * mechanic) when the pass qualifies (>= COMBO_MIN_SQUARES squares):
 *
 *   score = passPackage(squares) * (qualifies ? STREAK_CURVE[min(combo, 3)] : 1)
 *
 * `squares` is the count of distinct squares actually cleared this pass (NOT
 * incidental flood-fill chain extras). Because the big-clear package already
 * contains the single-sweep x4, the streak curve is `[1,2,3,4]`, so a FIRST
 * qualifying pass with no streak pays the bare package (4 squares -> 640, not
 * 2560); consecutive 4-square passes pay 640 -> 1280 -> 1920 -> 2560. Integer-
 * only: every term is an integer, so no float ever enters the score.
 */
export function passScore(squares: number, combo: number): number {
  if (squares <= 0) return 0;
  const pkg = passPackage(squares);
  if (squares < COMBO_MIN_SQUARES) return pkg;
  const idx = Math.min(combo, STREAK_CURVE.length - 1);
  return pkg * STREAK_CURVE[idx]!;
}

/** Next combo count after a pass clearing `squares`: bump on >= 4, else reset. */
export function nextCombo(combo: number, squares: number): number {
  return squares >= COMBO_MIN_SQUARES ? combo + 1 : 0;
}

/**
 * Board-state bonus for the settled grid AFTER a pass.
 *   - all-clear (no locked cells)          -> ALL_CLEAR_BONUS (default 10,000)
 *   - single-colour (>=1 cell, one colour) -> SINGLE_COLOUR_BONUS (default 1,000)
 * All-clear takes precedence (an empty board is not "one colour"). Returns 0 if
 * neither applies. Pure read of the grid.
 */
export function boardStateBonus(grid: Grid): number {
  let count = 0;
  let colour: Cell = null;
  let multiColour = false;
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const cell: Cell = grid[row]![col] ?? null;
      if (cell === null) continue;
      count += 1;
      if (colour === null) colour = cell;
      else if (cell !== colour) multiColour = true;
    }
  }
  if (count === 0) return ALL_CLEAR_BONUS;
  if (!multiColour) return SINGLE_COLOUR_BONUS;
  return 0;
}
