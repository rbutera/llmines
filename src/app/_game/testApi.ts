"use client";

// Test_Mode interface installer (Req 16, 17, 18, 19).
//
// In Test_Mode `GameApp` hands this installer a {@link TestApiContext} bound to
// the live engine and React screen state. `installTestApi` assigns
// `window.__lumines` with the deterministic imperative surface the e2e harness
// drives: `seed`/`state`/`marked`/`spawn`/`tick`/`sweepNow`/`sweepProgress`.
//
// ISOLATION (Req 16.1): this module has NO top-level side effects and never
// touches `window` on import. `GameApp` only calls `installTestApi` when
// `TEST_MODE` is true, so in a normal build `window.__lumines` stays undefined
// and no test hooks leak into production.

import type { GameEngine } from "~/game/engine";
import type { Grid, Piece } from "~/game/types";

/** Screen identifiers the harness can read/drive. */
export type Screen = "start" | "playing" | "gameover";

/** A grid cell mirrored to the harness: empty (`null`) or a colour. */
export type { Cell, Color, Grid, Piece } from "~/game/types";

/** A coordinate flagged as Marked in the Stack (Req 5). */
export interface MarkedCell {
  row: number;
  col: number;
}

/** Snapshot the harness reads to assert on game state (Req 17). */
export interface TestState {
  /** Composite grid: settled Stack with the active block overlaid, `[row][col]`. */
  grid: Grid;
  /** Cumulative player score (Req 7). */
  score: number;
  /** Whether the game has ended (Req 9). */
  gameOver: boolean;
  /** Continuous Timeline_Bar position in `[0, COLS]` (Req 17.1). */
  sweepX: number;
}

/**
 * The deterministic imperative surface exposed on `window.__lumines` in
 * Test_Mode. Every method is bound to the live engine so the harness drives the
 * exact same state machine the game uses (Req 16.3).
 */
export interface LuminesTestApi {
  /** Reseed the RNG deterministically (Req 18.1). */
  seed(n: number): void;
  /** Read the current composite state snapshot (Req 17). */
  state(): TestState;
  /** Coordinates currently designated Marked (Req 5). */
  marked(): MarkedCell[];
  /**
   * Spawn `piece` at the Spawn_Position; if a block is mid-fall it is locked
   * first (Req 18.2–18.4). Invalid pieces are ignored with a console warning.
   */
  spawn(piece: Piece): void;
  /** Advance one gravity step. Never auto-spawns (Req 19.2). */
  tick(): void;
  /** Perform one full sweep traversal with scoring (Req 6, 7, 8). */
  sweepNow(): void;
  /** Advance the Timeline_Bar by `dtMs` (0.25 s/col), deleting crossed columns (Req 19.4). */
  sweepProgress(dtMs: number): void;
}

declare global {
  interface Window {
    __lumines?: LuminesTestApi;
  }
}

/**
 * The context `GameApp` provides so the Test_Api can drive the live engine and
 * React screen state deterministically.
 */
export interface TestApiContext {
  /** The live game engine (single source of truth). */
  engine: GameEngine;
  /** Read the current screen. */
  getScreen: () => Screen;
  /** Transition to a screen (e.g. start → playing for canvas mount). */
  setScreen: (s: Screen) => void;
  /** Notify React that mirrored state (e.g. the HUD score) should re-render. */
  notifyChange: () => void;
}

/** Type guard: a value is a valid 2x2 `Piece` of `0|1` colours. */
function isValidPiece(value: unknown): value is Piece {
  if (!Array.isArray(value) || value.length !== 2) {
    return false;
  }
  for (const row of value) {
    if (!Array.isArray(row) || row.length !== 2) {
      return false;
    }
    for (const cell of row) {
      if (cell !== 0 && cell !== 1) {
        return false;
      }
    }
  }
  return true;
}

/**
 * Install the Test_Api onto `window.__lumines`, bound to `ctx`'s live engine.
 *
 * Idempotent: each call rebinds `window.__lumines` to the latest context.
 * No-op outside a browser (defensive double-guard; `GameApp` already gates on
 * {@link TEST_MODE}).
 */
export function installTestApi(ctx: TestApiContext): void {
  if (typeof window === "undefined") {
    return;
  }

  const api: LuminesTestApi = {
    seed(n: number): void {
      ctx.engine.seed(n);
      ctx.notifyChange();
    },

    state(): TestState {
      const s = ctx.engine.getState();
      return {
        grid: ctx.engine.compositeGrid(),
        score: s.score,
        gameOver: s.gameOver,
        sweepX: s.sweepX,
      };
    },

    marked(): MarkedCell[] {
      const cells: MarkedCell[] = [];
      const marked = ctx.engine.getState().marked;
      for (let row = 0; row < marked.length; row++) {
        const flags = marked[row];
        if (flags === undefined) {
          continue;
        }
        for (let col = 0; col < flags.length; col++) {
          if (flags[col]) {
            cells.push({ row, col });
          }
        }
      }
      return cells;
    },

    spawn(piece: Piece): void {
      if (!isValidPiece(piece)) {
        console.warn("[lumines] spawn ignored: piece must be a 2x2 of 0|1", piece);
        return;
      }
      ctx.engine.spawnPiece(piece);
      if (ctx.engine.getState().gameOver) {
        ctx.setScreen("gameover");
      }
      ctx.notifyChange();
    },

    tick(): void {
      ctx.engine.gravityStep();
      ctx.notifyChange();
    },

    sweepNow(): void {
      ctx.engine.fullSweep();
      ctx.notifyChange();
    },

    sweepProgress(dtMs: number): void {
      ctx.engine.sweepProgress(dtMs);
      ctx.notifyChange();
    },
  };

  window.__lumines = api;
}
