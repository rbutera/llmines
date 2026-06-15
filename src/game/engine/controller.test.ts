import { afterEach, describe, expect, it } from "vitest";
import {
  COLS,
  GRAVITY_EASE_FLOOR_MS,
  GRAVITY_EASE_START_MS,
  GRAVITY_EASE_TAU_MS,
  GRAVITY_INTERVAL_MS,
  HOLD_MS,
  ROWS,
  type Piece,
} from "../core";
import { FakeClock } from "../time/clock";
import { GameController, type RenderState } from "./controller";

/** Frames (at 100ms each) needed to lapse the spawn-hold. */
const HOLD_FRAMES = HOLD_MS / 100;

/**
 * The eased per-row natural-gravity interval for a piece that has been falling
 * `fallMs` — mirrors the controller's `naturalGravityIntervalMs` so timing
 * assertions track the same curve (decays START -> FLOOR with TAU). Used to
 * assert acceleration: later rows take strictly less time than earlier ones.
 */
function easedInterval(fallMs: number): number {
  return Math.max(
    GRAVITY_EASE_FLOOR_MS,
    GRAVITY_EASE_FLOOR_MS +
      (GRAVITY_EASE_START_MS - GRAVITY_EASE_FLOOR_MS) *
        Math.exp(-fallMs / GRAVITY_EASE_TAU_MS),
  );
}

/**
 * Build a production controller wired to a FakeClock and a stubbed rAF, plus a
 * `step(dtMs)` driver. In the V2 clock-driven architecture the production frame
 * reads time from the injected clock (NOT the rAF timestamp), so `step` advances
 * the FakeClock and then fires the captured rAF callback to run exactly one
 * frame. The first frame after start only seeds the clock baseline (dt = 0).
 */
function productionWithClock(seed = 1): {
  c: GameController;
  step: (dtMs: number) => void;
} {
  let cb: ((ts: number) => void) | null = null;
  let ts = 0;
  (globalThis as unknown as { requestAnimationFrame: unknown }).requestAnimationFrame =
    (fn: (t: number) => void) => {
      cb = fn;
      return 1;
    };
  (globalThis as unknown as { cancelAnimationFrame: unknown }).cancelAnimationFrame =
    () => undefined;
  const clock = new FakeClock();
  const c = new GameController({ testMode: false, seed, clock });
  return {
    c,
    step: (dtMs: number) => {
      clock.advance(dtMs / 1000); // FakeClock is in seconds
      ts += dtMs;
      cb?.(ts);
    },
  };
}

/**
 * Start a production controller and lapse the new-block hold, leaving the piece
 * at the top with a clean gravity accumulator. The first step only seeds the
 * controller clock (dt=0); the next HOLD_FRAMES steps run out the hold without
 * any gravity, so gravity begins on the following step.
 */
function startAndRelease(
  c: GameController,
  step: (dtMs: number) => void,
): void {
  c.start();
  step(100); // seed the clock baseline (dt = 0, hold untouched)
  // HOLD_FRAMES ticks bring the hold remaining to ~0; one further frame flips it
  // to inactive (a tick that reaches 0 lapses on the NEXT frame). All of these
  // frames suspend gravity, so the accumulator stays at 0 afterwards.
  for (let i = 0; i < HOLD_FRAMES + 1; i++) step(100);
}

afterEach(() => {
  delete (globalThis as unknown as { requestAnimationFrame?: unknown })
    .requestAnimationFrame;
  delete (globalThis as unknown as { cancelAnimationFrame?: unknown })
    .cancelAnimationFrame;
});

const CHECKER: Piece = [
  [0, 1],
  [1, 0],
];

