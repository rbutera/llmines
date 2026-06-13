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
    // Push the canonical grid tempo (BPM) so the time->column conversion these
    // tests assert against (one eighth-note at BPM = one column) holds, latched
    // at the baseline frame below. (The controller's default is the fallback
    // tempo; the host pushes the real track tempo in production.)
    c.testSetTempo(BPM);
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
    //    (dt=0); the next frame advances. Board must move forward. The combined
    //    build arms the new-block hold on spawn (brownfield feature), which
    //    suspends gravity until the hold lapses; advance past the hold window so
    //    this frame measures real gravity accumulation, not the suspended hold.
    clock.value = 1; // 1s — first nonzero reading, baseline frame
    c.testProductionFrame();
    // The combined build arms the new-block hold on spawn (brownfield feature),
    // suspending gravity until it lapses. Production gravity dt is clamped to
    // 100ms/frame (tab-out guard), so drive enough 100ms frames to run the hold
    // out, then one more so gravity actually accumulates. The sweep advances on
    // every frame (it is not gated by the hold), so it moves forward throughout.
    let t = 1;
    for (let i = 0; i < 7; i++) {
      t += 0.1; // +100ms per frame
      clock.value = t;
      c.testProductionFrame();
    }
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
    // Run the sweep at the canonical grid tempo (BPM) so the SEC_PER_EIGHTH
    // column math above lines up; latched at the baseline frame (sweepX === 0).
    c.setTempo(BPM);
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
    // Faithful rule: 2 squares x 40 = 80, banked ONCE; the board is emptied by
    // the clear -> all-clear bonus (10,000).
    expect(c.testState().score).toBe(80 + 10000);

    c.stop();
  });
});

