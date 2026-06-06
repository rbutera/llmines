import {
  advanceSweep,
  computeMarked,
  createGame,
  GRAVITY_INTERVAL_MS,
  gravityStep,
  hardDrop,
  HOLD_MS,
  isResting,
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

export type InputAction =
  | "left"
  | "right"
  | "rotate"
  | "softDrop"
  | "hardDrop";

/** Options for an input action. */
export interface InputOptions {
  /**
   * True for a deliberate, fresh key press (KeyboardEvent.repeat === false);
   * false for an OS auto-repeat / carried-over hold. Only soft/hard-drop care:
   * a fresh drop press releases the new-block hold, a carried-over one is
   * ignored during the hold (so a key held through a lock does not auto-drop).
   */
  fresh?: boolean;
}

/** Spawned-but-held block status, surfaced for the HUD/renderer and tests. */
export interface HoldState {
  active: boolean;
  remainingMs: number;
}

/** Public test-state projection with the hold status attached. */
export interface PublicTestState extends PublicState {
  hold: HoldState;
}

/** Rich per-frame snapshot for the renderer + React HUD. */
export interface RenderState {
  /** Settled stack only (active piece drawn separately for smooth descent). */
  grid: GameState["grid"];
  active: GameState["active"];
  /** Fractional progress (0..1) toward the next gravity row, for interpolation. */
  fallProgress: number;
  /** Whether the active block is in its spawn hold ("ready to place" beat). */
  hold: HoldState;
  score: number;
  gameOver: boolean;
  sweepX: number;
  marked: MarkedCell[];
}

export interface ControllerOptions {
  testMode?: boolean;
  seed?: number;
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

  private rafId: number | null = null;
  private lastTs = 0;
  private gravityAccumMs = 0;
  private started = false;

  // New-block hold: a freshly spawned block holds at the top for HOLD_MS before
  // gravity begins, unless a fresh drop press engages it sooner. holdActive is
  // only meaningful while a piece is active.
  private holdActive = false;
  private holdRemainingMs = 0;

  constructor(opts: ControllerOptions = {}) {
    this.testMode = opts.testMode ?? false;
    this.state = createGame(opts.seed ?? 1);
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
      this.spawnNextHeld();
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
    this.clearHold();
    this.start();
  }

  // ---- new-block hold ------------------------------------------------------

  /** Begin the spawn hold for the current active piece (no-op if none). */
  private beginHold(): void {
    this.gravityAccumMs = 0;
    if (this.state.active) {
      this.holdActive = true;
      this.holdRemainingMs = HOLD_MS;
    } else {
      this.clearHold();
    }
  }

  /** End the hold and reset gravity so the block resumes at NORMAL gravity. */
  private endHold(): void {
    this.holdActive = false;
    this.holdRemainingMs = 0;
    this.gravityAccumMs = 0;
  }

  private clearHold(): void {
    this.holdActive = false;
    this.holdRemainingMs = 0;
  }

  /** Spawn the next RNG piece and hold it at the top (deliberate-place beat). */
  private spawnNextHeld(): void {
    this.state = spawnNext(this.state);
    this.beginHold();
  }

  private holdStatus(): HoldState {
    const active = this.holdActive && this.state.active !== null;
    return { active, remainingMs: active ? this.holdRemainingMs : 0 };
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
    this.lastTs = 0;
    const frame = (ts: number): void => {
      if (!this.started) return;
      if (this.lastTs === 0) this.lastTs = ts;
      const dt = Math.min(ts - this.lastTs, 100); // clamp tab-out jumps
      this.lastTs = ts;
      this.advance(dt);
      this.emit();
      if (this.started && !this.state.gameOver) {
        this.rafId = requestAnimationFrame(frame);
      }
    };
    this.rafId = requestAnimationFrame(frame);
  }

  /** Advance production timing by dt ms: sweep + gravity + auto-spawn. */
  private advance(dtMs: number): void {
    if (this.state.gameOver) return;

    // Music-synced sweep: continuous, snapshot-per-pass scoring. Runs even
    // during the hold (the sweep is independent of the falling block).
    this.state = advanceSweep(this.state, dtMs / SWEEP_MS_PER_COL);

    // New-block hold: gravity is suspended until the hold lapses, then the
    // block begins falling at NORMAL gravity (endHold resets the accumulator).
    if (this.holdActive) {
      this.holdRemainingMs -= dtMs;
      if (this.holdRemainingMs <= 0) this.endHold();
      return;
    }

    // Gravity on a fixed tick.
    this.gravityAccumMs += dtMs;
    while (this.gravityAccumMs >= GRAVITY_INTERVAL_MS) {
      this.gravityAccumMs -= GRAVITY_INTERVAL_MS;
      this.gravityTickAndSpawn();
      if (this.state.gameOver || this.holdActive) break;
    }
  }

  private gravityTickAndSpawn(): void {
    const { state, locked } = gravityStep(this.state);
    this.state = state;
    if (locked) {
      this.gravityAccumMs = 0;
      this.spawnNextHeld(); // production auto-spawns into a fresh hold
    }
  }

  // ---- player input (active only while playing) ----------------------------

  input(action: InputAction, opts: InputOptions = {}): void {
    if (!this.started || this.state.gameOver || !this.state.active) return;

    // Move/rotate are always allowed, including freely during the hold.
    switch (action) {
      case "left":
        this.state = moveLeft(this.state);
        this.emit();
        return;
      case "right":
        this.state = moveRight(this.state);
        this.emit();
        return;
      case "rotate":
        this.state = rotateCW(this.state);
        this.emit();
        return;
    }

    // Drop actions interact with the hold. During the hold, only a FRESH,
    // deliberate press engages; a carried-over hold (auto-repeat) is ignored,
    // so a key held through the previous block's lock never auto-drops the new
    // one — the player must re-press.
    if (this.holdActive) {
      if (!opts.fresh) return;
      this.endHold(); // fresh press engages the fall immediately
    }

    switch (action) {
      case "softDrop": {
        const { state, locked } = gravityStep(this.state);
        this.state = state;
        if (locked && !this.testMode) this.spawnNextHeld();
        break;
      }
      case "hardDrop":
        this.state = hardDrop(this.state);
        if (!this.testMode) this.spawnNextHeld();
        break;
    }
    this.emit();
  }

  // ---- render / read access ------------------------------------------------

  private renderState(): RenderState {
    const interval = GRAVITY_INTERVAL_MS;
    const hold = this.holdStatus();
    return {
      grid: this.state.grid,
      active: this.state.active,
      // Only interpolate downward when the piece can actually descend. A
      // resting piece (on the bottom row or atop the stack) must render at its
      // true, in-bounds position immediately — otherwise the accumulating
      // gravity timer would push it below the canvas until the next tick snaps
      // it back into place (the bottom-row clip/delay artifact). A held block
      // is also frozen (gravityAccumMs stays 0 during the hold).
      fallProgress:
        this.testMode || hold.active || isResting(this.state)
          ? 0
          : Math.max(0, Math.min(1, this.gravityAccumMs / interval)),
      hold,
      score: this.state.score,
      gameOver: this.state.gameOver,
      sweepX: this.state.sweepX,
      marked: computeMarked(this.state.grid).marked,
    };
  }

  getRenderState(): RenderState {
    return this.renderState();
  }

  // ---- deterministic test interface ---------------------------------------
  // These map directly to core ops and never run the production loop.

  testSeed(n: number): void {
    this.state = { ...this.state, rngState: seedState(n) };
  }

  testState(): PublicTestState {
    return { ...publicState(this.state), hold: this.holdStatus() };
  }

  testMarked(): MarkedCell[] {
    return computeMarked(this.state.grid).marked;
  }

  /**
   * Deterministically end the current game with this exact final score, running
   * the REAL game-over path (sets `gameOver`, clears the active piece, and
   * publishes the final score). Subscribers transition to the game-over screen,
   * which submits the score for the signed-in player — the same path a real
   * stack-overflow game over takes. Used by `window.__lumines.endGame`.
   */
  testEndGame(score: number): void {
    this.stop();
    this.started = true; // keep "playing" semantics so the game-over transition fires
    this.clearHold();
    this.state = { ...this.state, score, active: null, gameOver: true };
    this.emit();
  }

  /** Lock any mid-fall piece first, then place `piece` at top-centre (held). */
  testSpawn(piece: Piece): void {
    if (this.state.active) this.state = lockPiece(this.state);
    this.started = true;
    this.state = spawnPiece(this.state, piece);
    this.beginHold(); // spawned block holds at the top until a press or lapse
    this.emit();
  }

  /**
   * One autonomous-gravity step; NEVER auto-spawns. Gravity is suspended during
   * the spawn hold: the first tick lapses the hold beat (no descent), and
   * subsequent ticks fall at normal gravity. (A fresh fast-fall instead uses
   * pressSoftDrop/pressHardDrop, which engage the fall immediately.)
   */
  testTick(): void {
    if (this.holdActive && this.state.active) {
      this.endHold();
      this.emit();
      return;
    }
    const { state } = gravityStep(this.state);
    this.state = state;
    this.emit();
  }

  /** Simulate a FRESH, deliberate soft-drop key press (vs a carried-over hold). */
  testPressSoftDrop(): void {
    this.input("softDrop", { fresh: true });
  }

  /** Simulate a FRESH, deliberate hard-drop key press (vs a carried-over hold). */
  testPressHardDrop(): void {
    this.input("hardDrop", { fresh: true });
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
}
