import { viewGrid } from "./grid";
import type { GameState, Grid, HoldState } from "./types";

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
  /** Spawn-hold for the currently active piece. */
  hold: HoldState;
}

/** Project internal state to the public `state()` shape (composites the piece). */
export function publicState(state: GameState): PublicState {
  return {
    grid: viewGrid(state),
    score: state.score,
    gameOver: state.gameOver,
    sweepX: state.sweepX,
    hold: state.hold ?? { active: false, remainingMs: 0 },
  };
}
