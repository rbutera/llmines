import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BPM, COLS, ROWS, type Piece, type PublicState } from "../core";
import { __resetAudioClockForTests } from "../audio/clock";
import { type Clock, FakeClock } from "../time/clock";
import { forwardDelta, GameController } from "./controller";

const MONO_A: Piece = [
  [0, 0],
  [0, 0],
];
const MONO_B: Piece = [
  [1, 1],
  [1, 1],
];

describe("GameController clock injection", () => {
  it("defaults to a FakeClock in test mode", () => {
    const c = new GameController({ testMode: true, seed: 1 });
    expect(c.getClock()).toBeInstanceOf(FakeClock);
  });

  it("defaults to a non-FakeClock (AudioClock) in production mode", () => {
    // jsdom has no AudioContext, so createAudioClock falls back to a clock that
    // reports 0; either way the default must NOT be a FakeClock.
    __resetAudioClockForTests();
    const c = new GameController({ testMode: false, seed: 1 });
    expect(c.getClock()).not.toBeInstanceOf(FakeClock);
    expect(typeof c.getClock().now()).toBe("number");
  });

  it("honours an explicitly injected clock", () => {
    const injected: Clock = { now: () => 42 };
    const c = new GameController({ testMode: false, seed: 1, clock: injected });
    expect(c.getClock()).toBe(injected);
    expect(c.getClock().now()).toBe(42);
  });
});

describe("Regression: clock seam does not drift behaviour", () => {
  /** Drive a deterministic scripted game, advancing the sweep via `step`. */
  function play(step: (c: GameController, dtMs: number) => void): PublicState {
    const c = new GameController({ testMode: true, seed: 7 });
    c.testSeed(7);
    // Scripted, deterministic input sequence touching spawn + sweep scoring.
    c.testSpawn(MONO_A);
    step(c, 250);
    c.testSpawn(MONO_B);
    step(c, 500);
    c.testTick();
    step(c, 250);
    c.testSweepNow();
    step(c, 1000);
    return c.testState();
  }

  it("clockAdvance yields identical state to sweepProgress for the same inputs", () => {
    const viaSweepProgress = play((c, dt) => c.testSweepProgress(dt));
    const viaClockAdvance = play((c, dt) => c.testClockAdvance(dt));
    expect(viaClockAdvance).toEqual(viaSweepProgress);
  });

  it("clockAdvance is step-size independent on the resulting state", () => {
    const oneShot = play((c, dt) => c.testClockAdvance(dt));
    const split = play((c, dt) => {
      // Advance the same total dt in 5 equal steps.
      for (let i = 0; i < 5; i++) c.testClockAdvance(dt / 5);
    });
    expect(split).toEqual(oneShot);
  });
});

describe("forwardDelta (wrap-aware sweep delta)", () => {
  it("plain forward delta with no wrap", () => {
    expect(forwardDelta(2, 5, COLS)).toBe(3);
  });
  it("wraps when target is behind (one wrap added)", () => {
    expect(forwardDelta(15, 1, COLS)).toBe(2); // 15 -> 16(=0) -> 1
  });
  it("zero when equal", () => {
    expect(forwardDelta(7, 7, COLS)).toBe(0);
  });
});

