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

/**
 * Draw a fresh per-game random SEED (a uint32), used by production to seed a new
 * run so every game deals a different sequence (audit A4). Prefers a
 * cryptographic source (`crypto.getRandomValues`); falls back to a time-derived
 * value when crypto is unavailable (older SSR/Node contexts).
 *
 * This is the ONLY function in the core that touches a non-deterministic source,
 * and it is NOT called by any pure game op — the core stays a pure function of
 * (seed, inputs). Tests always pass an explicit seed, so the determinism
 * contract is untouched. The `Math.random` in the fallback is deliberate and
 * confined to this seed-draw (never used inside gameplay).
 */
export function randomSeed(): number {
  const g = globalThis as { crypto?: { getRandomValues?: typeof crypto.getRandomValues } };
  if (g.crypto?.getRandomValues) {
    return g.crypto.getRandomValues(new Uint32Array(1))[0]!;
  }
  return (Date.now() ^ (Math.random() * 2 ** 32)) >>> 0;
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
