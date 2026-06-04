import { HOLD_MS } from "./constants";
import type { GameState, HoldState } from "./types";

/** A fresh, active hold for a just-spawned block. */
export function freshHold(): HoldState {
  return { active: true, remainingMs: HOLD_MS };
}

/** An inactive hold (no block is waiting). */
export function noHold(): HoldState {
  return { active: false, remainingMs: 0 };
}

/** True while a spawned block is holding at the top (descent suppressed). */
export function isHolding(state: GameState): boolean {
  return state.active !== null && state.hold.active;
}

/**
 * Advance the hold timer by `dtMs` without moving the piece. Releases the hold
 * (back to `noHold()`) once the window reaches zero. No-op when not holding.
 */
export function tickHold(state: GameState, dtMs: number): GameState {
  if (!state.hold.active) return state;
  const remainingMs = state.hold.remainingMs - dtMs;
  if (remainingMs <= 0) return { ...state, hold: noHold() };
  return { ...state, hold: { active: true, remainingMs } };
}

/** Cancel the hold immediately (a fresh deliberate drop press). */
export function releaseHold(state: GameState): GameState {
  if (!state.hold.active) return state;
  return { ...state, hold: noHold() };
}
