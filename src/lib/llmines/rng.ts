import type { Color, Piece } from "./types";

const MODULUS = 2_147_483_647;
const MULTIPLIER = 48_271;

export function normalizeSeed(seed: number) {
  const normalized = Math.trunc(seed) % MODULUS;
  return normalized > 0 ? normalized : normalized + MODULUS - 1;
}

export function nextSeed(seed: number) {
  return (normalizeSeed(seed) * MULTIPLIER) % MODULUS;
}

export function nextColor(seed: number): { color: Color; seed: number } {
  const updated = nextSeed(seed);
  return { color: (updated % 2) as Color, seed: updated };
}

export function randomPiece(seed: number): { piece: Piece; seed: number } {
  const a = nextColor(seed);
  const b = nextColor(a.seed);
  const c = nextColor(b.seed);
  const d = nextColor(c.seed);

  return {
    piece: [
      [a.color, b.color],
      [c.color, d.color],
    ],
    seed: d.seed,
  };
}
