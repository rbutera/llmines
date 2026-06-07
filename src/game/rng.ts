// Seeded pseudo-random number generator for LLMines (mulberry32).
// This module is part of the pure game core: it imports nothing from React or PixiJS.
//
// Two complementary APIs are provided:
//  - Pure state-threading helpers (`nextState`, `floatFrom`, `colorFrom`) that take an
//    integer RNG state and return the next state alongside a value. These let the engine
//    store `rngState` on `GameState` and thread it deterministically (Req 18.1).
//  - A stateful object wrapper (`createRng`) for convenient imperative use.
//
// Determinism guarantee: for a given seed, the produced sequence is identical every run
// (Req 2.2, 18.1).

import type { Color } from "./types";

/** Result of advancing the RNG one step: the new state and the raw 32-bit-derived value. */
export interface RngStep {
  /** The next RNG state (a 32-bit integer). */
  state: number;
  /** A float in [0, 1) derived from the new state. */
  value: number;
}

/**
 * Coerce an arbitrary seed input to a valid 32-bit unsigned integer state.
 * Non-integer or NaN inputs default to 0 (Req 18.1). Integers (including negative)
 * are reduced modulo 2^32 via `n >>> 0`.
 */
export function seed(n: number): number {
  if (!Number.isInteger(n)) return 0;
  return n >>> 0;
}

/**
 * One mulberry32 step. Given the current state, returns the next state and a float in
 * [0, 1). This is the raw stepping primitive other helpers build on.
 */
export function mulberry32(state: number): RngStep {
  // Advance the state (matches the canonical mulberry32 where `a` is incremented first).
  const next = (state + 0x6d2b79f5) | 0;
  let t = Math.imul(next ^ (next >>> 15), 1 | next);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return { state: next, value };
}

/** Alias for {@link mulberry32}: advance the RNG state and produce a float in [0, 1). */
export function nextState(state: number): RngStep {
  return mulberry32(state);
}

/** Pure helper: advance the state and return the next float in [0, 1). */
export function floatFrom(state: number): RngStep {
  return mulberry32(state);
}

/** Pure helper: advance the state and return the next Color (0 or 1). */
export function colorFrom(state: number): { state: number; color: Color } {
  const step = mulberry32(state);
  return { state: step.state, color: step.value < 0.5 ? 0 : 1 };
}

/** A stateful RNG object wrapping the pure state-threading helpers. */
export interface Rng {
  /** Return the next float in [0, 1), advancing internal state. */
  nextFloat(): number;
  /** Return the next Color (0 or 1), advancing internal state. */
  nextColor(): Color;
  /** Read the current internal state (e.g. to persist onto GameState). */
  getState(): number;
  /** Overwrite the internal state (e.g. to restore from GameState). */
  setState(state: number): void;
}

/**
 * Create a stateful RNG from a seed. The seed is coerced via {@link seed}.
 * The same seed always yields the same sequence (Req 2.2, 18.1).
 */
export function createRng(seedValue: number): Rng {
  let state = seed(seedValue);
  return {
    nextFloat(): number {
      const step = mulberry32(state);
      state = step.state;
      return step.value;
    },
    nextColor(): Color {
      const step = colorFrom(state);
      state = step.state;
      return step.color;
    },
    getState(): number {
      return state;
    },
    setState(s: number): void {
      state = s;
    },
  };
}
