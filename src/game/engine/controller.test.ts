import { afterEach, describe, expect, it } from "vitest";
import {
  COLS,
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
    // Smooth descent: a fractional offset toward the next row.
    expect(rs.fallProgress).toBeGreaterThan(0);
    expect(rs.fallProgress).toBeLessThanOrEqual(1);
    expect(rs.fallProgress).toBeCloseTo(100 / GRAVITY_INTERVAL_MS, 5);
    c.stop();
  });

  it("reports zero fall offset once the piece rests on the bottom row", () => {
    const { c, step } = productionWithClock(1);
    startAndRelease(c, step);
    // The piece stages at row -2 now, so it descends ROWS rows to the floor
    // (pos.row = ROWS-2) in ROWS gravity ticks. 72 post-hold frames -> 7200ms =
    // 10 ticks (the piece reaches the floor) with ~200ms left over — short of the
    // 11th tick that would lock + respawn. The resting gate must read fallProgress
    // 0 so the leftover accumulation cannot draw the piece below the canvas.
    for (let i = 0; i < 72; i++) step(100);

    const rs = c.getRenderState();
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

describe("top-out game over (A5/D4): no auto-spawn after a topping-out lock", () => {
  it("a lock that fills the spawn columns ends the game and does not auto-spawn", () => {
    const c = new GameController({ testMode: true });
    // Pre-fill the spawn columns (7-8) right up to row 0 so the NEXT spawn cannot
    // enter the field. testSpawn locks any active piece first, then attempts to
    // place the new one — which must top out.
    for (let r = 0; r < ROWS; r++) {
      c.testSetCell(r, 7, 1);
      c.testSetCell(r, 8, 1);
    }
    c.testSpawn([
      [0, 0],
      [0, 0],
    ]);
    expect(c.testState().gameOver).toBe(true);
    expect(c.testRawState().active).toBe(null);
  });
});
