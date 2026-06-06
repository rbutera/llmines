import { describe, expect, it } from "vitest";
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
