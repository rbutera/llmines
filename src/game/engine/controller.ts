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
  type HoldState,
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
  /** New-block hold descriptor for the spawned-but-held block. */
  hold: HoldState;
}

export interface ControllerOptions {
  testMode?: boolean;
  seed?: number;
}

/** Per-input options. `fresh` marks a deliberate key *press* (vs a held-key repeat). */
export interface InputOptions {
  /** True for a fresh deliberate press (`!KeyboardEvent.repeat`); defaults to true. */
  fresh?: boolean;
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
  // gravity takes it (see beginHold). Owned here, like gravityAccumMs, so the
  // pure core stays time-free.
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
      this.state = spawnNext(this.state);
      this.beginHold();
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
    this.holdActive = false;
    this.holdRemainingMs = 0;
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

  // ---- new-block hold ------------------------------------------------------

  /** Arm the hold for the just-spawned block (no-op if the spawn produced no piece). */
  private beginHold(): void {
    if (this.state.active) {
      this.holdActive = true;
      this.holdRemainingMs = HOLD_MS;
    } else {
      this.holdActive = false;
      this.holdRemainingMs = 0;
    }
  }

  /** End the hold now (timer lapse or a fresh press). Resets gravity so the
   *  first post-hold descent is a full normal interval later (not instant). */
  private endHold(): void {
    this.holdActive = false;
    this.holdRemainingMs = 0;
    this.gravityAccumMs = 0;
  }

  private holdSnapshot(): HoldState {
    return { active: this.holdActive, remainingMs: this.holdRemainingMs };
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

    // Music-synced sweep: continuous, snapshot-per-pass scoring (runs even while
    // the new block is holding — only piece descent is gated).
    this.state = advanceSweep(this.state, dtMs / SWEEP_MS_PER_COL);

    // New-block hold: the block stays at the top until the hold lapses; gravity
    // does not accumulate or descend while holding.
    if (this.holdActive) {
      this.holdRemainingMs -= dtMs;
      if (this.holdRemainingMs <= 0) this.endHold(); // lapse -> normal gravity
      return;
    }

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
      this.beginHold(); // the new block holds before it falls
    }
  }

  // ---- player input (active only while playing) ----------------------------

  input(action: InputAction, opts: InputOptions = {}): void {
    if (!this.started || this.state.gameOver || !this.state.active) return;
    // A fresh deliberate press (!KeyboardEvent.repeat) defaults true; a held-key
    // repeat passes fresh=false.
    const fresh = opts.fresh ?? true;
    switch (action) {
      case "left":
        this.state = moveLeft(this.state); // allowed during hold
        break;
      case "right":
        this.state = moveRight(this.state); // allowed during hold
        break;
      case "rotate":
        this.state = rotateCW(this.state); // allowed during hold
        break;
      case "softDrop": {
        // While holding, only a FRESH press drops (and ends the hold); a
        // carried-over held key is ignored so it cannot skip the hold.
        if (this.holdActive) {
          if (!fresh) break;
          this.endHold();
        }
        const { state, locked } = gravityStep(this.state);
        this.state = state;
        if (locked && !this.testMode) {
          this.gravityAccumMs = 0;
          this.state = spawnNext(this.state);
          this.beginHold();
        }
        break;
      }
      case "hardDrop":
        if (this.holdActive) {
          if (!fresh) break;
          this.endHold();
        }
        this.state = hardDrop(this.state);
        if (!this.testMode) {
          this.gravityAccumMs = 0;
          this.state = spawnNext(this.state);
          this.beginHold();
        }
        break;
    }
    this.emit();
  }

  // ---- render / read access ------------------------------------------------

  private renderState(): RenderState {
    const interval = GRAVITY_INTERVAL_MS;
    return {
      grid: this.state.grid,
      active: this.state.active,
      // A resting piece (cannot descend) must not interpolate past its row, or it
      // would render below its logical cell — and below the canvas on the bottom
      // row — until the next gravity tick locks it (the clip/snap artifact).
      fallProgress:
        this.testMode || isResting(this.state)
          ? 0
          : Math.max(0, Math.min(1, this.gravityAccumMs / interval)),
      score: this.state.score,
      gameOver: this.state.gameOver,
      sweepX: this.state.sweepX,
      marked: computeMarked(this.state.grid).marked,
      hold: this.holdSnapshot(),
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

  testState(): PublicState {
    return { ...publicState(this.state), hold: this.holdSnapshot() };
  }

  testMarked(): MarkedCell[] {
    return computeMarked(this.state.grid).marked;
  }

  /** Lock any mid-fall piece first, then place `piece` at top-centre (which holds). */
  testSpawn(piece: Piece): void {
    if (this.state.active) this.state = lockPiece(this.state);
    this.started = true;
    this.state = spawnPiece(this.state, piece);
    this.beginHold();
    this.emit();
  }

  /**
   * Deterministic gravity step. While the block is holding, a tick lapses the
   * hold (no descent) instead of moving the piece — so carry-over (no fresh
   * press) is simulated by simply ticking. NEVER auto-spawns.
   */
  testTick(): void {
    if (this.holdActive) {
      this.endHold();
      this.emit();
      return;
    }
    const { state } = gravityStep(this.state);
    this.state = state;
    this.emit();
  }

  /** A FRESH deliberate soft-drop: ends any hold, then descends one row. */
  testPressSoftDrop(): void {
    this.input("softDrop", { fresh: true });
  }

  /** A FRESH deliberate hard-drop: ends any hold, then settles to the floor. */
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
