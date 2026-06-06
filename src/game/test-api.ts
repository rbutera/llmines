import type { LuminesTestApi, PieceDef } from "./types";
import type { GameEngine } from "./engine";

function validateSeed(n: unknown): asserts n is number {
  if (typeof n !== "number" || !Number.isFinite(n)) {
    throw new TypeError(
      `seed() expects a finite number, got ${typeof n}: ${String(n)}`,
    );
  }
}

function validatePiece(piece: unknown): asserts piece is PieceDef {
  if (!Array.isArray(piece) || piece.length !== 2) {
    throw new TypeError(
      "spawn() expects a 2×2 array: [[Color, Color], [Color, Color]]",
    );
  }
  for (let r = 0; r < 2; r++) {
    const row = piece[r] as unknown;
    if (!Array.isArray(row) || row.length !== 2) {
      throw new TypeError(
        "spawn() expects a 2×2 array: [[Color, Color], [Color, Color]]",
      );
    }
    for (let c = 0; c < 2; c++) {
      const val = row[c] as unknown;
      if (val !== 0 && val !== 1) {
        throw new TypeError(
          `spawn() cell values must be 0 or 1, got ${String(val)} at [${r}][${c}]`,
        );
      }
    }
  }
}

function validateDtMs(dtMs: unknown): asserts dtMs is number {
  if (typeof dtMs !== "number" || !Number.isFinite(dtMs) || dtMs < 0) {
    throw new TypeError(
      `sweepProgress() expects a non-negative finite number, got ${typeof dtMs}: ${String(dtMs)}`,
    );
  }
}

/**
 * Initialize the test mode API.
 * Only called when NEXT_PUBLIC_TEST_MODE=1.
 */
export function initTestApi(engine: GameEngine): LuminesTestApi {
  const api: LuminesTestApi = {
    seed(n: number): void {
      validateSeed(n);
      engine.seed(n);
    },

    state() {
      return engine.getState();
    },

    marked() {
      return engine.getMarked();
    },

    spawn(piece: PieceDef): void {
      validatePiece(piece);
      engine.spawnPiece(piece);
    },

    tick(): void {
      engine.tick();
    },

    sweepNow(): void {
      engine.sweepNow();
    },

    sweepProgress(dtMs: number): void {
      validateDtMs(dtMs);
      engine.sweepProgress(dtMs);
    },
  };

  window.__lumines = api;
  return api;
}

/** Remove the test API from window. */
export function removeTestApi(): void {
  delete window.__lumines;
}
