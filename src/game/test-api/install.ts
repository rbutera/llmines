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
  /** Simulate a FRESH deliberate soft-drop press (ends the hold, fast-falls). */
  pressSoftDrop(): void;
  /** Simulate a FRESH deliberate hard-drop press (ends the hold, slams down). */
  pressHardDrop(): void;
  /**
   * Mock auth (F3). Installed by the leaderboard provider in TEST_MODE.
   * `subject` is the server-derived id; never a client-trusted value elsewhere.
   */
  auth?: {
    signIn(arg: { name: string; subject: string }): void;
    signOut(): void;
  };
  /**
   * Deterministically end the current game with `score` via the REAL game-over
   * path (F3). Submits to the mock backend when signed in; no-op write when out.
   */
  endGame?: (score: number) => void;
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
    pressSoftDrop: () => controller.pressSoftDrop(),
    pressHardDrop: () => controller.pressHardDrop(),
  };
  // Merge (don't clobber) so the leaderboard provider's auth/endGame hooks,
  // which may be installed before or after this, survive.
  const merged = Object.assign(window.__lumines ?? ({} as LuminesTestApi), api);
  window.__lumines = merged;
  return () => {
    if (window.__lumines === merged) {
      const keys: (keyof LuminesTestApi)[] = [
        "seed",
        "state",
        "marked",
        "spawn",
        "tick",
        "sweepNow",
        "sweepProgress",
        "pressSoftDrop",
        "pressHardDrop",
      ];
      for (const k of keys) delete merged[k];
    }
  };
}
