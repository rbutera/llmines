import type { Piece, PublicState } from "../core";
import type { GameController } from "../engine/controller";

/** The deterministic interface exposed at `window.__lumines` in test mode. */
export interface LuminesTestApi {
  seed(n: number): void;
  state(): PublicState;
  marked(): { row: number; col: number }[];
  spawn(piece: Piece): void;
  tick(): void;
  sweepNow(): void;
  sweepProgress(dtMs: number): void;
  /**
   * Additive: advance the injected clock by `dtMs` and run one logical sweep
   * frame. In addition to (not a replacement for) `sweepProgress`.
   */
  clockAdvance(dtMs: number): void;
  /** Additive: mark a settled cell as a chain special (coord = row*COLS+col). */
  setSpecial(row: number, col: number): void;
  /** Additive: set the current skin index (active BPM follows it). */
  setSkin(index: number): void;
}

declare global {
  interface Window {
    __lumines?: LuminesTestApi;
  }
}

/**
 * Install the test interface onto `window`. Called ONLY when
 * NEXT_PUBLIC_TEST_MODE=1 (see flag.ts); never invoked in a normal build, so
 * `window.__lumines` stays undefined in production.
 */
export function installTestApi(controller: GameController): () => void {
  if (typeof window === "undefined") return () => undefined;
  const api: LuminesTestApi = {
    seed: (n) => controller.testSeed(n),
    state: () => controller.testState(),
    marked: () => controller.testMarked(),
    spawn: (piece) => controller.testSpawn(piece),
    tick: () => controller.testTick(),
    sweepNow: () => controller.testSweepNow(),
    sweepProgress: (dtMs) => controller.testSweepProgress(dtMs),
    clockAdvance: (dtMs) => controller.testClockAdvance(dtMs),
    setSpecial: (row, col) => controller.testSetSpecial(row, col),
    setSkin: (index) => controller.testSetSkin(index),
  };
  window.__lumines = api;
  return () => {
    if (window.__lumines === api) delete window.__lumines;
  };
}
