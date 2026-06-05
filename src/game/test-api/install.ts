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
  pressSoftDrop(): void;
  pressHardDrop(): void;
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
    endGame: (score) => controller.testEndGame(score),
  };
  // Merge so the MockAccountProvider's `auth` seam (set separately) survives.
  const w = window as unknown as { __lumines?: Record<string, unknown> };
  w.__lumines = {
    ...(w.__lumines ?? {}),
    ...(api as unknown as Record<string, unknown>),
  };
  return () => {
    const current = window.__lumines as unknown as
      | Record<string, unknown>
      | undefined;
    if (current) for (const key of Object.keys(api)) delete current[key];
  };
}