describe("Tempo-driven sweep progression (9.x)", () => {
  // The controller's FALLBACK tempo (its default before the host pushes a real
  // track tempo) is 110 BPM; one eighth-note at the fallback = one column.
  const FALLBACK = 110;
  const SEC_PER_EIGHTH = 60 / FALLBACK / 2;
  const MS_PER_EIGHTH = SEC_PER_EIGHTH * 1000;

  function primed(): GameController {
    const c = new GameController({ testMode: true, seed: 1 });
    c.testBeatFrame(MS_PER_EIGHTH); // establish the baseline frame
    return c;
  }

  it("9.1 the sweep advances at the controller's fallback tempo before any push", () => {
    const c = primed();
    // At the fallback tempo, one eighth-note's worth of clock time advances ~one
    // column, and the HUD bpm reads the fallback.
    expect(c.getRenderState().bpm).toBe(FALLBACK);
    const before = c.testState().sweepX;
    c.testBeatFrame(MS_PER_EIGHTH);
    expect(c.testState().sweepX - before).toBeCloseTo(1, 6);
  });

  it("9.2 a higher pushed tempo advances more columns per second of clock time, latched at the pass boundary", () => {
    const slow = primed();
    const slowBefore = slow.testState().sweepX;
    slow.testBeatFrame(MS_PER_EIGHTH);
    const slowDelta = slow.testState().sweepX - slowBefore;
    expect(slowDelta).toBeCloseTo(1, 6);

    // Push a faster tempo, then run a full pass so the latch adopts it at the
    // next bar boundary (sweepX wraps to 0).
    const fast = primed();
    fast.testSetTempo(165);
    // Run a full pass so sweepX returns to ~0 and the new tempo latches.
    fast.testBeatFrame(16 * MS_PER_EIGHTH);
    expect(fast.getRenderState().bpm).toBe(165);
    const fastBefore = fast.testState().sweepX;
    fast.testBeatFrame(MS_PER_EIGHTH);
    const fastDelta = fast.testState().sweepX - fastBefore;
    // Same clock dt, higher tempo -> more columns advanced (proportional to BPM).
    expect(fastDelta).toBeGreaterThan(slowDelta);
    expect(fastDelta).toBeCloseTo(165 / FALLBACK, 6);
  });

  it("9.3 a clear does NOT change the sweep tempo (no core skin progression)", () => {
    const c = primed();
    const bpmBefore = c.getRenderState().bpm;
    // Build a 3x11 mono block on the floor = 20 squares and sweep it.
    for (let r = ROWS - 3; r < ROWS; r++) {
      for (let col = 0; col < 11; col++) c.testSetCell(r, col, 0);
    }
    c.testSweepNow();
    // Tempo is host-driven only; clearing squares must not advance it.
    expect(c.getRenderState().bpm).toBe(bpmBefore);
  });

  it("9.4 a mid-pass tempo change does not discontinuously jump the bar", () => {
    const c = primed();
    // Advance a few columns into the pass (well short of the wrap).
    c.testBeatFrame(3 * MS_PER_EIGHTH);
    const xBefore = c.testState().sweepX;
    expect(xBefore).toBeGreaterThan(0);
    expect(xBefore).toBeLessThan(COLS - 1);
    // Push a new tempo mid-pass.
    c.testSetTempo(165);
    // The next frame with dt=0 must NOT move the bar at all (no jump from the
    // tempo change itself); the new tempo only takes effect from the next bar.
    c.testBeatFrame(0);
    expect(c.testState().sweepX).toBeCloseTo(xBefore, 6);
    // And a tiny further advance is continuous (no discontinuous leap): the bar
    // moves by roughly one column for one eighth-note even mid-pass, because the
    // active tempo is still the latched (pre-change) value until the next bar.
    c.testBeatFrame(MS_PER_EIGHTH);
    const moved = c.testState().sweepX - xBefore;
    expect(moved).toBeGreaterThan(0);
    expect(moved).toBeLessThan(2); // continuous, not a jump
  });

  it("9.5 setSkinIndex projects straight into the render state (render-only, no timing effect)", () => {
    const c = primed();
    expect(c.getRenderState().skinIndex).toBe(0);
    const xBefore = c.testState().sweepX;
    c.setSkinIndex(1);
    expect(c.getRenderState().skinIndex).toBe(1);
    // It must not perturb timing.
    expect(c.testState().sweepX).toBeCloseTo(xBefore, 6);
  });

  it("9.7 a pushed tempo latches across a wrap-crossing frame (not just exact-boundary frames)", () => {
    const c = primed();
    // Advance partway into the pass, then push a new tempo mid-pass.
    c.testBeatFrame(3 * MS_PER_EIGHTH);
    c.testSetTempo(165);
    // The latched tempo is still the old one until a boundary is crossed.
    expect(c.getRenderState().bpm).toBe(FALLBACK);
    // A single frame large enough to CROSS the wrap (the bar never lands exactly
    // on sweepX === 0). After the crossing the new tempo must be latched.
    c.testBeatFrame(20 * MS_PER_EIGHTH);
    expect(c.getRenderState().bpm).toBe(165);
    // And the bar now advances at the new tempo.
    const before = c.testState().sweepX;
    c.testBeatFrame(MS_PER_EIGHTH);
    expect(c.testState().sweepX - before).toBeCloseTo(165 / FALLBACK, 6);
  });

  it("9.6 clearing squares does NOT advance the skin index (only setSkinIndex does)", () => {
    const c = primed();
    expect(c.getRenderState().skinIndex).toBe(0);
    // A 3x11 mono block on the floor = 20 squares; sweep it (a real clear).
    for (let r = ROWS - 3; r < ROWS; r++) {
      for (let col = 0; col < 11; col++) c.testSetCell(r, col, 0);
    }
    c.testSweepNow();
    expect(c.testState().score).toBeGreaterThan(0); // a clear really happened
    // The skin index is host-driven (song completion / restart) only — a clear
    // must NOT touch it. (The old core auto-advanced it every 20 squares.)
    expect(c.getRenderState().skinIndex).toBe(0);
  });
});

describe("Specials via the test seam (5.5)", () => {
  it("setSpecial places a chain cell that surfaces in state().specials", () => {
    const c = new GameController({ testMode: true, seed: 1 });
    c.testSetCell(ROWS - 1, 0, 0);
    c.testSetSpecial(ROWS - 1, 0);
    expect(c.testState().specials).toContain((ROWS - 1) * COLS + 0);
  });

  it("a chain in a cleared square floods its connected region via the seam", () => {
    const c = new GameController({ testMode: true, seed: 1 });
    // mono-0 square cols 0-1 + same-colour tail to col 6, chain on (ROWS-1,0).
    c.testSetCell(ROWS - 1, 0, 0);
    c.testSetCell(ROWS - 1, 1, 0);
    c.testSetCell(ROWS - 2, 0, 0);
    c.testSetCell(ROWS - 2, 1, 0);
    for (let col = 2; col <= 6; col++) c.testSetCell(ROWS - 1, col, 0);
    c.testSetSpecial(ROWS - 1, 0);
    c.testSweepNow();
    for (let col = 0; col <= 6; col++) {
      expect(c.testState().grid[ROWS - 1]![col]).toBe(null);
    }
    expect(c.testState().specials).toHaveLength(0);
  });
});
