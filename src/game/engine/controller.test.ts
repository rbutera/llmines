import { afterEach, describe, expect, it } from "vitest";
import { canPlace } from "../core";
import { GameController, type RenderState } from "./controller";

/**
 * Regression tests for the bottom-row clip/delay fix.
 *
 * The production controller drives gravity from a requestAnimationFrame loop and
 * imports only the pure core (no DOM/pixi), so we run it under the default `node`
 * vitest environment by stubbing rAF to capture the frame callback and pumping
 * frames with controlled timestamps. This reaches the real "resting but not yet
 * locked" window where the clip artifact lives.
 */

const GRAVITY_INTERVAL_MS = 700; // mirrors core/constants.ts

/** Drive the captured production frame loop deterministically. */
function makeRunner() {
  let frameCb: ((ts: number) => void) | null = null;
  const origRaf = globalThis.requestAnimationFrame;
  const origCancel = globalThis.cancelAnimationFrame;
  // Capture the latest scheduled frame callback; the loop re-schedules itself.
  globalThis.requestAnimationFrame = (cb: FrameRequestCallback) => {
    frameCb = cb;
    return 1;
  };
  globalThis.cancelAnimationFrame = () => undefined;

  let ts = 0;
  return {
    /** Advance the loop by `ms` (production clamps a single frame to <=100ms). */
    pump(ms: number): void {
      ts += ms;
      frameCb?.(ts);
    },
    restore(): void {
      globalThis.requestAnimationFrame = origRaf;
      globalThis.cancelAnimationFrame = origCancel;
    },
  };
}

/** True if the active piece in this snapshot cannot descend (is resting). */
function isResting(rs: RenderState): boolean {
  if (!rs.active) return false;
  return !canPlace(rs.grid, rs.active.cells, {
    row: rs.active.pos.row + 1,
    col: rs.active.pos.col,
  });
}

/** True once a piece has locked into the settled grid (any non-null cell). */
function hasLocked(rs: RenderState): boolean {
  return rs.grid.some((row) => row.some((c) => c !== null));
}

let runner: ReturnType<typeof makeRunner> | null = null;
afterEach(() => {
  runner?.restore();
  runner = null;
});

describe("GameController render fallProgress (bottom-row clip fix)", () => {
  it("reports fallProgress = 0 while the active piece is resting (never overshoots its row)", () => {
    runner = makeRunner();
    const c = new GameController({ testMode: false, seed: 1 });
    c.start(); // spawns first piece + schedules the production loop

    // Drive gravity in 100ms steps until the piece is resting on the floor but
    // has NOT yet locked (the exact window where it used to clip below the canvas).
    let rs = c.getRenderState();
    let guard = 0;
    while (!(isResting(rs) && !hasLocked(rs)) && guard++ < 2000) {
      runner.pump(100);
      rs = c.getRenderState();
    }
    expect(isResting(rs)).toBe(true);
    expect(hasLocked(rs)).toBe(false);

    // Across every resting-not-locked frame (gravity accumulating toward the next
    // tick), the active piece must report no downward offset. Pre-fix, at least one
    // of these frames reported fallProgress > 0 (drawn below the floor → clip).
    let sawAccumulatingFrame = false;
    guard = 0;
    while (isResting(rs) && !hasLocked(rs) && guard++ < 20) {
      expect(rs.fallProgress).toBe(0);
      // Confirm we exercise frames mid-interval (gravityAccumMs > 0), not just the
      // boundary — this is what would have produced a non-zero offset before.
      sawAccumulatingFrame = true;
      runner.pump(100);
      rs = c.getRenderState();
    }
    expect(sawAccumulatingFrame).toBe(true);

    c.stop();
  });

  it("keeps interpolating (fallProgress > 0) while a piece is mid-fall (no regression)", () => {
    runner = makeRunner();
    const c = new GameController({ testMode: false, seed: 1 });
    c.start();

    // New blocks HOLD for one beat before gravity engages; lapse the hold first
    // so the piece is genuinely mid-fall before asserting interpolation.
    let rs = c.getRenderState();
    let guard = 0;
    while (rs.hold.active && guard++ < 50) {
      runner.pump(100);
      rs = c.getRenderState();
    }
    // One partial step (< one gravity interval) after the hold: the piece is high
    // up, can still descend, so smooth-descent interpolation must be active.
    runner.pump(100);
    rs = c.getRenderState();
    expect(rs.active).not.toBeNull();
    expect(isResting(rs)).toBe(false);
    expect(rs.fallProgress).toBeGreaterThan(0);
    expect(rs.fallProgress).toBeLessThanOrEqual(1);
    // 100ms of the 700ms interval has accumulated past the hold.
    expect(rs.fallProgress).toBeCloseTo(100 / GRAVITY_INTERVAL_MS, 5);

    c.stop();
  });
});