describe("fallProgress gating (bottom-row settle)", () => {
  it("interpolates while the piece can still descend", () => {
    const { c, step } = productionWithClock(1);
    startAndRelease(c, step); // spawn + lapse the hold; gravity accumulator at 0
    step(100); // 100ms accumulated toward the 700ms gravity tick

    const rs = c.getRenderState();
    expect(rs.active).not.toBeNull();
    expect(rs.active!.pos.row).toBe(-2); // still staged above the field (A5/D4)
    expect(rs.hold.active).toBe(false);
    // Smooth descent: a fractional offset toward the next row, interpolated
    // against the EASED FIRST-row interval. No row has dropped yet, so the curve
    // samples at fallMs=0 (the slow START interval), a touch slower than the
    // legacy flat 700ms cadence, so the offset is slightly smaller.
    expect(rs.fallProgress).toBeGreaterThan(0);
    expect(rs.fallProgress).toBeLessThanOrEqual(1);
    expect(rs.fallProgress).toBeCloseTo(100 / easedInterval(0), 5);
    // Strictly below the flat-700 offset, confirming the start-slow easing.
    expect(rs.fallProgress).toBeLessThan(100 / GRAVITY_INTERVAL_MS);
    c.stop();
  });

  it("reports zero fall offset once the piece rests on the bottom row", () => {
    const { c, step } = productionWithClock(1);
    startAndRelease(c, step);
    // The piece stages at row -2 and descends ROWS rows to the floor (pos.row =
    // ROWS-2). The exact wall-clock time to reach the floor depends on the eased
    // (accelerating) natural-gravity curve, so rather than a magic frame count
    // (which the curve tuning shifts) we drive fine frames until the piece is
    // RESTING on the bottom row, then assert the resting gate — robust to the
    // curve constants. We stop the instant it reaches the floor row, before the
    // lock+respawn (which would put a fresh piece back at the spawn row).
    let rs = c.getRenderState();
    for (let i = 0; i < 2000 && rs.active!.pos.row < ROWS - 2; i++) {
      step(10);
      rs = c.getRenderState();
    }

    expect(rs.active).not.toBeNull();
    expect(rs.active!.pos.row).toBe(ROWS - 2); // bottom cells on the last row
    expect(rs.fallProgress).toBe(0); // resting -> no downward overshoot
    c.stop();
  });
});

describe("bottom-row landing via the deterministic test API", () => {
  it("state().grid places the landed block on the bottom rows with no out-of-bounds cells", () => {
    const c = new GameController({ testMode: true });
    c.testSpawn(CHECKER);
    // Tick gravity until the piece can no longer descend (rests on the floor).
    for (let i = 0; i < ROWS + 2; i++) {
      const before = c.testState().grid.flat().filter(Boolean).length;
      c.testTick();
      const view = c.testState();
      const blockBottom = view.grid[ROWS - 1]!.some((x) => x !== null);
      if (blockBottom && before === view.grid.flat().filter(Boolean).length) {
        break; // landed and stable
      }
    }

    const { grid } = c.testState();
    // Grid shape is exactly ROWS x COLS — no out-of-bounds rows/cols possible.
    expect(grid.length).toBe(ROWS);
    expect(grid.every((row) => row.length === COLS)).toBe(true);
    // The 2x2 block occupies the bottom two rows of the spawn columns (7-8).
    expect(grid[ROWS - 1]![7]).not.toBeNull();
    expect(grid[ROWS - 1]![8]).not.toBeNull();
    expect(grid[ROWS - 2]![7]).not.toBeNull();
    expect(grid[ROWS - 2]![8]).not.toBeNull();
    // Exactly the 4 cells of the block are present — nothing leaked elsewhere.
    expect(grid.flat().filter((c2) => c2 !== null).length).toBe(4);
  });
});

describe("new-block hold (production timing)", () => {
  it("suspends gravity while held, then resumes at normal gravity", () => {
    const { c, step } = productionWithClock(1);
    c.start();
    step(100); // seed the clock (dt = 0)

    // Within the hold window the piece neither descends nor interpolates.
    for (let i = 0; i < HOLD_FRAMES - 1; i++) step(100); // 400ms < 500ms hold
    let rs = c.getRenderState();
    expect(rs.hold.active).toBe(true);
    expect(rs.active!.pos.row).toBe(-2); // staged above the field while held
    expect(rs.fallProgress).toBe(0);

    // The hold lapses; the piece is still at the top (no carried-over fast-fall).
    // One frame brings the remaining time to ~0; the next flips hold inactive
    // (a tick that reaches 0 lapses on the following frame). Gravity stays
    // suspended for both, so the piece does not descend.
    step(100);
    step(100);
    rs = c.getRenderState();
    expect(rs.hold.active).toBe(false);
    expect(rs.active!.pos.row).toBe(-2); // still staged (no carried-over fast-fall)

    // After one gravity interval it descends exactly one row (normal gravity).
    // The V2 clock->dt path accumulates from absolute-time deltas, which can
    // land a hair under the interval on the nominal frame (float drift), so
    // advance one extra frame to guarantee the accumulator crosses the
    // threshold; the piece must descend by exactly one row, not more.
    for (let i = 0; i < GRAVITY_INTERVAL_MS / 100 + 1; i++) step(100);
    expect(c.getRenderState().active!.pos.row).toBe(-1); // one row down from -2
    c.stop();
  });
});

