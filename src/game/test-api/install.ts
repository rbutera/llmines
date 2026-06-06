import type { Piece, PublicState } from "../core";
import type { GameController } from "../engine/controller";

/** The deterministic interface exposed at `window.__lumines` in test mode. */
export interface LuminesTestApi {
  seed(n: number): void;
  state(): PublicState;
  marked(): { row: number; col: number }[];
  spawn(piece: Piece): void;
  tick(): void;
  pressSoftDrop(): void;
  pressHardDrop(): void;
  sweepNow(): void;
  sweepProgress(dtMs: number): void;
  endGame?: (score: number) => Promise<void> | void;
  auth?: {
    signIn: (args: { name: string; subject: string; image?: string }) => void;
    signOut: () => void;
  };
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
    pressSoftDrop: () => controller.testPressSoftDrop(),
    pressHardDrop: () => controller.testPressHardDrop(),
    sweepNow: () => controller.testSweepNow(),
    sweepProgress: (dtMs) => controller.testSweepProgress(dtMs),
  };
  window.__lumines = api;
  return () => {
    if (window.__lumines === api) delete window.__lumines;
  };
}
