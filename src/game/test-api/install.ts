import type { Piece } from "../core";
import { mockStore } from "../account/mock-store";
import type { GameController, PublicTestState } from "../engine/controller";

/** Deterministic mock-auth seam (TEST_MODE only). */
export interface LuminesTestAuth {
  /**
   * Mock-authenticate as this identity. `subject` is the stable id the server
   * derives the player from (`ctx.auth.getUserIdentity()`), never a
   * client-trusted arg — here it identifies the mock player's leaderboard row.
   */
  signIn(identity: { name: string; subject: string }): void;
  /** Return to the unauthenticated state. */
  signOut(): void;
}

/** The deterministic interface exposed at `window.__lumines` in test mode. */
export interface LuminesTestApi {
  seed(n: number): void;
  state(): PublicTestState;
  marked(): { row: number; col: number }[];
  spawn(piece: Piece): void;
  tick(): void;
  sweepNow(): void;
  sweepProgress(dtMs: number): void;
  /** Simulate a FRESH, deliberate soft-drop press (releases the spawn hold). */
  pressSoftDrop(): void;
  /** Simulate a FRESH, deliberate hard-drop press (releases the spawn hold). */
  pressHardDrop(): void;
  /** Mock auth (Google SSO stand-in) driving the signed-in UI + submit path. */
  auth: LuminesTestAuth;
  /**
   * Deterministically end the current game with this exact final score, running
   * the REAL game-over path. Signed in => submits to the (mock) backend and
   * refreshes personal-best + leaderboard; signed out => not written.
   */
  endGame(score: number): void;
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
  };
  window.__lumines = api;
  return () => {
    if (window.__lumines === api) delete window.__lumines;
  };
}
