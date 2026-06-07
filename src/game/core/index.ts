import { computeMarked } from "./detect";
import { viewGrid } from "./grid";
import { skinBpm } from "./skins";
import type {
  GameState,
  GeneratedPiece,
  Grid,
  HoldState,
  OrderedCell,
} from "./types";

export * from "./types";
export * from "./constants";
export * from "./rng";
export * from "./grid";
export * from "./piece";
export * from "./detect";
export * from "./sweep";
export * from "./scoring";
export * from "./chain";
export * from "./skins";

/** Public, serialisable projection of state for the test interface. */
export interface PublicState {
  grid: Grid;
  score: number;
  gameOver: boolean;
  sweepX: number;
  /** Spawn-hold for the currently active piece. */
  hold: HoldState;
  /**
   * Additive (change A): number of distinct completed 2x2 squares in the
   * settled grid by the overlap-counting detection (mono WxH -> (W-1)(H-1)).
   * Exposed so the eval can assert detection without reading internals. Existing
   * fields above are unchanged in shape.
   */
  distinctSquares: number;
  /**
   * Additive (this change): consecutive qualifying-pass count driving the combo
   * multiplier curve. 0 = no combo active.
   */
  combo: number;
  /**
   * Additive: chain-special coordinates (`row * COLS + col`) currently in the
   * settled grid, sorted ascending for stable assertions.
   */
  specials: number[];
  /**
   * Additive: the next pieces in the preview queue (at least PREVIEW_DEPTH),
   * each carrying its generation-time chain-special decision so the preview can
   * surface an upcoming special.
   */
  queue: GeneratedPiece[];
  /** Additive: current skin index (progression). */
  skinIndex: number;
  /** Additive: active BPM, derived from the current skin. Drives sweep speed. */
  bpm: number;
  /**
   * Additive (record-only, Phase 3): the most recent chain-flood clear — origin
   * chain cell, the ordered cleared component (each cell + its BFS distance from
   * the origin), and a monotonic `id`. Exposed via the seam so a test can assert
   * the ordered payload after triggering a chain. `undefined` until the first
   * chain clear. Render-only: never feeds gameplay/scoring/timing.
   */
  lastChainClear?: { origin: number; cells: OrderedCell[]; id: number };
}

/** Project internal state to the public `state()` shape (composites the piece). */
export function publicState(state: GameState): PublicState {
  return {
    grid: viewGrid(state),
    score: state.score,
    gameOver: state.gameOver,
    sweepX: state.sweepX,
    hold: state.hold ?? { active: false, remainingMs: 0 },
    // Detection is over the settled grid (matches `marked()` semantics); the
    // active falling piece is excluded until it locks.
    distinctSquares: computeMarked(state.grid).distinctSquares,
    combo: state.combo,
    specials: Array.from(state.specials).sort((a, b) => a - b),
    queue: state.queue.map((gp) => ({
      cells: gp.cells,
      ...(gp.special ? { special: { ...gp.special } } : {}),
    })),
    skinIndex: state.skinIndex,
    bpm: skinBpm(state.skinIndex),
    // Record-only chain-clear event passthrough (Phase 3). Copied (not aliased)
    // so the public projection never shares the internal cells array reference.
    ...(state.lastChainClear
      ? {
          lastChainClear: {
            origin: state.lastChainClear.origin,
            cells: state.lastChainClear.cells.map((c) => ({ ...c })),
            id: state.lastChainClear.id,
          },
        }
      : {}),
  };
}
