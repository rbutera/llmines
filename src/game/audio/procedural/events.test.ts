import { describe, expect, it } from "vitest";
import type { RenderState } from "../../engine/controller";
import { AudioEventDeriver } from "./events";

/**
 * The truthful clear/lock telemetry the sibling `core-lumines-fidelity` change
 * adds to RenderState. This worktree's RenderState type does NOT yet carry these
 * fields; the deriver reads them through a structural adapter, so the tests build
 * SYNTHETIC render states carrying them — fully exercising the contract here
 * without the sibling merged.
 */
interface PassComplete {
  id: number;
  squares: number;
  comboMultiplier: number;
  groupErases: { cells: number[]; hadChain: boolean }[];
}
interface LockRecord {
  id: number;
  cause: "gravity" | "soft" | "hard";
}
type Telemetry = Partial<{
  lastPassComplete: PassComplete;
  lastLock: LockRecord;
}>;

/**
 * Minimal RenderState factory — only the fields the deriver reads matter. The
 * `over` can ALSO carry the new telemetry fields (typed loosely so the test can
 * attach them before the sibling adds them to RenderState).
 */
function rs(over: Partial<RenderState> & Telemetry = {}): RenderState {
  const base = {
    grid: [],
    active: {
      cells: [
        [0, 1],
        [1, 0],
      ],
      pos: { row: 0, col: 7 },
    },
    fallProgress: 0,
    score: 0,
    gameOver: false,
    sweepX: 0,
    seed: 0,
    marked: [],
    hold: { active: false, remainingMs: 0 },
    queue: [],
    skinIndex: 0,
    bpm: 120,
    specials: [],
    softDropping: false,
    softDropPulses: 0,
    floodPreview: [],
    markedSquares: 0,
    ...over,
  };
  return base as RenderState;
}

/** A pass-completion record (the sibling's `lastPassComplete` shape). */
function pass(
  id: number,
  squares: number,
  comboMultiplier = 1,
  groups = 1,
): PassComplete {
  return {
    id,
    squares,
    comboMultiplier,
    groupErases: Array.from({ length: groups }, () => ({
      cells: [0],
      hadChain: false,
    })),
  };
}

