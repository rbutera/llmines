import type { GameEngine } from "./engine";
import type { CellCoord, Piece, PublicState } from "./types";

/** Deterministic interface exposed as `window.__lumines` when TEST_MODE is on. */
export interface LuminesTestApi {
  seed(n: number): void;
  state(): PublicState;
  marked(): CellCoord[];
  spawn(piece: Piece): void;
  tick(): void;
  sweepNow(): void;
  sweepProgress(dtMs: number): void;
}

declare global {
  interface Window {
    __lumines?: LuminesTestApi;
  }
}

/**
 * Build the test API bound to a single engine. Any method that drives gameplay
 * transparently starts the game first if it is still on the start screen, so the
 * harness can begin driving without depending on the start-button click.
 */
export function createTestApi(engine: GameEngine): LuminesTestApi {
  const ensurePlaying = () => {
    if (engine.phase === "start") engine.start(false);
  };
  return {
    seed: (n) => engine.seed(n),
    state: () => engine.state(),
    marked: () => engine.marked(),
    spawn: (piece) => {
      ensurePlaying();
      engine.placePiece(piece);
    },
    tick: () => {
      ensurePlaying();
      engine.tick();
    },
    sweepNow: () => {
      ensurePlaying();
      engine.sweepNow();
    },
    sweepProgress: (dtMs) => {
      ensurePlaying();
      engine.sweepProgress(dtMs);
    },
  };
}