describe("Beat-derived sweep timing (5.x)", () => {
  /** Seconds per eighth-note at the current BPM (one column's worth of time). */
  const SEC_PER_EIGHTH = 60 / BPM / 2; // beat = 60/BPM; eighth = beat/2
  const MS_PER_EIGHTH = SEC_PER_EIGHTH * 1000;

  /** Fresh test-mode controller with a FakeClock, primed past the baseline frame. */
  function primed(): GameController {
    const c = new GameController({ testMode: true, seed: 1 });
    // First beat-frame establishes the sweep baseline (sweepStartT) and does not
    // advance; prime it so subsequent frames measure from a known origin.
    c.testBeatFrame(MS_PER_EIGHTH); // baseline frame (clock now > 0, no prior)
    return c;
  }

  it("5.1 one eighth-note advances exactly one column", () => {
    const c = primed();
    const before = c.testState().sweepX;
    c.testBeatFrame(MS_PER_EIGHTH);
    expect(c.testState().sweepX - before).toBeCloseTo(1, 6);
  });

  it("5.2 two full 4/4 bars complete exactly one pass and wrap to the left edge", () => {
    const c = primed();
    // Two 4/4 bars = 8 beats = 16 eighth-notes = 16 columns = one full pass.
    c.testBeatFrame(16 * MS_PER_EIGHTH);
    expect(c.testState().sweepX).toBeCloseTo(0, 6); // wrapped to the left edge
    expect(c.testSweepColumnsConsumed()).toBeCloseTo(16, 6);
  });

  it("5.3 frame-rate independence: 3 eighths in one step == three steps (sweepX + grid)", () => {
    // Empty board: gravity is a no-op (no active piece), so the comparison
    // isolates the absolute-time sweep path. (A clearable-square variant of this
    // determinism property is proven directly against the pure core below.)
    const oneStep = primed();
    oneStep.testBeatFrame(3 * MS_PER_EIGHTH);

    const threeSteps = primed();
    threeSteps.testBeatFrame(MS_PER_EIGHTH);
    threeSteps.testBeatFrame(MS_PER_EIGHTH);
    threeSteps.testBeatFrame(MS_PER_EIGHTH);

    expect(threeSteps.testState().grid).toEqual(oneStep.testState().grid);
    expect(threeSteps.testState().sweepX).toBeCloseTo(
      oneStep.testState().sweepX,
      6,
    );
    expect(threeSteps.testSweepColumnsConsumed()).toBeCloseTo(
      oneStep.testSweepColumnsConsumed(),
      6,
    );
  });

  it("5.4 dropped frame: position matches absolute time with no cumulative drift", () => {
    const c = primed();
    // Simulate a big gap (a dropped/delayed frame spanning 5 eighth-notes).
    c.testBeatFrame(5 * MS_PER_EIGHTH);
    // Then a normal frame.
    c.testBeatFrame(MS_PER_EIGHTH);
    // Total elapsed since baseline = 6 eighth-notes = 6 columns.
    expect(c.testSweepColumnsConsumed()).toBeCloseTo(6, 6);
    expect(c.testState().sweepX).toBeCloseTo(6, 6);
  });
});

