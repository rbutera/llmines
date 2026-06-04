import type { LuminesEngine } from "./engine";
import type { MarkedCell, Piece } from "./types";

export interface LuminesTestApi {
  seed(n: number): void;
  state(): {
    grid: (0 | 1 | null)[][];
    score: number;
    gameOver: boolean;
    sweepX: number;
  };
  marked(): MarkedCell[];
  spawn(piece?: Piece): void;
  tick(): void;
  sweepNow(): void;
  sweepProgress(dtMs: number): void;
}

export function buildTestApi(engine: LuminesEngine): LuminesTestApi {
  return {
    seed: (n) => engine.seed(n),
    state: () => engine.state(),
    marked: () => engine.marked(),
    spawn: (piece) => engine.spawnPiece(piece),
    tick: () => engine.tick(),
    sweepNow: () => engine.sweepNow(),
    sweepProgress: (dtMs) => engine.sweepProgress(dtMs),
  };
}

declare global {
  interface Window {
    __lumines?: LuminesTestApi;
  }
}

export function installTestApi(engine: LuminesEngine): void {
  if (typeof window !== "undefined") window.__lumines = buildTestApi(engine);
}

export function uninstallTestApi(): void {
  if (typeof window !== "undefined") delete window.__lumines;
}
