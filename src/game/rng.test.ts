import { describe, it, expect } from "vitest";
import { nextRandom, nextPiece } from "./rng";

describe("rng", () => {
  it("is deterministic for a given seed", () => {
    const [v1] = nextRandom(42);
    const [v2] = nextRandom(42);
    expect(v1).toBe(v2);
  });

  it("produces a different value as state advances", () => {
    const [v1, s1] = nextRandom(42);
    const [v2] = nextRandom(s1);
    expect(v1).not.toBe(v2);
  });

  it("returns values in [0,1)", () => {
    let s = 7;
    for (let i = 0; i < 100; i++) {
      const [v, ns] = nextRandom(s);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      s = ns;
    }
  });

  it("nextPiece yields a 2x2 of 0/1 and advances state", () => {
    const [piece, s2] = nextPiece(123);
    expect(piece.length).toBe(2);
    expect(piece[0].length).toBe(2);
    for (const row of piece)
      for (const c of row) expect([0, 1]).toContain(c);
    expect(s2).not.toBe(123);
  });

  it("nextPiece is deterministic and reproduces a sequence from a seed", () => {
    const [p1, s1] = nextPiece(999);
    const [p2] = nextPiece(s1);
    const [q1, t1] = nextPiece(999);
    const [q2] = nextPiece(t1);
    expect(p1).toEqual(q1);
    expect(p2).toEqual(q2);
  });
});
