import {
  markedCells,
  hardDrop,
  setSeed,
  spawnPiece,
  sweepNow,
  sweepProgress,
  tick,
  visibleGrid,
} from "./engine";
import type { GameState, Piece } from "./types";

export interface LuminesTestApi {
  seed(n: number): void;
  state(): {
    grid: ReturnType<typeof visibleGrid>;
    score: number;
    gameOver: boolean;
    sweepX: number;
  };
  marked(): { row: number; col: number }[];
  spawn(piece: Piece): void;
  tick(): void;
  sweepNow(): void;
  sweepProgress(dtMs: number): void;
}

export function createLuminesTestApi(
  getState: () => GameState,
  setState: (updater: (state: GameState) => GameState) => void,
): LuminesTestApi {
  return {
    seed(n) {
      setState((state) => setSeed(state, n));
    },
    state() {
      const state = getState();
      return {
        grid: visibleGrid(state),
        score: state.score,
        gameOver: state.gameOver,
        sweepX: state.sweep.x,
      };
    },
    marked() {
      return markedCells(getState());
    },
    spawn(piece) {
      setState((state) => {
        const settled = state.activePiece
          ? hardDrop(state, { autoSpawn: false })
          : state;
        return spawnPiece(settled, piece, { autoSpawn: false });
      });
    },
    tick() {
      setState((state) => tick(state, { autoSpawn: false }));
    },
    sweepNow() {
      setState((state) => sweepNow(state));
    },
    sweepProgress(dtMs) {
      setState((state) => sweepProgress(state, dtMs));
    },
  };
}

declare global {
  interface Window {
    __lumines?: LuminesTestApi;
  }
}