describe("new-block hold (deterministic test API)", () => {
  it("a freshly spawned block is held; a carried-over hold does not fast-fall", () => {
    const c = new GameController({ testMode: true });
    c.testSpawn(CHECKER);
    expect(c.testState().hold).toEqual({ active: true, remainingMs: HOLD_MS });
    // Staged above the field at row -2 (A5/D4): not yet drawn into the board grid.
    expect(c.testRawState().active?.pos.row).toBe(-2);
    expect(c.testState().grid[0]![7]).toBeNull();

    // The first tick lapses the hold IN PLACE (no descent): still at row -2.
    c.testTick();
    expect(c.testState().hold.active).toBe(false);
    expect(c.testRawState().active?.pos.row).toBe(-2);

    // Each following tick descends exactly one row (no carried-over fast-fall):
    // -2 -> -1 -> 0. After two ticks the top cells enter the field at row 0.
    c.testTick();
    expect(c.testRawState().active?.pos.row).toBe(-1);
    c.testTick();
    expect(c.testRawState().active?.pos.row).toBe(0);
    expect(c.testState().grid[0]![7]).not.toBeNull();
  });

  it("a fresh soft-drop press ends the hold and descends immediately", () => {
    const c = new GameController({ testMode: true });
    c.testSpawn(CHECKER);
    expect(c.testState().hold.active).toBe(true);
    expect(c.testRawState().active?.pos.row).toBe(-2); // staged above the field

    c.testPressSoftDrop();
    expect(c.testState().hold.active).toBe(false);
    // Engaged immediately: descended one row from the staging row -2 to -1.
    expect(c.testRawState().active?.pos.row).toBe(-1);
  });

  it("a fresh hard-drop press ends the hold and locks at the bottom", () => {
    const c = new GameController({ testMode: true });
    c.testSpawn(CHECKER);

    c.testPressHardDrop();
    const s = c.testState();
    expect(s.hold.active).toBe(false);
    expect(s.grid[ROWS - 1]![7]).not.toBeNull();
    expect(s.grid[ROWS - 2]![7]).not.toBeNull();
    expect(s.grid.flat().filter((x) => x !== null).length).toBe(4);
  });

  it("after the hold ends, a normal soft-drop input descends", () => {
    const c = new GameController({ testMode: true });
    c.testSpawn(CHECKER);
    c.testTick(); // lapse the hold in place (still staged at row -2)
    expect(c.testState().hold.active).toBe(false);
    expect(c.testRawState().active?.pos.row).toBe(-2);

    c.input("softDrop"); // a normal (post-hold) soft drop now moves the piece
    expect(c.testRawState().active?.pos.row).toBe(-1); // descended one row
  });

  it("drop input is a no-op while held; move/rotate still apply during the hold", () => {
    const c = new GameController({ testMode: true });
    c.testSpawn(CHECKER);

    // Carried-over (key-repeat) drop while held: ignored, piece unmoved (still
    // staged at row -2, col 7).
    c.input("softDrop");
    c.input("hardDrop");
    expect(c.testState().hold.active).toBe(true);
    expect(c.testRawState().active?.pos).toEqual({ row: -2, col: 7 });

    // Move right applies during the hold and does not break it.
    c.input("right");
    expect(c.testRawState().active?.pos).toEqual({ row: -2, col: 8 });
    expect(c.testState().hold.active).toBe(true);

    // Rotate applies during the hold and does not break it.
    c.input("rotate");
    expect(c.testState().hold.active).toBe(true);
  });
});

describe("score value path (authoritative, independent of the animated FX)", () => {
  it("a cleared 2x2 square yields the exact score via state()", () => {
    const c = new GameController({ testMode: true });
    const MONO: Piece = [
      [0, 0],
      [0, 0],
    ];
    c.testSpawn(MONO);
    for (let i = 0; i < ROWS + 2; i++) c.testTick(); // land on the floor
    // The block is settled but not yet swept, so the score is still 0.
    expect(c.testState().score).toBe(0);

    c.testSweepNow();
    // V2 scoring supersedes the old `deletedCount * distinctSquares` rule:
    // 1 distinct square * 40 = 40, plus the all-clear board-state bonus (10,000)
    // because the board is empty after the sweep. This is the exact value the
    // `score` testid renders — the cosmetic ScoreFx never participates in this
    // number (the ScoreFx overlay fires off this same V2 score state).
    expect(c.testState().score).toBe(10040);
  });
});

