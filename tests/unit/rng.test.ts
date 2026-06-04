import { describe, expect, it } from "vitest";
import { randomPiece, seedRng } from "~/game/core/rng";

describe("rng", () => {
  it("produces a deterministic sequence for the same seed", () => {
    const seqFor = (seed: number) => {
      let s = seedRng(seed);
      const pieces = [];
      for (let i = 0; i < 5; i++) {
        const r = randomPiece(s);
        s = r.state;
        pieces.push(r.piece);
      }
      return pieces;
    };
    expect(seqFor(42)).toEqual(seqFor(42));
  });

  it("produces different sequences for different seeds", () => {
    const first = randomPiece(seedRng(1)).piece;
    const collect = (seed: number) => {
      let s = seedRng(seed);
      const out: unknown[] = [];
      for (let i = 0; i < 8; i++) {
        const r = randomPiece(s);
        s = r.state;
        out.push(r.piece);
      }
      return out;
    };
    expect(collect(1)).not.toEqual(collect(2));
    expect(first).toHaveLength(2);
  });

  it("only emits colours 0 or 1", () => {
    let s = seedRng(7);
    for (let i = 0; i < 50; i++) {
      const r = randomPiece(s);
      s = r.state;
      for (const row of r.piece) for (const c of row) expect([0, 1]).toContain(c);
    }
  });
});
