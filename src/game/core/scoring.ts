import {
  ALL_CLEAR_BONUS,
  COMBO_CURVE,
  COMBO_MIN_SQUARES,
  COLS,
  ROWS,
  SINGLE_COLOUR_BONUS,
  SQUARE_BASE_SCORE,
} from "./constants";
import type { Grid } from "./types";

/**
 * Faithful Lumines pass score. Replaces the prior `deletedCount * distinctSquares`
 * rule.
 *
 *   score = squares * 40 * multiplier
 *
 * where `squares` is the count of distinct snapshot squares actually cleared
 * this pass (NOT incidental flood-fill chain extras), and `multiplier` is 1
 * unless the pass cleared >= 4 squares, in which case it is read from the combo
 * curve indexed by the consecutive-qualifying-pass count, capped at the final
 * entry. Integer-only: every term (40, the curve values) is an integer, so no
 * float ever enters the score.
 */
export function passScore(squares: number, combo: number): number {
  if (squares <= 0) return 0;
  const base = squares * SQUARE_BASE_SCORE;
  if (squares < COMBO_MIN_SQUARES) return base;
  const idx = Math.min(combo, COMBO_CURVE.length - 1);
  return base * COMBO_CURVE[idx]!;
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
  let colour: number | null = null;
  let multiColour = false;
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const cell = grid[row]![col];
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