describe("testEndGame (deterministic game-over for the account submit path)", () => {
  it("sets the exact final score + gameOver and emits", () => {
    const c = new GameController({ testMode: true });
    let last: RenderState | undefined;
    c.subscribe((rs) => {
      last = rs;
    });

    c.testEndGame(4242);

    expect(c.testState().score).toBe(4242);
    expect(c.testState().gameOver).toBe(true);
    expect(c.testState().grid.flat().every((x) => x === null)).toBe(true); // active cleared
    // Subscribers (e.g. GameShell's submit effect) see the game-over snapshot.
    expect(last?.gameOver).toBe(true);
    expect(last?.score).toBe(4242);
  });
});

describe("seed exposure (A4/D6): render-state + public-state carry the seed", () => {
  it("render-state exposes the current game's seed", () => {
    const c = new GameController({ testMode: true, seed: 13579 });
    expect(c.getRenderState().seed).toBe(13579);
  });

  it("public-state exposes the seed, and it is available on game over", () => {
    const c = new GameController({ testMode: true, seed: 24680 });
    expect(c.testState().seed).toBe(24680);
    c.testEndGame(100);
    // After game over the seed is still available (so the screen can show it).
    expect(c.testState().gameOver).toBe(true);
    expect(c.testState().seed).toBe(24680);
    expect(c.getRenderState().seed).toBe(24680);
  });

  it("restart with no seed reseeds randomly (not back to the same seed)", () => {
    const c = new GameController({ testMode: true, seed: 1 });
    c.restart(); // no argument -> fresh random seed
    expect(c.testState().seed).not.toBe(1);
  });
});

describe("top-out game over (A5/D4): no auto-spawn after a topping-out lock", () => {
  it("a spawn into a board full across the top ends the game and does not auto-spawn", () => {
    const c = new GameController({ testMode: true });
    // Fill the top two rows across EVERY column so no incoming 2x2 can enter anywhere
    // (a single blocked spawn column is NOT a top-out now — the piece stages and the
    // player can slide it; only a board full across the top tops out). testSpawn locks
    // any active piece first, then attempts to place the new one — which must top out.
    for (let col = 0; col < COLS; col++) {
      c.testSetCell(0, col, 1);
      c.testSetCell(1, col, 1);
    }
    c.testSpawn([
      [0, 0],
      [0, 0],
    ]);
    expect(c.testState().gameOver).toBe(true);
    expect(c.testRawState().active).toBe(null);
  });
});

/**
 * Drive a freshly-released production piece under NATURAL gravity at fine 10ms
 * frames and record the cumulative time (ms) of each one-row descent. Stops once
 * `maxRows` rows have been emitted or the piece locks (row jumps back up). The
 * returned deltas[i] = time between row i and row i+1 = the eased per-row
 * interval at that depth.
 */
function recordRowDrops(maxRows: number): number[] {
  const { c, step } = productionWithClock(1);
  c.start();
  step(100); // seed the clock baseline (dt = 0)
  // Lapse the spawn hold at fine resolution so the natural-fall clock AND the
  // gravity accumulator are both cleanly 0 the instant the hold releases (the
  // held branch pins both to 0 every frame), giving an uncontaminated first-row
  // measurement. A coarse 100ms lapse could bank up to ~100ms of fall first.
  while (c.getRenderState().hold.active) step(10);
  const times: number[] = [];
  let prevRow = c.getRenderState().active!.pos.row;
  let t = 0;
  // Generous frame budget: at 10ms/frame even the slow first rows resolve fast.
  for (let f = 0; f < 2000 && times.length < maxRows; f++) {
    step(10);
    t += 10;
    const row = c.getRenderState().active!.pos.row;
    if (row > prevRow) {
      times.push(t);
      prevRow = row;
    } else if (row < prevRow) {
      break; // locked + respawned -> stop before the curve resets
    }
  }
  c.stop();
  // Convert absolute crossing times into per-row deltas. The fall clock AND the
  // gravity accumulator are both 0 at release, so times[0] IS the first row's
  // interval (delta from t=0); subsequent deltas are crossing-to-crossing.
  const deltas: number[] = [];
  let prev = 0;
  for (const cross of times) {
    deltas.push(cross - prev);
    prev = cross;
  }
  return deltas;
}

