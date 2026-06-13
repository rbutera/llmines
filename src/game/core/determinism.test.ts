import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createGame } from "./grid";
import { generateNext, nextPiece } from "./piece";
import { randomSeed } from "./rng";

/**
 * Determinism + single-RNG-stream guards for the V2 depth features. The eval's
 * whole premise is reproducibility from a seed.
 */

describe("single RNG stream, canonical draw order", () => {
  it("the colour bits are the first 4 draws (special roll never consumes colour)", () => {
    // The canonical order is: 4 colour bits, THEN the special roll. So for ANY
    // rngState, the colour cells produced by generateNext (specials path) equal
    // those produced by the colour-only nextPiece from the SAME state — the
    // special roll comes strictly after the colour bits. (Across pieces the two
    // streams diverge, by design, because the special roll consumes RNG; the
    // contract is per-piece colour identity, which is what this asserts.)
    let rng = createGame(2024).rngState;
    for (let i = 0; i < 200; i++) {
      const [, piece] = nextPiece(rng);
      const [next, gp] = generateNext(rng);
      expect(gp.cells).toEqual(piece);
      rng = next;
    }
  });

  it("generateNext is a pure function of rngState (same input -> same output)", () => {
    const seed = createGame(77).rngState;
    expect(generateNext(seed)).toEqual(generateNext(seed));
  });
});

describe("no second RNG / no Math.random in the gameplay core", () => {
  it("gameplay-core source files never call Math.random or seed a second generator", () => {
    // Statically scan the pure-core sources (excluding tests) for Math.random.
    // `rng.ts` is excluded: it OWNS the seed source and `randomSeed()` is the one
    // sanctioned, gameplay-free use of Math.random (a SSR/Node crypto fallback,
    // never called by any pure game op). The determinism contract is "same seed
    // -> same run", which holds because randomSeed only draws the initial seed.
    const coreDir = fileURLToPath(new URL(".", import.meta.url));
    const files = [
      "scoring.ts",
      "chain.ts",
      "chain-clear.ts",
      "skins.ts",
      "piece.ts",
      "sweep.ts",
      "grid.ts",
      "detect.ts",
      "constants.ts",
      "index.ts",
      "types.ts",
    ];
    for (const f of files) {
      const src = readFileSync(coreDir + f, "utf8");
      expect(src.includes("Math.random"), `${f} uses Math.random`).toBe(false);
    }
  });
});

describe("per-game random seed", () => {
  it("createGame records the explicit seed and reproduces a run", () => {
    expect(createGame(7).seed).toBe(7);
    // Same explicit seed -> identical RNG state and piece stream.
    expect(createGame(7).rngState).toBe(createGame(7).rngState);
    expect(generateNext(createGame(7).rngState)).toEqual(
      generateNext(createGame(7).rngState),
    );
  });

  it("randomSeed() returns a uint32 and two draws differ", () => {
    const a = randomSeed();
    const b = randomSeed();
    expect(Number.isInteger(a)).toBe(true);
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThanOrEqual(0xffffffff);
    // Overwhelming probability two crypto draws differ.
    expect(a).not.toBe(b);
  });

  it("two no-seed games differ (seeds and piece sequences)", () => {
    const g1 = createGame(randomSeed());
    const g2 = createGame(randomSeed());
    expect(g1.seed).not.toBe(g2.seed);
    expect(generateNext(g1.rngState)[1]).not.toEqual(
      generateNext(g2.rngState)[1],
    );
  });
});
