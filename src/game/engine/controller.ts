import {
  advanceSweep,
  computeMarked,
  createGame,
  GRAVITY_INTERVAL_MS,
  gravityStep,
  hardDrop,
  SPAWN_HOLD_MS,
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

export type InputAction = "left" | "right" | "rotate" | "softDrop" | "hardDrop";

export interface InputOptions {
  fresh?: boolean;
}

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
  private holdRemainingMs = 0;
  private started = false;

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
      this.startSpawnHold();
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

    // Music-synced sweep: continuous, snapshot-per-pass scoring.
    this.state = advanceSweep(this.state, dtMs / SWEEP_MS_PER_COL);

    const gravityDt = this.advanceHold(dtMs);
    if (gravityDt <= 0) return;

    // Gravity on a fixed tick.
    this.gravityAccumMs += gravityDt;
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
      this.startSpawnHold();
    }
  }

  // ---- player input (active only while playing) ----------------------------

  input(action: InputAction, opts: InputOptions = {}): void {
    if (!this.started || this.state.gameOver || !this.state.active) return;
    const fresh = opts.fresh ?? true;
    if (this.isDropAction(action) && this.holdActive()) {
      if (!fresh) return;
      this.clearHold();
    }
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
          this.startSpawnHold();
        }
        break;
      }
      case "hardDrop":
        this.state = hardDrop(this.state);
        if (!this.testMode) {
          this.gravityAccumMs = 0;
          this.state = spawnNext(this.state);
          this.startSpawnHold();
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

  private isDropAction(action: InputAction): boolean {
    return action === "softDrop" || action === "hardDrop";
  }

  private holdActive(): boolean {
    return this.state.active !== null && this.holdRemainingMs > 0;
  }

  private holdState(): HoldState {
    const active = this.holdActive();
    return {
      active,
      remainingMs: active ? Math.ceil(this.holdRemainingMs) : 0,
    };
  }

  private startSpawnHold(): void {
    this.gravityAccumMs = 0;
    this.holdRemainingMs = this.state.active ? SPAWN_HOLD_MS : 0;
  }

  private clearHold(): void {
    this.holdRemainingMs = 0;
    this.gravityAccumMs = 0;
  }

  /**
   * Consume hold time before gravity can accumulate. Returns only the portion
   * of dt that occurs after the hold has naturally lapsed.
   */
  private advanceHold(dtMs: number): number {
    if (!this.holdActive()) {
      if (!this.state.active) this.holdRemainingMs = 0;
      return dtMs;
    }

    if (dtMs < this.holdRemainingMs) {
      this.holdRemainingMs -= dtMs;
      this.gravityAccumMs = 0;
      return 0;
    }

    const leftoverMs = dtMs - this.holdRemainingMs;
    this.clearHold();
    return leftoverMs;
  }

  // ---- deterministic test interface ---------------------------------------
  // These map directly to core ops and never run the production loop.

  testSeed(n: number): void {
    this.state = { ...this.state, rngState: seedState(n) };
  }

  testState(): PublicState {
    return publicState(this.state, this.holdState());
  }

  testMarked(): MarkedCell[] {
    return computeMarked(this.state.grid).marked;
  }

  /** Lock any mid-fall piece first, then place `piece` at top-centre. */
  testSpawn(piece: Piece): void {
    if (this.state.active) this.state = lockPiece(this.state);
    this.started = true;
    this.state = spawnPiece(this.state, piece);
    this.startSpawnHold();
    this.emit();
  }

  /** One deterministic gravity interval; NEVER auto-spawns. */
  testTick(): void {
    const gravityDt = this.advanceHold(GRAVITY_INTERVAL_MS);
    this.gravityAccumMs += gravityDt;
    if (this.gravityAccumMs >= GRAVITY_INTERVAL_MS) {
      this.gravityAccumMs -= GRAVITY_INTERVAL_MS;
      const { state } = gravityStep(this.state);
      this.state = state;
      if (!this.state.active) this.clearHold();
    }
    this.emit();
  }

  testPressSoftDrop(): void {
    this.input("softDrop", { fresh: true });
  }

  testPressHardDrop(): void {
    this.input("hardDrop", { fresh: true });
  }

  testEndGame(score: number): void {
    this.clearHold();
    this.state = {
      ...this.state,
      active: null,
      score: Math.max(0, Math.floor(score)),
      gameOver: true,
    };
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
