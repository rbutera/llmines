import {
  advanceSweep,
  BPM,
  COLS,
  COLS_PER_BEAT,
  computeMarked,
  createGame,
  GRAVITY_INTERVAL_MS,
  gravityStep,
  hardDrop,
  lockPiece,
  moveLeft,
  moveRight,
  publicState,
  rotateCW,
  runFullSweep,
  seedState,
  spawnNext,
  spawnPiece,
  SWEEP_MS_PER_COL,
  type GameState,
  type MarkedCell,
  type Piece,
  type PublicState,
} from "../core";
import { createAudioClock } from "../audio/clock";
import { type Clock, FakeClock } from "../time/clock";

export type InputAction =
  | "left"
  | "right"
  | "rotate"
  | "softDrop"
  | "hardDrop";

/** Rich per-frame snapshot for the renderer + React HUD. */
export interface RenderState {
  /** Settled stack only (active piece drawn separately for smooth descent). */
  grid: GameState["grid"];
  active: GameState["active"];
  /** Fractional progress (0..1) toward the next gravity row, for interpolation. */
  fallProgress: number;
  score: number;
  gameOver: boolean;
  sweepX: number;
  marked: MarkedCell[];
}

export interface ControllerOptions {
  testMode?: boolean;
  seed?: number;
  /**
   * Time source. Defaults to a {@link FakeClock} in test mode and an
   * {@link createAudioClock} (AudioContext-backed) clock in production. The
   * controller is the ONLY layer that reads time.
   */
  clock?: Clock;
}

type Subscriber = (s: RenderState) => void;

/**
 * Forward column delta from `from` to `to` on the wrapped [0, COLS) sweep
 * track. The sweep only ever moves forward (with wraps), so a `to` that is
 * numerically less than `from` means a wrap occurred: add a full `COLS`. Pure.
 *
 * NOTE: retained as the design's reference wrap-delta path. The production frame
 * now derives sweep motion from ABSOLUTE clock time (see {@link
 * GameController.runFrame}), which never needs this; it is kept (and tested) to
 * document the wrapped-track delta semantics the absolute path supersedes.
 */
export function forwardDelta(from: number, to: number, cols: number): number {
  let delta = to - from;
  while (delta < 0) delta += cols;
  return delta;
}

/**
 * Owns the single GameState and all wall-clock timing. The production rAF loop
 * applies gravity + the music-synced sweep and auto-spawns. In test mode the
 * auto-loop is disabled and the game is driven deterministically by the test
 * interface (tick / sweepNow / sweepProgress / spawn).
 */
export class GameController {
  private state: GameState;
  private readonly testMode: boolean;
  private readonly subscribers = new Set<Subscriber>();
  /** The sole time source. Read only inside the production rAF frame. */
  private readonly clock: Clock;
  /** Whether the production AudioContext has been resumed (first gesture). */
  private clockResumed = false;

  private rafId: number | null = null;
  /** Previous `clock.now()` reading (seconds); 0 = no prior frame yet. */
  private lastClockNow = 0;
  /**
   * Absolute clock time (seconds) the sweep is measured from — set on the first
   * valid (post-resume) frame so `sweepX` is a PURE function of `clock.now()`:
   * columns = (now - sweepStartT) * (BPM/60) * COLS_PER_BEAT. 0 = not yet set.
   */
  private sweepStartT = 0;
  /**
   * Absolute columns the sweep has been advanced to so far (monotonic, spanning
   * many passes). Each frame we recompute the absolute target from the clock and
   * feed only the forward DELTA to the pure core, so dropped frames/GC pauses
   * never accumulate drift — the next frame catches up from absolute time.
   */
  private sweepColumnsConsumed = 0;
  private gravityAccumMs = 0;
  private started = false;

  constructor(opts: ControllerOptions = {}) {
    this.testMode = opts.testMode ?? false;
    this.state = createGame(opts.seed ?? 1);
    // Default time source per mode: a manual FakeClock in tests, the
    // AudioContext-backed clock in production. AudioContext is browser-only, so
    // it is only constructed in production (where the rAF loop also lives).
    this.clock = opts.clock ?? (this.testMode ? new FakeClock() : createAudioClock());
  }

