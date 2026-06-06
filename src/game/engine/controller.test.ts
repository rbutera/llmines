import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Piece, PublicState } from "../core";
import { __resetAudioClockForTests } from "../audio/clock";
import { type Clock, FakeClock } from "../time/clock";
import { GameController } from "./controller";

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
});
