import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GameController } from "./controller";
import { GRAVITY_INTERVAL_MS, SOFT_DROP_INTERVAL_MS } from "../core";
import type { Clock } from "../time/clock";

/**
 * Hold-to-sustain soft drop + Escape pause, exercised through the REAL production
 * frame path (testMode:false + a scripted clock + stubbed rAF), so the sustained
 * cadence and the pause freeze are tested end to end, not via the deterministic
 * single-step seam.
 */

class ScriptedClock implements Clock {
  value = 0;
  now(): number {
    return this.value;
  }
}

const g = globalThis as unknown as {
  requestAnimationFrame?: (cb: FrameRequestCallback) => number;
  cancelAnimationFrame?: (handle: number) => void;
};
let savedRaf: typeof g.requestAnimationFrame;
let savedCaf: typeof g.cancelAnimationFrame;
beforeEach(() => {
  savedRaf = g.requestAnimationFrame;
  savedCaf = g.cancelAnimationFrame;
  g.requestAnimationFrame = () => 1; // install but never self-invoke
  g.cancelAnimationFrame = () => undefined;
});
afterEach(() => {
  g.requestAnimationFrame = savedRaf;
  g.cancelAnimationFrame = savedCaf;
});

/** Run `n` production frames, each advancing the clock by `dtMs`. */
function runFrames(c: GameController, clock: ScriptedClock, n: number, dtMs: number) {
  for (let i = 0; i < n; i++) {
    clock.value += dtMs / 1000;
    c.testProductionFrame();
  }
}

/** Drive past the new-block spawn-hold so gravity actually accumulates. */
function clearSpawnHold(c: GameController, clock: ScriptedClock) {
  // clock.value=0 means suspended; bump to a baseline first.
  clock.value = 1;
  c.testProductionFrame();
  runFrames(c, clock, 8, 100); // 8x100ms > HOLD_MS, lapses the hold
}

describe("hold-to-sustain soft drop (production path)", () => {
  it("a fresh soft-drop press makes the piece descend FASTER than gravity while held", () => {
    // --- Baseline: gravity alone over a short window moves the piece 0 rows. ---
    const cg = new GameController({ testMode: false, seed: 1, clock: new ScriptedClock() });
    // (use a fresh scripted clock per controller)
    const gravClock = cg.getClock() as unknown as ScriptedClock;
    cg.start();
    clearSpawnHold(cg, gravClock);
    const gravStart = cg.getRenderState().active?.pos.row ?? -1;
    // ~120ms (< one 700ms gravity interval) with NO soft-drop engaged: no descent.
    runFrames(cg, gravClock, 4, 30);
    const gravFell = (cg.getRenderState().active?.pos.row ?? -1) - gravStart;
    cg.stop();
    expect(gravFell).toBe(0); // gravity alone: 120ms moves nothing

    // --- Sustained: a held soft-drop descends multiple rows over that SAME
    //     short window — strictly faster than gravity. ---
    const clock = new ScriptedClock();
    const c = new GameController({ testMode: false, seed: 1, clock });
    c.start();
    clearSpawnHold(c, clock);

    const startRow = c.getRenderState().active?.pos.row ?? -1;
    c.pressSoftDrop(); // immediate step (+1 row) + engage sustained mode
    // 120ms in 30ms frames = 2 soft-drop intervals (60ms each) → 2 more rows.
    runFrames(c, clock, 4, 30);
    const sustainedFell = (c.getRenderState().active?.pos.row ?? -1) - startRow;

    expect(sustainedFell).toBeGreaterThan(1); // continuous, not one-shot
    expect(sustainedFell).toBeGreaterThan(gravFell); // strictly faster than gravity
    expect(SOFT_DROP_INTERVAL_MS).toBeLessThan(GRAVITY_INTERVAL_MS);

    c.stop();
  });

  it("releasing the key reverts to the slow gravity cadence", () => {
    const clock = new ScriptedClock();
    const c = new GameController({ testMode: false, seed: 1, clock });
    c.start();
    clearSpawnHold(c, clock);

    const rowNow = () => c.getRenderState().active?.pos.row ?? -1;

    c.pressSoftDrop();
    runFrames(c, clock, 4, 30); // fall a bit while held
    c.releaseSoftDrop(); // key up -> back to gravity

    const rowAfterRelease = rowNow();
    // A short post-release span (< one gravity interval) must NOT keep dropping
    // at soft-drop speed: at most the one gravity tick if the boundary is crossed.
    runFrames(c, clock, 5, 30); // 150ms << 700ms gravity interval
    const rowLater = rowNow();
    expect(rowLater - rowAfterRelease).toBeLessThanOrEqual(1);

    c.stop();
  });
});

describe("Escape pause/resume (production path)", () => {
  it("pausing freezes the sweep and gravity; resuming continues forward", () => {
    const clock = new ScriptedClock();
    const c = new GameController({ testMode: false, seed: 1, clock });
    c.start();
    clearSpawnHold(c, clock);

    const sweepX = () => c.getRenderState().sweepX;

    runFrames(c, clock, 3, 50);
    const sweepBeforePause = sweepX();

    c.pause();
    expect(c.isPaused()).toBe(true);
    const gravityAtPause = c.testGravityAccumMs();
    // While paused, frames must not advance the sweep or gravity.
    runFrames(c, clock, 5, 50);
    expect(sweepX()).toBe(sweepBeforePause);
    expect(c.testGravityAccumMs()).toBe(gravityAtPause);

    // Resume: re-anchors the baseline, then the next valid frame advances forward.
    c.resume();
    expect(c.isPaused()).toBe(false);
    clock.value += 0.05; // baseline frame (dt=0 after re-anchor)
    c.testProductionFrame();
    runFrames(c, clock, 3, 50);
    expect(sweepX()).toBeGreaterThan(sweepBeforePause);

    c.stop();
  });

  it("togglePause flips between paused and running", () => {
    const clock = new ScriptedClock();
    const c = new GameController({ testMode: false, seed: 1, clock });
    c.start();
    clearSpawnHold(c, clock);

    expect(c.isPaused()).toBe(false);
    c.togglePause();
    expect(c.isPaused()).toBe(true);
    c.togglePause();
    expect(c.isPaused()).toBe(false);

    c.stop();
  });
});