describe("AudioEventDeriver — truthful telemetry (no score inference)", () => {
  it("emits nothing on the first state (no prior to diff)", () => {
    const d = new AudioEventDeriver();
    expect(d.derive(rs())).toEqual([]);
  });

  it("detects a horizontal move", () => {
    const d = new AudioEventDeriver();
    d.derive(rs({ active: { cells: [[0, 1], [1, 0]], pos: { row: 0, col: 7 } } }));
    const ev = d.derive(rs({ active: { cells: [[0, 1], [1, 0]], pos: { row: 0, col: 8 } } }));
    expect(ev).toEqual([{ type: "move" }]);
  });

  it("detects a rotation (cells matrix changed) and not a move", () => {
    const d = new AudioEventDeriver();
    d.derive(rs({ active: { cells: [[0, 1], [1, 0]], pos: { row: 0, col: 7 } } }));
    const ev = d.derive(rs({ active: { cells: [[1, 0], [0, 1]], pos: { row: 0, col: 7 } } }));
    expect(ev).toEqual([{ type: "rotate" }]);
  });

  it("detects a soft-drop step via the pulse counter", () => {
    const d = new AudioEventDeriver();
    d.derive(rs({ softDropPulses: 0 }));
    const ev = d.derive(rs({ softDropPulses: 1 }));
    expect(ev).toContainEqual({ type: "softDrop" });
  });

  // ── clear truth (audio-event-truth: real pass telemetry, never score) ──────

  it("a real clear fires ONE truthful lineClear (squares + streak offset), no score read", () => {
    const d = new AudioEventDeriver();
    // score is held constant to prove the lineClear is NOT keyed off score.
    d.derive(rs({ score: 1000, lastPassComplete: pass(0, 0) }));
    const ev = d.derive(rs({ score: 1000, lastPassComplete: pass(1, 3, 1) }));
    expect(ev).toEqual([{ type: "lineClear", squares: 3, combo: 0 }]);
  });

  it("a non-clear score event (soft-drop / board bonus) fires NO lineClear", () => {
    const d = new AudioEventDeriver();
    d.derive(rs({ score: 0, lastPassComplete: pass(7, 2) }));
    // score jumps but the pass id does NOT advance — pure bonus, no clear.
    const ev = d.derive(rs({ score: 500, lastPassComplete: pass(7, 2) }));
    expect(ev.some((e) => e.type === "lineClear")).toBe(false);
  });

  it("a multiplied pass is NOT inflated — squares are real, combo is the streak offset", () => {
    const d = new AudioEventDeriver();
    d.derive(rs({ score: 0, lastPassComplete: pass(0, 0) }));
    // 4 squares under a ×4 streak (score would rise 640+); telemetry says 4 / ×4.
    const ev = d.derive(rs({ score: 640, lastPassComplete: pass(1, 4, 4) }));
    expect(ev).toContainEqual({ type: "lineClear", squares: 4, combo: 3 });
    // never a 16-square count derived from 640/40.
    expect(ev.some((e) => e.type === "lineClear" && e.squares === 16)).toBe(false);
  });

  it("a zero-square pass-id bump emits NO lineClear (no weight-1 phantom)", () => {
    const d = new AudioEventDeriver();
    d.derive(rs({ lastPassComplete: pass(0, 1) }));
    // the core bumped the pass id but the pass erased 0 squares.
    const ev = d.derive(rs({ lastPassComplete: pass(1, 0) }));
    expect(ev.some((e) => e.type === "lineClear")).toBe(false);
  });

  // ── lock truth (every settle, with cause) ──────────────────────────────────

  it("a gravity lock is audible with cause 'gravity'", () => {
    const d = new AudioEventDeriver();
    d.derive(rs({ lastLock: { id: 0, cause: "gravity" } }));
    const ev = d.derive(rs({ lastLock: { id: 1, cause: "gravity" } }));
    expect(ev).toContainEqual({ type: "lock", cause: "gravity" });
  });

  it("a hard drop locks with cause 'hard'", () => {
    const d = new AudioEventDeriver();
    d.derive(rs({ lastLock: { id: 0, cause: "gravity" } }));
    const ev = d.derive(rs({ lastLock: { id: 1, cause: "hard" } }));
    expect(ev).toContainEqual({ type: "lock", cause: "hard" });
  });

  it("a soft-drop lock fires once with cause 'soft'", () => {
    const d = new AudioEventDeriver();
    d.derive(rs({ lastLock: { id: 4, cause: "gravity" } }));
    const ev = d.derive(rs({ lastLock: { id: 5, cause: "soft" } }));
    const locks = ev.filter((e) => e.type === "lock");
    expect(locks).toEqual([{ type: "lock", cause: "soft" }]);
  });

  it("emits exactly ONE lock per settle (no duplicate from a separate hard-drop path)", () => {
    const d = new AudioEventDeriver();
    // a hard drop: lastHardDrop AND lastLock both advance. The deriver keys ONLY
    // off lastLock now, so there is exactly one lock event, not two.
    d.derive(
      rs({
        lastHardDrop: { id: 0, cols: [], row: 0, distance: 0 },
        lastLock: { id: 0, cause: "gravity" },
      }),
    );
    const ev = d.derive(
      rs({
        lastHardDrop: { id: 1, cols: [7, 8], row: 9, distance: 5 },
        lastLock: { id: 1, cause: "hard" },
      }),
    );
    expect(ev.filter((e) => e.type === "lock").length).toBe(1);
  });

  // ── match: the staged-square count rising (design D6) ──────────────────────

  it("emits a `match` when the markedSquares count RISES, carrying the positive delta", () => {
    const d = new AudioEventDeriver();
    d.derive(rs({ markedSquares: 0 }));
    const ev = d.derive(rs({ markedSquares: 1 }));
    expect(ev).toContainEqual({ type: "match", squares: 1 });
  });

  it("a BIGGER rise carries a bigger squares delta (brighter ding)", () => {
    const d = new AudioEventDeriver();
    d.derive(rs({ markedSquares: 1 }));
    const ev = d.derive(rs({ markedSquares: 4 }));
    expect(ev).toContainEqual({ type: "match", squares: 3 });
  });

  it("a square formed by a post-clear CASCADE (no lock-id advance) still dings", () => {
    const d = new AudioEventDeriver();
    // the lock id is held CONSTANT (no piece settle) — a gravity cascade lined up a new
    // square, so only markedSquares rises. The match must still fire (not lock-gated).
    d.derive(rs({ markedSquares: 0, lastLock: { id: 5, cause: "gravity" } }));
    const ev = d.derive(rs({ markedSquares: 1, lastLock: { id: 5, cause: "gravity" } }));
    expect(ev).toContainEqual({ type: "match", squares: 1 });
    expect(ev.some((e) => e.type === "lock")).toBe(false); // no new lock
  });

  it("a DECREASE in markedSquares (the sweep erasing a square) emits NO match (clear silent)", () => {
    const d = new AudioEventDeriver();
    d.derive(rs({ markedSquares: 3 }));
    const ev = d.derive(rs({ markedSquares: 0 }));
    expect(ev.some((e) => e.type === "match")).toBe(false);
  });

  // ── chain stays render-truthful ────────────────────────────────────────────

  it("detects a chain cascade from a new chain-clear id with its size", () => {
    const d = new AudioEventDeriver();
    d.derive(rs());
    const ev = d.derive(
      rs({
        lastChainClear: {
          origin: 0,
          id: 1,
          cells: [
            { cell: 0, dist: 0 },
            { cell: 1, dist: 1 },
            { cell: 2, dist: 1 },
          ],
        },
      }),
    );
    expect(ev).toContainEqual({ type: "chain", size: 3 });
  });

  // ── missing telemetry → silence, never inference ───────────────────────────

  it("missing pass/lock telemetry degrades to SILENCE (no lineClear, no lock, no score fallback)", () => {
    const d = new AudioEventDeriver();
    // a render state with NO telemetry fields, score climbing — the old code would
    // have inferred a lineClear from the score delta; the new code must not.
    d.derive(rs({ score: 0 }));
    const ev = d.derive(rs({ score: 1000, active: { cells: [[0, 1], [1, 0]], pos: { row: 0, col: 7 } } }));
    expect(ev.some((e) => e.type === "lineClear")).toBe(false);
    expect(ev.some((e) => e.type === "lock")).toBe(false);
  });
});
