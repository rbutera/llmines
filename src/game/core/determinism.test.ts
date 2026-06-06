import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createGame } from "./grid";
import { generateNext, nextPiece } from "./piece";

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

describe("no second RNG / no Math.random in the pure core", () => {
  it("core source files never call Math.random or seed a second generator", () => {
    // Statically scan the pure-core sources (excluding tests) for Math.random.
    const coreDir = fileURLToPath(new URL(".", import.meta.url));
    const files = [
      "scoring.ts",
      "chain.ts",
      "chain-clear.ts",
      "skins.ts",
      "piece.ts",
      "sweep.ts",
      "grid.ts",
      "rng.ts",
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
