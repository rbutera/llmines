import {
  advanceSweep,
  computeMarked,
  createGame,
  GRAVITY_INTERVAL_MS,
  gravityStep,
  hardDrop,
  isHeld,
  isResting,
  lockPiece,
  moveLeft,
  moveRight,
  publicState,
  releaseHold,
  rotateCW,
  runFullSweep,
  seedState,
  spawnNext,
  spawnPiece,
  SWEEP_MS_PER_COL,
  tickHold,
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
  /** Spawn-hold for the active piece (held => no descent; "ready to place"). */
  hold: HoldState;
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

  /** Advance production timing by dt ms: sweep + gravity + auto-spawn. */
  private advance(dtMs: number): void {
    if (this.state.gameOver) return;

    // Music-synced sweep: continuous, snapshot-per-pass scoring. The sweep
    // keeps moving even while a new block is held.
    this.state = advanceSweep(this.state, dtMs / SWEEP_MS_PER_COL);

    // New-block hold: a freshly spawned piece holds at the top for one beat.
    // Gravity is suspended (accumulator pinned to 0) until the hold lapses, at
    // which point normal gravity resumes from a clean accumulator.
    if (isHeld(this.state)) {
      this.state = tickHold(this.state, dtMs);
      this.gravityAccumMs = 0;
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
    }
  }

  // ---- player input (active only while playing) ----------------------------

  input(action: InputAction): void {
    if (!this.started || this.state.gameOver || !this.state.active) return;
    switch (action) {
      case "left":
        // Move/rotate are always allowed — including during the spawn-hold.
        this.state = moveLeft(this.state);
        break;
      case "right":
        this.state = moveRight(this.state);
        break;
      case "rotate":
        this.state = rotateCW(this.state);
        break;
      case "softDrop":
        // Carried-over (key-repeat) drop: a no-op while held so a key still
        // down from the previous piece cannot break the hold or fast-fall the
        // new piece. A FRESH press routes to pressSoftDrop() instead.
        if (isHeld(this.state)) break;
        this.softDropStep();
        break;
      case "hardDrop":
        if (isHeld(this.state)) break;
        this.hardDropStep();
        break;
    }
    this.emit();
  }

  /** A FRESH, deliberate soft-drop press: ends any hold and engages immediately. */
  pressSoftDrop(): void {
    if (!this.started || this.state.gameOver || !this.state.active) return;
    this.state = releaseHold(this.state);
    this.softDropStep();
    this.emit();
  }

  /** A FRESH, deliberate hard-drop press: ends any hold and drops immediately. */
  pressHardDrop(): void {
    if (!this.started || this.state.gameOver || !this.state.active) return;
    this.state = releaseHold(this.state);
    this.hardDropStep();
    this.emit();
  }

  /** One soft-drop gravity step; production auto-spawns the next (held) piece on lock. */
  private softDropStep(): void {
    const { state, locked } = gravityStep(this.state);
    this.state = state;
    if (locked && !this.testMode) {
      this.gravityAccumMs = 0;
      this.state = spawnNext(this.state);
    }
  }

  /** Hard-drop to the floor + lock; production auto-spawns the next (held) piece. */
  private hardDropStep(): void {
    this.state = hardDrop(this.state);
    if (!this.testMode) {
      this.gravityAccumMs = 0;
      this.state = spawnNext(this.state);
    }
  }

  // ---- render / read access ------------------------------------------------

  private renderState(): RenderState {
    const interval = GRAVITY_INTERVAL_MS;
    // The fall interpolation represents motion toward the NEXT gravity row. A
    // piece that cannot descend (resting on the floor or the stack) or that is
    // held at spawn has no such motion, so its offset must be 0 — otherwise the
    // smooth-fall offset would push it past its resting row and below the
    // playfield (the bottom-row clip/delay artifact), or make a held piece
    // appear to drift. Test mode is always quiescent (no auto-gravity).
    const resting = isResting(this.state);
    const held = isHeld(this.state);
    return {
      grid: this.state.grid,
      active: this.state.active,
      fallProgress:
        this.testMode || resting || held
          ? 0
          : Math.max(0, Math.min(1, this.gravityAccumMs / interval)),
      score: this.state.score,
      gameOver: this.state.gameOver,
      sweepX: this.state.sweepX,
      marked: computeMarked(this.state.grid).marked,
      hold: this.state.hold,
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
    this.emit();
  }

  /**
   * Hold-aware tick. While a new block is held this LAPSES the hold in place
   * (modelling the hold window elapsing) without moving the piece; otherwise it
   * runs one gravity step. NEVER auto-spawns. So `spawn -> tick` releases the
   * hold and a following `tick` then descends one row at normal gravity.
   */
  testTick(): void {
    if (isHeld(this.state)) {
      this.state = releaseHold(this.state);
    } else {
      this.state = gravityStep(this.state).state;
    }
    this.emit();
  }

  /** FRESH deliberate soft-drop press (vs a carried-over hold). */
  testPressSoftDrop(): void {
    this.pressSoftDrop();
  }

  /** FRESH deliberate hard-drop press (vs a carried-over hold). */
  testPressHardDrop(): void {
    this.pressHardDrop();
  }

  /**
   * Deterministically end the current game with an EXACT final score, driving
   * the REAL game-over transition (sets score, clears the active piece, flips
   * gameOver, emits). Subscribers see `gameOver` and run the same game-over →
   * score-submit path as real play. Used by `window.__lumines.endGame`.
   */
  testEndGame(score: number): void {
    this.started = true;
    this.state = { ...this.state, score, active: null, gameOver: true };
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
