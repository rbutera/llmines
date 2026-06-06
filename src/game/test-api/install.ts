import type { Piece, PublicState } from "../core";
import { mockStore } from "../account/mock-store";
import type { GameController } from "../engine/controller";

/** Deterministic auth hooks (TEST_MODE only) — drive the mock identity. */
export interface LuminesAuthApi {
  /** Mock-authenticate as this identity. `subject` is the server-derived id. */
  signIn(identity: { name: string; subject: string }): void;
  /** Return to the unauthenticated state. */
  signOut(): void;
}

/** The deterministic interface exposed at `window.__lumines` in test mode. */
export interface LuminesTestApi {
  seed(n: number): void;
  state(): PublicState;
  marked(): { row: number; col: number }[];
  spawn(piece: Piece): void;
  tick(): void;
  sweepNow(): void;
  sweepProgress(dtMs: number): void;
  /** Simulate a FRESH, deliberate soft-drop press (ends a spawn-hold). */
  pressSoftDrop(): void;
  /** Simulate a FRESH, deliberate hard-drop press (ends a spawn-hold). */
  pressHardDrop(): void;
  /** Deterministic auth control against the mock backend. */
  auth: LuminesAuthApi;
  /** End the current game with an exact final score via the REAL game-over
   * path (submits to the mock when signed in; writes nothing when signed out). */
  endGame(score: number): void;
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
    pressSoftDrop: () => controller.testPressSoftDrop(),
    pressHardDrop: () => controller.testPressHardDrop(),
    auth: {
      signIn: (identity) => mockStore.signIn(identity),
      signOut: () => mockStore.signOut(),
    },
    endGame: (score) => controller.testEndGame(score),
    clockAdvance: (dtMs) => controller.testClockAdvance(dtMs),
    setSpecial: (row, col) => controller.testSetSpecial(row, col),
    setSkin: (index) => controller.testSetSkin(index),
  };
  window.__lumines = api;
  return () => {
    if (window.__lumines === api) delete window.__lumines;
  };
}
