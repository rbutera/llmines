// Piece creation and rotation for LLMines.
// This module is part of the pure game core: it imports nothing from React or PixiJS.

import type { Piece } from "./types";
import { colorFrom, type Rng } from "./rng";

/**
 * Generate a random {@link Piece} from a pure RNG state, threading the state through.
 * Each of the four cells is independently assigned Color A (0) or Color B (1) (Req 2.2).
 *
 * The cells are filled in reading order — top-left, top-right, bottom-left, bottom-right —
 * so the sequence is fully determined by the incoming `rngState`. The returned `rngState`
 * is the state after four draws, ready to thread into the next call (Req 18.1).
 */
export function randomPiece(rngState: number): { piece: Piece; rngState: number } {
  const a = colorFrom(rngState);
  const b = colorFrom(a.state);
  const c = colorFrom(b.state);
  const d = colorFrom(c.state);
  const piece: Piece = [
    [a.color, b.color],
    [c.color, d.color],
  ];
  return { piece, rngState: d.state };
}

/**
 * Convenience overload: generate a random {@link Piece} by drawing four colours from a
 * stateful {@link Rng}, mutating the RNG's internal state. Produces the same colours, in
 * the same order, as {@link randomPiece} would from the equivalent state.
 */
export function randomPieceWith(rng: Rng): Piece {
  const topLeft = rng.nextColor();
  const topRight = rng.nextColor();
  const bottomLeft = rng.nextColor();
  const bottomRight = rng.nextColor();
  return [
    [topLeft, topRight],
    [bottomLeft, bottomRight],
  ];
}

/**
 * Rotate a 2x2 piece 90 degrees clockwise (pure). For `[[a, b], [c, d]]` where
 * a = top-left, b = top-right, c = bottom-left, d = bottom-right, the clockwise
 * rotation is `[[c, a], [d, b]]` (Req 4.4).
 */
export function rotatePiece(piece: Piece): Piece {
  const a = piece[0][0];
  const b = piece[0][1];
  const c = piece[1][0];
  const d = piece[1][1];
  return [
    [c, a],
    [d, b],
  ];
}
