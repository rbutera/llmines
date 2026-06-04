import type { Color, Piece } from "./types";

/**
 * mulberry32 — a tiny deterministic 32-bit PRNG. Given the same seed it always
 * produces the same sequence, which is what the test API's seed() relies on.
 *
 * The functions are pure: they take the current state and return the next
 * state alongside the drawn value, so the engine can keep RNG state inside
 * GameState (no hidden globals, no Math.random).
 */

export function seedRng(n: number): number {
  // Normalise to a uint32; avoid a zero state degenerating the generator.
  return (n >>> 0) || 0x9e3779b9;
}

function nextUint32(state: number): { state: number; value: number } {
  let t = (state + 0x6d2b79f5) | 0;
  const nextState = t >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  const value = ((t ^ (t >>> 14)) >>> 0);
  return { state: nextState, value };
}

function nextColor(state: number): { state: number; color: Color } {
  const { state: s, value } = nextUint32(state);
  return { state: s, color: (value & 1) as Color };
}

/** Draw a 2x2 piece with 4 independently-random colours. */
export function randomPiece(state: number): { state: number; piece: Piece } {
  let s = state;
  const draw = () => {
    const r = nextColor(s);
    s = r.state;
    return r.color;
  };
  const tl = draw();
  const tr = draw();
  const bl = draw();
  const br = draw();
  return { state: s, piece: [[tl, tr], [bl, br]] };
}
