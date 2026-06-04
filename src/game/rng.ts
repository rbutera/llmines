import type { Color, Piece } from "./types";

// mulberry32. Returns [value in [0,1), nextState].
export function nextRandom(state: number): [number, number] {
  let a = state | 0;
  a = (a + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return [value, a];
}

// Draw four colours (top-left, top-right, bottom-left, bottom-right).
export function nextPiece(state: number): [Piece, number] {
  let s = state;
  const draw = (): Color => {
    const [v, ns] = nextRandom(s);
    s = ns;
    return v < 0.5 ? 0 : 1;
  };
  const piece: Piece = [
    [draw(), draw()],
    [draw(), draw()],
  ];
  return [piece, s];
}