describe("Production clock→dt path: suspended + re-suspend", () => {
  /**
   * A scriptable clock standing in for the AudioClock. `now()` returns 0 while
   * suspended (matching the real AudioClock) and the scripted value otherwise.
   */
  class ScriptedClock implements Clock {
    value = 0;
    now(): number {
      return this.value;
    }
  }

  // Stub rAF/cAF so the production start() loop installs but never self-runs;
  // the test drives frames deterministically via testProductionFrame(). The
  // node test env has no requestAnimationFrame.
  const g = globalThis as unknown as {
    requestAnimationFrame?: (cb: FrameRequestCallback) => number;
    cancelAnimationFrame?: (handle: number) => void;
  };
  let savedRaf: typeof g.requestAnimationFrame;
  let savedCaf: typeof g.cancelAnimationFrame;
  beforeEach(() => {
    savedRaf = g.requestAnimationFrame;
    savedCaf = g.cancelAnimationFrame;
    g.requestAnimationFrame = () => 1; // install but do not invoke the callback
    g.cancelAnimationFrame = () => undefined;
  });
  afterEach(() => {
    g.requestAnimationFrame = savedRaf;
    g.cancelAnimationFrame = savedCaf;
  });

  it("freezes while now()=0, animates once nonzero, and a →0 re-suspend never runs backwards", () => {
    const clock = new ScriptedClock();
    // Production mode (testMode:false) so start() auto-spawns and the real
    // runFrame/derive-dt path is exercised via testProductionFrame().
    const c = new GameController({ testMode: false, seed: 1, clock });
    c.start();

    const sweepX = () => c.getRenderState().sweepX;
    // The RAW gravity accumulator (NOT renderState.fallProgress, which clamps to
    // >= 0 and so hides a negative accumulator). The negative-dt bug shows up here.
    const gravity = () => c.testGravityAccumMs();

    // 1) Suspended: now() === 0. Several frames must NOT advance the board.
    clock.value = 0;
    c.testProductionFrame();
    c.testProductionFrame();
    expect(sweepX()).toBe(0); // frozen, dt=0
    expect(gravity()).toBe(0); // gravity did not accumulate

    // 2) Resume: now() climbs. First nonzero frame establishes the baseline
    //    (dt=0); the next frame advances. Board must move forward.
    clock.value = 1; // 1s — first nonzero reading, baseline frame
    c.testProductionFrame();
    clock.value = 1.05; // +50ms
    c.testProductionFrame();
    const sweepAfterResume = sweepX();
    const gravityAfterResume = gravity();
    expect(sweepAfterResume).toBeGreaterThan(0); // sweep animated forward
    expect(gravityAfterResume).toBeGreaterThan(0); // gravity accumulated forward

    // 3) Re-suspend: now() drops back to 0 (tab backgrounding / iOS interrupt).
    //    dt MUST be 0 (NOT a large negative). Without the fix, dt would be
    //    (0 - 1.05)*1000 = -1050ms: sweep is protected by advanceSweep's
    //    columns<=0 guard, but gravityAccumMs would be driven NEGATIVE, stalling
    //    gravity. The accumulator must be unchanged here, never negative.
    clock.value = 0;
    c.testProductionFrame();
    expect(sweepX()).toBe(sweepAfterResume); // unchanged, not rewound
    expect(gravity()).toBe(gravityAfterResume); // accumulator unchanged
    expect(gravity()).toBeGreaterThanOrEqual(0); // never negative

    // 4) Resume again: clock climbs from where it left off → resumes cleanly,
    //    advancing forward once more.
    clock.value = 2; // baseline-establishing frame after re-suspend (dt=0)
    c.testProductionFrame();
    clock.value = 2.05; // +50ms
    c.testProductionFrame();
    expect(sweepX()).toBeGreaterThan(sweepAfterResume); // sweep forward again
    expect(gravity()).toBeGreaterThan(gravityAfterResume); // gravity forward again

    c.stop();
  });

  it("suspend MID-pass then resume does not drop or double a column at the seam", () => {
    const SEC_PER_EIGHTH = 60 / BPM / 2; // one column's worth of musical time

    // Two clearable mono-B 2x2 squares in DISTINCT column pairs, written DIRECTLY
    // onto the settled grid via the deterministic test interface (no gravity /
    // auto-spawn contamination): square A at the left wall (cols 0-1, crossed
    // BEFORE the seam) and square B further right (cols 6-7, crossed AFTER the
    // seam). One distinct 2x2 each → a full pass scores 8 cells * 2 squares = 16.
    function squareCleared(c: GameController, c0: number): boolean {
      const g = c.testState().grid;
      return (
        g[ROWS - 1]![c0] === null &&
        g[ROWS - 1]![c0 + 1] === null &&
        g[ROWS - 2]![c0] === null &&
        g[ROWS - 2]![c0 + 1] === null
      );
    }

    const clock = new ScriptedClock();
    const c = new GameController({ testMode: false, seed: 1, clock });
    // Lay both 2x2 squares directly on the floor (cols 0-1 and 6-7) so gravity
    // has nothing to drop and never auto-spawns mid-sweep.
    for (const c0 of [0, 6]) {
      c.testSetCell(ROWS - 1, c0, 1);
      c.testSetCell(ROWS - 1, c0 + 1, 1);
      c.testSetCell(ROWS - 2, c0, 1);
      c.testSetCell(ROWS - 2, c0 + 1, 1);
    }
    expect(c.testState().distinctSquares).toBe(2); // two clearable squares

    // 1) Baseline frame establishes sweepStartT (dt=0, no advance).
    clock.value = 1;
    c.testProductionFrame();
    // 2) Advance ~4 columns: crosses square A (cols 0-1) but not square B.
    clock.value = 1 + 4 * SEC_PER_EIGHTH;
    c.testProductionFrame();
    const midX = c.getRenderState().sweepX;
    expect(midX).toBeGreaterThan(2); // past square A
    expect(midX).toBeLessThan(6); // not yet at square B
    expect(squareCleared(c, 0)).toBe(true); // A already deleted incrementally
    expect(squareCleared(c, 6)).toBe(false); // B untouched so far
    expect(c.testState().score).toBe(0); // not banked until pass end

    // 3) Suspend MID-pass: now() → 0. Re-anchors the baseline; the in-flight
    //    sweepPass (processedCols) is preserved so no column re-runs or is skipped.
    clock.value = 0;
    c.testProductionFrame();
    expect(c.getRenderState().sweepX).toBe(midX); // frozen, not rewound
    expect(squareCleared(c, 0)).toBe(true); // A NOT resurrected/re-deleted

    // 4) Resume: a baseline frame (dt=0) then finish the rest of the pass,
    //    continuing cleanly from the re-anchored baseline through the wrap.
    clock.value = 2;
    c.testProductionFrame();
    const remainingCols = COLS - c.getRenderState().sweepX;
    clock.value = 2 + (remainingCols + 0.5) * SEC_PER_EIGHTH; // cross the wrap
    c.testProductionFrame();

    // Seam correctness: square A (crossed before the seam) is gone exactly once
    // and square B (crossed after) is also gone — neither dropped nor doubled —
    // and the pass banked its full 16 once at the wrap.
    expect(squareCleared(c, 0)).toBe(true);
    expect(squareCleared(c, 6)).toBe(true);
    expect(c.getRenderState().sweepX).toBeLessThan(2); // wrapped to a fresh pass
    expect(c.testState().score).toBe(16); // 8 cells * 2 squares, banked ONCE

    c.stop();
  });
});
