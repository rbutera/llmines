import { describe, expect, it } from "vitest";
import type { RenderState } from "../../engine/controller";
import { AudioEventDeriver } from "./events";

/** Minimal RenderState factory — only the fields the deriver reads matter. */
function rs(over: Partial<RenderState> = {}): RenderState {
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
    marked: [],
    hold: { active: false, remainingMs: 0 },
    queue: [],
    skinIndex: 0,
    bpm: 120,
    specials: [],
    softDropping: false,
    softDropPulses: 0,
    ...over,
  } satisfies RenderState;
  return base;
}

describe("AudioEventDeriver", () => {
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

  it("detects a rotation (cells matrix changed)", () => {
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

  it("detects a lock via the hard-drop slam id", () => {
    const d = new AudioEventDeriver();
    d.derive(rs({ lastHardDrop: { id: 0, cols: [], row: 0, distance: 0 } }));
    const ev = d.derive(rs({ lastHardDrop: { id: 1, cols: [7, 8], row: 9, distance: 5 } }));
    expect(ev).toContainEqual({ type: "lock" });
  });

  it("detects a line clear from a score increase and estimates squares", () => {
    const d = new AudioEventDeriver();
    d.derive(rs({ score: 0 }));
    const ev = d.derive(rs({ score: 160 }));
    expect(ev).toContainEqual({ type: "lineClear", squares: 4, combo: 0 });
  });

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
});
