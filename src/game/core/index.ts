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
  hold: HoldState;
}

export interface HoldState {
  active: boolean;
  remainingMs: number;
}

/** Project internal state to the public `state()` shape (composites the piece). */
export function publicState(
  state: GameState,
  hold: HoldState = { active: false, remainingMs: 0 },
): PublicState {
  return {
    grid: viewGrid(state),
    score: state.score,
    gameOver: state.gameOver,
    sweepX: state.sweepX,
    hold,
  };
}
