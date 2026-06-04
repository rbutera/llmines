import type { Color } from "./types";

/**
 * mulberry32 — a tiny, well-known deterministic 32-bit PRNG. Pure: takes a
 * state, returns the next state plus a value. No global mutable state, so the
 * RNG can live inside GameState and be seeded reproducibly.
 */

/** Normalise an arbitrary seed into a uint32 state. */
export function seedState(n: number): number {
  // Force into uint32 range; mix a little so seed(0) isn't degenerate.
  return (Math.trunc(n) ^ 0x9e3779b9) >>> 0;
}

/** Advance the state and return [nextState, float in [0,1)]. */
export function nextFloat(state: number): [number, number] {
  const t = (state + 0x6d2b79f5) >>> 0;
  let x = t;
  x = Math.imul(x ^ (x >>> 15), x | 1);
  x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
  const value = ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  return [t, value];
}

/** Advance the state and return [nextState, bit as Color]. */
export function nextBit(state: number): [number, Color] {
  const [next, value] = nextFloat(state);
  return [next, value < 0.5 ? 0 : 1];
}
