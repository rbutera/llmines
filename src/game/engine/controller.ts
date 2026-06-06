import {
  advanceSweep,
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
   * One production frame: derive dt from the injected clock and advance. Time
   * comes ONLY from the clock (seconds); dt is the elapsed musical time since
   * the previous frame, converted to ms so the existing dtMs-based sweep/gravity
   * path is byte-identical to before. Extracted so the clock-derive-dt path is
   * unit-testable without rAF (see testProductionFrame).
   */
  private runFrame(): void {
    const now = this.clock.now();
    // A suspended AudioContext reports now() === 0. This happens on the first
    // pre-resume frame, on the baseline-establishing frame right after resume,
    // AND on a re-suspend after running (tab backgrounding / iOS interrupt).
    // In every one of those cases treat dt as 0 and (re)set the baseline:
    //   - now <= 0            → suspended (pre-resume or re-suspend)
    //   - lastClockNow <= 0   → first valid reading, no usable prior baseline
    //   - now < lastClockNow  → clock went backwards (defensive)
    // Without this, (0 - lastClockNow) would be a large NEGATIVE dt that runs
    // the sweep backwards (sweepX) and drives gravityAccumMs negative.
    let dt: number;
    if (now <= 0 || this.lastClockNow <= 0 || now < this.lastClockNow) {
      dt = 0;
    } else {
      // Normal monotonic case: byte-identical to before (seconds→ms, 100ms clamp).
      dt = Math.min((now - this.lastClockNow) * 1000, 100); // clamp tab-out jumps
    }
    this.lastClockNow = now;
    this.advance(dt);
    this.emit();
  }

  /** Advance production timing by dt ms: sweep + gravity + auto-spawn. */
  private advance(dtMs: number): void {
    if (this.state.gameOver) return;

    // Music-synced sweep: continuous, snapshot-per-pass scoring.
    this.state = advanceSweep(this.state, dtMs / SWEEP_MS_PER_COL);

    // Gravity on a fixed tick.
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
}
