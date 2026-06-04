import { countSquaresInCells } from "./marking";
import type { ClearedCell } from "./types";

/**
 * Pinned scoring rule: a sweep that deletes cells adds
 *   (cells deleted in that sweep) x (distinct completed 2x2 squares cleared).
 * Examples: 2x2 => 4*1=4; 2x3 => 6*2=12; 3x3 => 9*4=36; three 2x2 => 12*3=36.
 */
export function scoreForClear(cleared: ClearedCell[]): number {
  if (cleared.length === 0) return 0;
  const squares = countSquaresInCells(cleared);
  return cleared.length * squares;
}
