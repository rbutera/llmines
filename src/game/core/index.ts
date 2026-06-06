import { computeMarked } from "./detect";
import { viewGrid } from "./grid";
import type { GameState, Grid } from "./types";

export * from "./types";
export * from "./constants";
export * from "./rng";
export * from "./grid";
export * from "./piece";
export * from "./detect";
export * from "./sweep";

/** Public, serialisable projection of state for the test interface. */
export interface PublicState {
  grid: Grid;
  score: number;
  gameOver: boolean;
  sweepX: number;
  /**
   * Additive (this change): number of distinct completed 2x2 squares in the
   * settled grid by the overlap-counting detection (mono WxH -> (W-1)(H-1)).
   * Exposed so the eval can assert detection without reading internals. Existing
   * fields above are unchanged in shape.
   */
  distinctSquares: number;
}

/** Project internal state to the public `state()` shape (composites the piece). */
export function publicState(state: GameState): PublicState {
  return {
    grid: viewGrid(state),
    score: state.score,
    gameOver: state.gameOver,
    sweepX: state.sweepX,
    // Detection is over the settled grid (matches `marked()` semantics); the
    // active falling piece is excluded until it locks.
    distinctSquares: computeMarked(state.grid).distinctSquares,
  };
}