const HOLD_MS = 500; // mirrors core/constants.ts (one beat)

/** Pump 100ms frames until the hold lapses (or a guard trips); returns latest snapshot. */
function pumpUntilHoldEnds(
  c: GameController,
  runner: ReturnType<typeof makeRunner>,
): RenderState {
  let rs = c.getRenderState();
  let guard = 0;
  while (rs.hold.active && guard++ < 50) {
    runner.pump(100);
    rs = c.getRenderState();
  }
  return rs;
}

describe("GameController new-block hold (US1: hold + no carry-over)", () => {
  it("holds on spawn and does not descend while the hold is active", () => {
    runner = makeRunner();
    const c = new GameController({ testMode: false, seed: 1 });
    c.start();

    let rs = c.getRenderState();
    expect(rs.hold.active).toBe(true);
    expect(rs.hold.remainingMs).toBe(HOLD_MS);
    expect(rs.active?.pos.row).toBe(0);

    // Prime frame (dt=0) + 300ms < HOLD_MS: still holding, no descent.
    runner.pump(100);
    runner.pump(100);
    runner.pump(100);
    runner.pump(100);
    rs = c.getRenderState();
    expect(rs.hold.active).toBe(true);
    expect(rs.hold.remainingMs).toBeGreaterThan(0);
    expect(rs.hold.remainingMs).toBeLessThan(HOLD_MS);
    expect(rs.active?.pos.row).toBe(0);

    c.stop();
  });

  it("ignores a carried-over (non-fresh) soft-drop during the hold", () => {
    runner = makeRunner();
    const c = new GameController({ testMode: false, seed: 1 });
    c.start();

    c.input("softDrop", { fresh: false });
    const rs = c.getRenderState();
    expect(rs.hold.active).toBe(true); // hold not ended
    expect(rs.active?.pos.row).toBe(0); // no descent
    c.stop();
  });

  it("allows move/rotate during the hold without changing the timer", () => {
    runner = makeRunner();
    const c = new GameController({ testMode: false, seed: 1 });
    c.start();
    runner.pump(100); // prime
    runner.pump(100); // 100ms elapsed -> remaining 400

    let rs = c.getRenderState();
    const rem = rs.hold.remainingMs;
    const col = rs.active!.pos.col;

    c.input("left", { fresh: true });
    rs = c.getRenderState();
    expect(rs.active?.pos.col).toBe(col - 1);
    expect(rs.hold.active).toBe(true);
    expect(rs.hold.remainingMs).toBe(rem); // move did not touch the hold timer
    c.stop();
  });
});

describe("GameController new-block hold (US2: fresh press drops immediately)", () => {
  it("ends the hold and descends immediately on a fresh soft-drop", () => {
    runner = makeRunner();
    const c = new GameController({ testMode: false, seed: 1 });
    c.start();

    let rs = c.getRenderState();
    expect(rs.hold.active).toBe(true);
    expect(rs.active?.pos.row).toBe(0);

    c.input("softDrop", { fresh: true });
    rs = c.getRenderState();
    expect(rs.hold.active).toBe(false);
    expect(rs.active?.pos.row).toBe(1); // descended one row right away
    c.stop();
  });
});

describe("GameController new-block hold (US3: lapse to normal gravity)", () => {
  it("does not instant-drop at lapse and then falls at the normal interval", () => {
    runner = makeRunner();
    const c = new GameController({ testMode: false, seed: 1 });
    c.start();

    let rs = pumpUntilHoldEnds(c, runner);
    expect(rs.hold.active).toBe(false);
    // No instant catch-up: at the moment the hold lapses the piece is still at row 0.
    expect(rs.active?.pos.row).toBe(0);

    // It takes ~one full gravity interval (700ms) to drop the first row — i.e.
    // normal gravity, not the soft-drop cadence.
    let g = 0;
    while (rs.active?.pos.row === 0 && g++ < 12) {
      runner.pump(100);
      rs = c.getRenderState();
    }
    expect(rs.active?.pos.row).toBe(1);
    expect(g).toBeGreaterThanOrEqual(5); // not instant (would be ~1)
    c.stop();
  });

  it("accepts a fresh soft-drop normally after the hold has lapsed", () => {
    runner = makeRunner();
    const c = new GameController({ testMode: false, seed: 1 });
    c.start();

    const rs = pumpUntilHoldEnds(c, runner);
    const row = rs.active!.pos.row;
    c.input("softDrop", { fresh: true });
    expect(c.getRenderState().active?.pos.row).toBe(row + 1);
    c.stop();
  });
});
