import { marked as markedOf, renderGrid } from "../core/engine";
import type { Grid, MarkedCell, Piece } from "../core/types";
import type { GameController } from "../driver/gameController";

export interface LuminesTestApi {
  seed(n: number): void;
  state(): { grid: Grid; score: number; gameOver: boolean; sweepX: number };
  marked(): MarkedCell[];
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
 * Install the deterministic test interface on window. Called ONLY in test-mode
 * builds (guarded by TEST_MODE at the call site), so it never ships to normal
 * builds. `start()` must have been called by the harness (via the start button)
 * before driving the game.
 */
export function installTestApi(controller: GameController): void {
  if (typeof window === "undefined") return;
  const api: LuminesTestApi = {
    seed: (n) => controller.seed(n),
    state: () => {
      const s = controller.getState();
      return {
        grid: renderGrid(s),
        score: s.score,
        gameOver: s.gameOver,
        sweepX: s.sweepX,
      };
    },
    marked: () => markedOf(controller.getState()),
    spawn: (piece) => controller.spawn(piece),
    tick: () => controller.tick(),
    sweepNow: () => controller.sweepNow(),
    sweepProgress: (dtMs) => controller.sweepProgress(dtMs),
  };
  window.__lumines = api;
}

export function uninstallTestApi(): void {
  if (typeof window !== "undefined") delete window.__lumines;
}
