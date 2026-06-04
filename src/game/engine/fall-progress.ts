import { isResting, type GameState } from "../core";

/**
 * How far (0..1) the active piece should be visually interpolated toward the
 * next gravity row, for smooth descent in the renderer.
 *
 * The active piece is drawn separately from the settled stack and offset by
 * `fallProgress * CELL`. That offset is only meaningful while the piece can
 * actually descend. When the piece is **resting** (its next row is illegal —
 * the bottom row, or atop the stack), there is no row to fall into, so the
 * progress must be 0; otherwise the accumulating gravity timer would drag the
 * resting piece below its row and past the canvas bottom before it locks.
 */
export function computeFallProgress(
  state: GameState,
  gravityAccumMs: number,
  intervalMs: number,
  testMode: boolean,
): number {
  if (testMode) return 0;
  if (!state.active) return 0;
  if (isResting(state)) return 0;
  return Math.max(0, Math.min(1, gravityAccumMs / intervalMs));
}
