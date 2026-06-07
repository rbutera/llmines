import {
  advanceSweep,
  computeMarked,
  createGame,
  GRAVITY_INTERVAL_MS,
  gravityStep,
  hardDrop,
  isResting,
  lockPiece,
  moveLeft,
  moveRight,
  publicState,
  rotateCW,
  runFullSweep,
  seedState,
  SOFT_DROP_INTERVAL_MS,
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
  /**
   * True while the freshly spawned piece is held at the top ("ready to place").
   * Optional so lightweight RenderState fixtures (e.g. renderer unit tests) need
   * not set it; absent is treated as "not held". The controller always sets it.
   */
  holdActive?: boolean;
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
  /**
   * Whether soft-drop (fast-fall) is currently engaged. Set by a FRESH
   * soft-drop press, cleared on key release and reset to false on every spawn so
   * a key held across a lock never carries over (see F2 deliberate re-press).
   */
  private softDropEngaged = false;

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

  /** Active per-row gravity interval: faster while soft-drop is engaged. */
  private currentIntervalMs(): number {
    return this.softDropEngaged ? SOFT_DROP_INTERVAL_MS : GRAVITY_INTERVAL_MS;
  }

  /** Advance production timing by dt ms: sweep + hold + gravity + auto-spawn. */
  private advance(dtMs: number): void {
    if (this.state.gameOver) return;

    // Music-synced sweep: continuous, snapshot-per-pass scoring.
    this.state = advanceSweep(this.state, dtMs / SWEEP_MS_PER_COL);

    // New-block hold: while held, auto-gravity is paused. The player can still
    // move/rotate (those run through input()). When the hold lapses the piece
    // falls at whatever interval is currently engaged (normal unless a fresh
    // soft-drop press engaged fast-fall during the hold).
    if (this.state.hold.active) {
      const remainingMs = this.state.hold.remainingMs - dtMs;
      if (remainingMs <= 0) {
        this.state = { ...this.state, hold: { active: false, remainingMs: 0 } };
        this.gravityAccumMs = 0;
      } else {
        this.state = { ...this.state, hold: { active: true, remainingMs } };
        return; // still held: no gravity this frame
      }
    }

    // Gravity on a fixed tick (interval depends on soft-drop engagement).
    const interval = this.currentIntervalMs();
    this.gravityAccumMs += dtMs;
    while (this.gravityAccumMs >= interval) {
      this.gravityAccumMs -= interval;
      const { state, locked } = gravityStep(this.state);
      this.state = state;
      if (locked) {
        this.spawnAndReset();
        break;
      }
    }

    // Immediate settle: once the active piece can no longer descend, lock it
    // and spawn the next piece right away instead of waiting out the remaining
    // gravity interval. Combined with the resting-piece fallProgress clamp in
    // renderState(), this removes the hover/clip artifact at the bottom row.
    if (
      !this.state.gameOver &&
      !this.state.hold.active &&
      this.state.active &&
      isResting(this.state)
    ) {
      this.state = lockPiece(this.state);
      this.spawnAndReset();
    }
  }

  /**
   * Spawn the next piece (production) and reset per-piece input timing. Resetting
   * `softDropEngaged` here is what kills the soft-drop-cascade: a key held across
   * the lock does not carry over — the new block holds until a FRESH press.
   */
  private spawnAndReset(): void {
    this.state = spawnNext(this.state);
    this.gravityAccumMs = 0;
    this.softDropEngaged = false;
  }

  // ---- player input (active only while playing) ----------------------------

  input(action: InputAction): void {
    if (!this.started || this.state.gameOver || !this.state.active) return;
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
      case "softDrop":
        this.pressSoftDrop();
        return;
      case "hardDrop":
        this.pressHardDrop();
        return;
    }
    this.emit();
  }

  /** End any active new-block hold (a deliberate drop press or a lapse). */
  private endHold(): void {
    if (this.state.hold.active) {
      this.state = { ...this.state, hold: { active: false, remainingMs: 0 } };
    }
  }

  /**
   * A FRESH, deliberate soft-drop press. Ends the hold (if any), engages
   * fast-fall, and applies one immediate gravity step. A key held across a lock
   * never reaches here (GameShell ignores auto-repeat keydowns), so the new
   * block stays held until the player re-presses.
   */
  pressSoftDrop(): void {
    if (!this.started || this.state.gameOver || !this.state.active) return;
    this.endHold();
    this.softDropEngaged = true;
    const { state, locked } = gravityStep(this.state);
    this.state = state;
    if (locked && !this.testMode) this.spawnAndReset();
    this.emit();
  }

  /** A FRESH, deliberate hard-drop press: end the hold, slam to the floor. */
  pressHardDrop(): void {
    if (!this.started || this.state.gameOver || !this.state.active) return;
    this.endHold();
    this.softDropEngaged = false;
    this.state = hardDrop(this.state);
    if (!this.testMode) this.spawnAndReset();
    this.emit();
  }

  /** Soft-drop key released: disengage fast-fall. */
  releaseSoftDrop(): void {
    this.softDropEngaged = false;
  }

  // ---- render / read access ------------------------------------------------

  private renderState(): RenderState {
    const interval = this.currentIntervalMs();
    const held = this.state.hold.active;
    return {
      grid: this.state.grid,
      active: this.state.active,
      fallProgress:
        this.testMode || held || isResting(this.state)
          ? 0
          : Math.max(0, Math.min(1, this.gravityAccumMs / interval)),
      score: this.state.score,
      gameOver: this.state.gameOver,
      sweepX: this.state.sweepX,
      marked: computeMarked(this.state.grid).marked,
      holdActive: held,
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
    this.softDropEngaged = false;
    this.gravityAccumMs = 0;
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
}
