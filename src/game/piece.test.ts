import { describe, it, expect } from "vitest";
import fc from "fast-check";

import type { Piece } from "./types";
import { randomPiece, rotatePiece } from "./piece";
import { seed } from "./rng";

/** Generate a sequence of `count` pieces by threading RNG state from a seed input. */
function generateSequence(seedInput: number, count: number): Piece[] {
  let state = seed(seedInput);
  const pieces: Piece[] = [];
  for (let i = 0; i < count; i++) {
    const result = randomPiece(state);
    pieces.push(result.piece);
    state = result.rngState;
  }
  return pieces;
}

// Feature: llmines, Property 16: Seeded generation is deterministic
// Validates: Requirements 2.2, 18.1
describe("Property 16: Seeded generation is deterministic", () => {
  it("produces the identical piece sequence for the same seed every time", () => {
    fc.assert(
      fc.property(fc.integer(), (n) => {
        const first = generateSequence(n, 20);
        const second = generateSequence(n, 20);
        expect(first).toEqual(second);
      }),
      { numRuns: 100 },
    );
  });
});

describe("randomPiece", () => {
  it("produces a 2x2 piece whose cells are all 0 or 1", () => {
    const { piece } = randomPiece(seed(42));
    expect(piece).toHaveLength(2);
    expect(piece[0]).toHaveLength(2);
    expect(piece[1]).toHaveLength(2);
    for (const row of piece) {
      for (const cell of row) {
        expect(cell === 0 || cell === 1).toBe(true);
      }
    }
  });

  it("advances the RNG state so consecutive pieces can differ", () => {
    const first = randomPiece(seed(7));
    const second = randomPiece(first.rngState);
    // State must move forward (deterministic threading).
    expect(second.rngState).not.toBe(first.rngState);
  });
});

describe("rotatePiece", () => {
  it("rotates a 2x2 piece 90 degrees clockwise: [[a,b],[c,d]] -> [[c,a],[d,b]]", () => {
    const piece: Piece = [
      [0, 1],
      [1, 0],
    ];
    expect(rotatePiece(piece)).toEqual([
      [1, 0],
      [0, 1],
    ]);
  });

  it("returns to the original after four clockwise rotations", () => {
    const piece: Piece = [
      [0, 1],
      [0, 1],
    ];
    let rotated = piece;
    for (let i = 0; i < 4; i++) {
      rotated = rotatePiece(rotated);
    }
    expect(rotated).toEqual(piece);
  });
});