  // ---- lifecycle -----------------------------------------------------------

  /**
   * Begin play. In production: spawn the first piece and start the rAF loop.
   * In test mode: stay quiescent (no auto-spawn, no loop) — the harness drives
   * the board deterministically via spawn()/tick()/sweep* .
   */
  start(): void {
    if (this.started) return;
    this.started = true;
    if (!this.testMode) {
      // The Start click IS the user gesture: resume the AudioContext here so
      // musical time starts immediately, rather than waiting for the first
      // keyboard input (otherwise now() stays 0, dt stays 0, board frozen).
      this.resumeClockOnFirstGesture();
      this.state = spawnNext(this.state);
      this.startLoop();
    }
    this.emit();
  }

  stop(): void {
    this.started = false;
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  /** Reset to a fresh game (optionally reseeded) and restart play. */
  restart(seed?: number): void {
    this.stop();
    this.state = createGame(seed ?? 1);
    this.gravityAccumMs = 0;
    this.lastClockNow = 0;
    this.sweepStartT = 0;
    this.sweepColumnsConsumed = 0;
    // Re-arm the gesture-resume so start() resumes the context again. The
    // AudioContext itself is already running, so resume() is a cheap no-op, but
    // the flag must not short-circuit the start() path.
    this.clockResumed = false;
    this.start();
  }

  // ---- subscriptions -------------------------------------------------------

  subscribe(fn: Subscriber): () => void {
    this.subscribers.add(fn);
    fn(this.renderState());
    return () => this.subscribers.delete(fn);
  }

  private emit(): void {
    const rs = this.renderState();
    for (const fn of this.subscribers) fn(rs);
  }

  // ---- production loop -----------------------------------------------------

  private startLoop(): void {
    this.lastClockNow = 0;
    this.sweepStartT = 0;
    this.sweepColumnsConsumed = 0;
    const frame = (): void => {
      if (!this.started) return;
      this.runFrame();
      if (this.started && !this.state.gameOver) {
        this.rafId = requestAnimationFrame(frame);
      }
    };
    this.rafId = requestAnimationFrame(frame);
  }

  /**
   * One production frame. The sweep is derived from ABSOLUTE clock time (a pure
   * function of `clock.now()`), not an accumulated dt — so a dropped frame, GC
   * pause, or tab-out never desyncs the bar from the music: the next frame
   * recomputes the absolute target and catches up. Gravity keeps its own dt
   * accumulator (gravity is not music-synced). Extracted so the whole pipeline
   * is unit-testable without rAF (see testProductionFrame).
   */
  private runFrame(): void {
    const now = this.clock.now();
    // A suspended AudioContext reports now() === 0. This happens on the first
    // pre-resume frame, on the baseline-establishing frame right after resume,
    // AND on a re-suspend after running (tab backgrounding / iOS interrupt).
    // In every one of those cases treat the frame as paused (dt=0, sweep frozen)
    // and (re)anchor the sweep baseline so musical time resumes from here:
    //   - now <= 0            → suspended (pre-resume or re-suspend)
    //   - lastClockNow <= 0   → first valid reading, no usable prior baseline
    //   - now < lastClockNow  → clock went backwards (defensive)
    if (now <= 0 || this.lastClockNow <= 0 || now < this.lastClockNow) {
      // Re-anchor the sweep so the next valid frame measures from `now`, keeping
      // sweepX a pure function of (now - sweepStartT) with no rewind/jump. Reset
      // the consumed-columns counter too: it is relative to sweepStartT, so the
      // next frame's delta is computed from this fresh baseline (not the stale
      // pre-suspend total, which would otherwise swallow the first frame).
      this.sweepStartT = now > 0 ? now : 0;
      this.sweepColumnsConsumed = 0;
      this.lastClockNow = now;
      // dt = 0: do not advance sweep or gravity this frame.
      this.emit();
      return;
    }

    // --- Sweep: pure function of absolute clock time ---
    // columns = elapsed beats * COLS_PER_BEAT (one column per eighth-note).
    const elapsed = now - this.sweepStartT;
    const targetColumns = elapsed * (BPM / 60) * COLS_PER_BEAT;
    const delta = targetColumns - this.sweepColumnsConsumed;
    if (delta > 0) {
      this.sweepColumnsConsumed = targetColumns;
      this.advanceSweepColumns(delta);
    }

    // --- Gravity: independent dt accumulator (not music-synced) ---
    const dt = Math.min((now - this.lastClockNow) * 1000, 100); // clamp tab-out
    this.lastClockNow = now;
    this.advanceGravity(dt);
    this.emit();
  }

  /** Advance the sweep by an absolute-time-derived column delta. */
  private advanceSweepColumns(columns: number): void {
    if (this.state.gameOver) return;
    this.state = advanceSweep(this.state, columns);
  }

  /** Advance gravity by dt ms on a fixed tick + auto-spawn. */
  private advanceGravity(dtMs: number): void {
    if (this.state.gameOver) return;
    this.gravityAccumMs += dtMs;
    while (this.gravityAccumMs >= GRAVITY_INTERVAL_MS) {
      this.gravityAccumMs -= GRAVITY_INTERVAL_MS;
      this.gravityTickAndSpawn();
      if (this.state.gameOver) break;
    }
  }

  private gravityTickAndSpawn(): void {
    const { state, locked } = gravityStep(this.state);
    this.state = state;
    if (locked) {
      this.gravityAccumMs = 0;
      this.state = spawnNext(this.state); // production auto-spawns
    }
  }

  // ---- player input (active only while playing) ----------------------------

  input(action: InputAction): void {
    if (!this.started || this.state.gameOver || !this.state.active) return;
    this.resumeClockOnFirstGesture();
    switch (action) {
      case "left":
        this.state = moveLeft(this.state);
        break;
      case "right":
        this.state = moveRight(this.state);
        break;
      case "rotate":
        this.state = rotateCW(this.state);
        break;
      case "softDrop": {
        const { state, locked } = gravityStep(this.state);
        this.state = state;
        if (locked && !this.testMode) {
          this.gravityAccumMs = 0;
          this.state = spawnNext(this.state);
        }
        break;
      }
      case "hardDrop":
        this.state = hardDrop(this.state);
        if (!this.testMode) {
          this.gravityAccumMs = 0;
          this.state = spawnNext(this.state);
        }
        break;
    }
    this.emit();
  }

  /**
   * On the first production gesture, resume the AudioContext so musical time
   * starts. Before this, the AudioClock reports 0 and the sweep does not
   * advance (the board waits rather than jumping). No-op in test mode and for
   * clocks without a `resume` hook (e.g. an injected FakeClock).
   */
  private resumeClockOnFirstGesture(): void {
    if (this.testMode || this.clockResumed) return;
    const c = this.clock as Clock & { resume?: () => void };
    if (typeof c.resume === "function") {
      c.resume();
      this.clockResumed = true;
    }
  }

  // ---- render / read access ------------------------------------------------

  private renderState(): RenderState {
    const interval = GRAVITY_INTERVAL_MS;
    return {
      grid: this.state.grid,
      active: this.state.active,
      fallProgress: this.testMode
        ? 0
        : Math.max(0, Math.min(1, this.gravityAccumMs / interval)),
      score: this.state.score,
      gameOver: this.state.gameOver,
      sweepX: this.state.sweepX,
      marked: computeMarked(this.state.grid).marked,
    };
  }

  getRenderState(): RenderState {
    return this.renderState();
  }

  /** Test-only: the injected time source, for asserting mode-appropriate defaults. */
  getClock(): Clock {
    return this.clock;
  }

  /**
   * Test-only: the raw gravity accumulator (ms). Exposed so tests can assert it
   * never goes NEGATIVE — a negative accumulator (from a negative dt on
   * re-suspend) stalls gravity and is hidden by the clamp in renderState().
   */
  testGravityAccumMs(): number {
    return this.gravityAccumMs;
  }

  // ---- deterministic test interface ---------------------------------------
  // These map directly to core ops and never run the production loop.

  testSeed(n: number): void {
    this.state = { ...this.state, rngState: seedState(n) };
  }

  testState(): PublicState {
    return publicState(this.state);
  }

  testMarked(): MarkedCell[] {
    return computeMarked(this.state.grid).marked;
  }

  /** Lock any mid-fall piece first, then place `piece` at top-centre. */
  testSpawn(piece: Piece): void {
    if (this.state.active) this.state = lockPiece(this.state);
    this.started = true;
    this.state = spawnPiece(this.state, piece);
    this.emit();
  }

  /**
   * Test-only: write a settled cell directly onto the grid (no gravity, no
   * spawn). Lets a test set up an exact board deterministically — e.g. clearable
   * squares at known columns — without driving pieces through gravity, which
   * would auto-spawn RNG pieces and contaminate the board. Mutates a clone so
   * the grid reference stays internal; does not emit.
   */
  testSetCell(row: number, col: number, color: 0 | 1): void {
    const grid = this.state.grid.map((r) => r.slice());
    grid[row]![col] = color;
    this.state = { ...this.state, grid };
  }

  /** One gravity step; NEVER auto-spawns. */
  testTick(): void {
    const { state } = gravityStep(this.state);
    this.state = state;
    this.emit();
  }

  /** Run one full sweep immediately + apply scoring. */
  testSweepNow(): void {
    this.state = runFullSweep(this.state);
    this.emit();
  }

  /** Advance the sweep deterministically by dtMs (0.25s per column). */
  testSweepProgress(dtMs: number): void {
    this.state = advanceSweep(this.state, dtMs / SWEEP_MS_PER_COL);
    this.emit();
  }

  /**
   * Additive clock-driven driver: advance the injected clock by `dtMs` and run
   * one logical sweep frame derived from the clock delta. Equivalent in effect
   * to {@link testSweepProgress} (same `advanceSweep` call) but routed through
   * the clock seam, so audio-driven timing is testable the same way. Requires a
   * clock that supports `advance` (the default test-mode {@link FakeClock}).
   */
  /**
   * Test-only: run exactly one production frame (the {@link runFrame} path that
   * derives dt from successive `clock.now()` readings), WITHOUT requestAnimation-
   * Frame. Lets tests exercise the real production clock→dt→advance pipeline —
   * including the suspended (now()===0) and re-suspend cases — deterministically.
   */
  testProductionFrame(): void {
    this.runFrame();
  }

  testClockAdvance(dtMs: number): void {
    const c = this.clock as Clock & { advance?: (seconds: number) => void };
    if (typeof c.advance !== "function") {
      throw new Error(
        "testClockAdvance requires an advanceable clock (FakeClock)",
      );
    }
    c.advance(dtMs / 1000);
    this.state = advanceSweep(this.state, dtMs / SWEEP_MS_PER_COL);
    this.emit();
  }

  /**
   * Additive beat-sync driver: advance the (fake) clock by `dtMs` and run ONE
   * logical production frame so the sweep is driven by the real absolute-time
   * path (`runFrame`). Unlike {@link testClockAdvance} (which calls the core
   * directly), this exercises the production beat-derived timing end to end, so
   * tests can assert "one eighth-note advances exactly one column" and
   * frame-rate independence. Requires an advanceable clock (the default
   * test-mode {@link FakeClock}). Does NOT replace `sweepProgress`/`sweepNow`.
   */
  testBeatFrame(dtMs: number): void {
    const c = this.clock as Clock & { advance?: (seconds: number) => void };
    if (typeof c.advance !== "function") {
      throw new Error("testBeatFrame requires an advanceable clock (FakeClock)");
    }
    c.advance(dtMs / 1000);
    this.runFrame();
  }

  /** Test-only: the absolute columns the sweep has consumed since its baseline. */
  testSweepColumnsConsumed(): number {
    return this.sweepColumnsConsumed;
  }
}