describe("natural-gravity easing (per-piece acceleration)", () => {
  it("a piece left to natural gravity descends FASTER later than earlier", () => {
    // Collect the per-row intervals across the well. Each successive row should
    // take strictly less time than the one before (monotonic acceleration), and
    // the last row should be meaningfully faster than the first.
    const deltas = recordRowDrops(8);
    expect(deltas.length).toBeGreaterThanOrEqual(6);
    for (let i = 1; i < deltas.length; i++) {
      // Strictly shrinking (allow a 10ms frame-quantisation slack so float dt
      // jitter never produces a spurious equal/greater neighbour pair).
      expect(deltas[i]!).toBeLessThan(deltas[i - 1]! + 1);
      expect(deltas[i]!).toBeLessThanOrEqual(deltas[i - 1]!);
    }
    // The acceleration is real, not cosmetic: the later rows are clearly faster.
    expect(deltas[deltas.length - 1]!).toBeLessThan(deltas[0]! - 100);
    // First row tracks the eased START interval (slow), the curve has not floored.
    expect(deltas[0]!).toBeGreaterThan(GRAVITY_INTERVAL_MS); // slower than legacy
    expect(deltas[0]!).toBeGreaterThan(GRAVITY_EASE_FLOOR_MS + 200);
  });

  it("the acceleration RESETS per piece (a new spawn starts slow again)", () => {
    const { c, step } = productionWithClock(1);
    startAndRelease(c, step);
    // Let piece #1 fall a long way under natural gravity so its fall clock ramps
    // the interval well down toward the floor (fine 10ms frames, ~4s of fall).
    let prevRow = c.getRenderState().active!.pos.row;
    let lastRowChangeT = 0;
    let t = 0;
    let piece1FastRow = Number.POSITIVE_INFINITY;
    for (let f = 0; f < 600; f++) {
      step(10);
      t += 10;
      const row = c.getRenderState().active!.pos.row;
      if (row > prevRow) {
        piece1FastRow = t - lastRowChangeT; // a late, ramped-down interval
        lastRowChangeT = t;
        prevRow = row;
      } else if (row < prevRow) {
        break; // locked/respawned (shouldn't happen within 600 frames here)
      }
    }
    // Now hard-drop to force a lock + fresh spawn, resetting the fall clock.
    c.pressHardDrop();
    // Lapse the new piece's spawn hold at fine resolution so we can time its very
    // first natural row drop from a clean (zeroed) accumulator.
    while (c.getRenderState().hold.active) step(10);
    prevRow = c.getRenderState().active!.pos.row;
    let piece2FirstRow = 0;
    let t2 = 0;
    for (let f = 0; f < 2000; f++) {
      step(10);
      t2 += 10;
      const row = c.getRenderState().active!.pos.row;
      if (row > prevRow) {
        piece2FirstRow = t2;
        break;
      }
    }
    c.stop();
    // Piece #1 had ramped to a FAST late interval (well under the start); piece #2
    // starts SLOW again — proof the per-piece curve reset on the new spawn.
    expect(piece1FastRow).toBeLessThan(GRAVITY_INTERVAL_MS);
    expect(piece2FirstRow).toBeGreaterThan(GRAVITY_INTERVAL_MS);
    expect(piece2FirstRow).toBeGreaterThan(piece1FastRow + 100);
  });

  it("sustained soft drop is UNAFFECTED by the easing (crisp, flat, fast)", () => {
    const { c, step } = productionWithClock(1);
    startAndRelease(c, step);
    // Engage sustained soft drop; it must descend at the flat SOFT_DROP cadence,
    // far faster than even the floored natural gravity, and NOT accelerate.
    c.pressSoftDrop();
    const rowAfterPress = c.getRenderState().active!.pos.row;
    // A handful of 10ms frames at the 60ms soft-drop cadence drop several rows
    // FAST — far more than natural gravity's ~760ms first row would in the same
    // span (which would still be on its first row). This is the distinct, crisp
    // soft-drop feel surviving the easing change.
    for (let i = 0; i < 20; i++) step(10); // 200ms of held soft drop
    const rowAfterHold = c.getRenderState().active!.pos.row;
    expect(rowAfterHold - rowAfterPress).toBeGreaterThanOrEqual(2);
    c.releaseSoftDrop();
    c.stop();
  });

  it("hard drop is UNAFFECTED by the easing (instant slam to the floor)", () => {
    const { c, step } = productionWithClock(1);
    startAndRelease(c, step);
    // One hard-drop press lands the piece on the floor and locks it immediately,
    // regardless of how long it had (not) been falling — no easing involvement.
    c.pressHardDrop();
    const s = c.getRenderState();
    // The piece settled on the bottom rows of the spawn columns (7-8).
    expect(s.grid[ROWS - 1]![7]).not.toBeNull();
    expect(s.grid[ROWS - 2]![7]).not.toBeNull();
    c.stop();
  });
});
