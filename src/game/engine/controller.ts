import {
  advanceSweep,
  canPlace,
  COLS,
  COLS_PER_BEAT,
  computeMarked,
  createGame,
  floodFill,
  GRAVITY_INTERVAL_MS,
  randomSeed,
  gravityStep,
  hardDrop,
  isHeld,
  SOFT_DROP_INTERVAL_MS,
  isResting,
  lockPiece,
  moveLeft,
  moveRight,
  publicState,
  releaseHold,
  rotateCW,
  runFullSweep,
  seedState,
  setForceGem,
  softDrop,
  spawnFromQueue,
  spawnPiece,
  SWEEP_MS_PER_COL,
  tickHold,
  type GameState,
  type HoldState,
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

/**
 * The sweep tempo (BPM) the bar advances at before the host pushes a real track
 * tempo via {@link GameController.setTempo}. Matches song1's manifest tempo band
 * (≈ 110) so the first pass — which runs before the async audio load reports a
 * tempo — moves at roughly the right speed and never pops when the real value
 * lands. Kept local so the controller stays free of host/audio imports.
 */
export const FALLBACK_BPM = 110;

/**
 * A full deterministic replay of a run (audit A8): the seed plus the ordered
 * input log. Because the core is a pure function of (seed, inputs), seed + this
 * ordered log reproduces the run exactly. Recording is controller-owned (the
 * controller is the only layer that sees wall-clock time + the input stream);
 * playback (re-driving the core) is out of scope here — recording + export is the
 * deliverable.
 */
export interface ReplayRecord {
  schemaVersion: 1;
  seed: number;
  /** Each player input with `t` = ms since game start, in order. */
  inputs: { t: number; action: InputAction }[];
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
  /**
   * Additive (render-only): the raw per-game seed, copied straight from
   * `state.seed`. Lets the HUD / game-over screen display the seed so a run can
   * be reproduced. Pure projection.
   */
  seed: number;
  marked: MarkedCell[];
  /** Spawn-hold for the active piece (held => no descent; "ready to place"). */
  hold: HoldState;
  /** Additive (render-only): the next pieces for the preview panel. */
  queue: GameState["queue"];
  /**
   * Additive (render-only): the active HOST skin index (0-based, in `SKINS`
   * order), pushed in via {@link GameController.setSkinIndex} by the host layer
   * (GameShell) which owns the single skin system. Drives the renderer's
   * per-skin visual variety (background mood + cascade palette). The controller
   * stays host-agnostic — it stores a plain number and never imports the skins.
   */
  skinIndex: number;
  /**
   * Additive (render-only): the active sweep tempo (BPM) the bar is currently
   * advancing at — the latched value from {@link GameController.setTempo},
   * sourced by the host from the active track's manifest tempo. Shown in the HUD
   * and drives the sweep speed.
   */
  bpm: number;
  /**
   * Additive (render-only): coordinates (`row * COLS + col`) of SETTLED cells
   * carrying a chain special, copied straight from the deterministic
   * `state.specials` set. Pure projection — no logic change. The Phase-2 gem
   * indicator reads this to mark settled special cells. (The active piece's
   * special is already reachable via `active.special`.)
   */
  specials: number[];
  /**
   * Additive (render-only): whether the active piece is currently soft-dropping
   * (a fresh soft-drop press is engaged and not held). Pure mirror of the
   * controller's own input/hold state — drives the Phase-2 heat glow on the
   * descending piece. No core/game-state mutation; defaults false.
   */
  softDropping: boolean;
  /**
   * Additive (render-only, Phase 3): the most recent chain-flood clear, copied
   * straight from the core's RECORD-ONLY `state.lastChainClear`. Carries the
   * origin chain cell, the ordered cleared component (each cell tagged with its
   * BFS distance from the origin), and a monotonic `id`. The renderer fires the
   * travelling-wavefront effect once per new `id`. Pure projection — no logic
   * change; the deletion result is identical with or without it. `undefined`
   * until the first chain clear.
   */
  lastChainClear?: { origin: number; cells: { cell: number; dist: number }[]; id: number };
  /**
   * Additive (render-only): a monotonic counter incremented on EVERY soft-drop
   * step. The renderer diffs it frame-to-frame to detect "a soft-drop step
   * happened recently" independent of the per-row `fallProgress` velocity (which
   * is coarse for the one-row soft-drop). Drives the warm motion-smear / speed
   * lines on the descending piece. 0 until the first soft drop.
   */
  softDropPulses: number;
  /**
   * Additive (render-only): coordinates (`row * COLS + col`) of SETTLED cells a
   * gem is ABOUT TO FLOOD-CLEAR on the next sweep pass. Computed purely from the
   * current grid: any settled chain-special cell that is part of a completed
   * square (so it WILL activate when the bar reaches it) floods its same-colour
   * 4-connected region; every cell in that region is reported here. The renderer
   * gives these the same bright "marked / about to clear" pulse as ordinary
   * to-clear cells, so the player SEES the chain extent building BEFORE the sweep
   * harvests it (previously the flooded blocks just vanished with no warning).
   * Pure projection — no core mutation; the deletion result is identical with or
   * without it. Empty when no armed gem is on the board.
   */
  floodPreview: number[];
  /**
   * Additive (render-only): the most recent HARD drop, for the slam impact FX.
   * `id` is monotonic so the renderer fires the slam exactly once per drop;
   * `cols` are the (1-2) board columns the piece occupied; `row` is the impact
   * row (the lowest cell's resting row); `distance` is how many rows the piece
   * fell (drives screen-shake + spark intensity — a long slam hits harder).
   * `undefined` until the first hard drop. Pure projection; no logic change.
   */
  lastHardDrop?: { id: number; cols: number[]; row: number; distance: number };
  /**
   * Additive (render-only, D8 audio-truth contract): the most recent pass-
   * completion event, copied straight from the core's RECORD-ONLY
   * `state.lastPassComplete`. Carries a monotonic `id` (fire once per new id), the
   * `squares` cleared, the `comboMultiplier` applied, and per-group `groupErases`.
   * The audio layer reads real clear truth instead of inferring from score deltas.
   * Pure projection — no logic change. `undefined` until the first completed pass.
   */
  lastPassComplete?: {
    id: number;
    squares: number;
    comboMultiplier: number;
    groupErases: { cells: number[]; hadChain: boolean }[];
  };
  /**
   * Additive (render-only, D8 audio-truth contract): the most recent lock event,
   * copied straight from the core's RECORD-ONLY `state.lastLock`. Carries a
   * monotonic `id` and the `cause` ("gravity" | "soft" | "hard") so the audio
   * layer plays the right lock/thud SFX on EVERY lock. Pure projection.
   * `undefined` until the first lock.
   */
  lastLock?: { id: number; cause: "gravity" | "soft" | "hard" };
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
  /**
   * Render-only: true while a soft drop is actively engaged for the current
   * piece. Set when a soft-drop step runs; cleared when a new piece spawns or
   * the piece locks. Surfaced ONLY through {@link RenderState.softDropping} for
   * the Phase-2 heat glow — it never feeds the deterministic core, scoring, RNG,
   * gravity, or the sweep, and the test harness drives the board through paths
   * that leave it false, so determinism + existing tests are untouched.
   */
  private softDropEngaged = false;
  /**
   * Render-only: monotonic count of soft-drop STEPS, surfaced through
   * {@link RenderState.softDropPulses}. The renderer diffs it to detect a recent
   * soft-drop step (drives the motion-smear / speed lines) without relying on the
   * coarse per-row fall velocity. Production-only writes, like
   * {@link softDropEngaged} — test paths leave it untouched.
   */
  private softDropPulses = 0;
  /**
   * Hold-to-sustain soft drop (production-only). True while the soft-drop key is
   * HELD down (engaged by a fresh press, disengaged on key-up / lock / spawn).
   * While engaged AND the spawn-hold has lapsed, gravity advances at the faster
   * {@link SOFT_DROP_INTERVAL_MS} cadence instead of {@link GRAVITY_INTERVAL_MS},
   * so a held key produces CONTINUOUS slow fall (faster than gravity, slower than
   * a hard drop) rather than one row per press. Each sustained step still routes
   * through the pure `softDrop` core op, so scoring + determinism are unchanged.
   * Test mode leaves this false (the seam drives single steps), so existing tests
   * are observationally identical.
   */
  private softDropSustained = false;
  /**
   * Paused (production-only). When true the rAF loop is cancelled and neither the
   * sweep nor gravity advances; the active piece, grid, and score are preserved.
   * Resuming re-anchors the sweep baseline (no rewind) and restarts the loop.
   */
  private paused = false;
  /**
   * Render-only: the most recent hard-drop event (slam FX), surfaced through
   * {@link RenderState.lastHardDrop}. `id` is monotonic so the renderer fires the
   * slam exactly once. Captured in {@link hardDropStep} from the active piece's
   * pre-drop position. Production-only; test paths never populate it.
   */
  private lastHardDrop:
    | { id: number; cols: number[]; row: number; distance: number }
    | undefined = undefined;
  private hardDropSeq = 0;
  /**
   * Replay recording (audit A8): every player input tagged with `t` = ms since
   * game start, in order. `replayStartT` is the absolute clock time (seconds) the
   * run started, set on `start()` so each input's `t` is `clock.now()*1000 -
   * replayStartT*1000`. Reset on `restart()`. Controller-owned: timestamps are
   * wall-clock and the core is time-free, but seed + this log reproduces the run.
   */
  private replayInputs: { t: number; action: InputAction }[] = [];
  private replayStartT = 0;
  /**
   * The BPM the sweep is currently advancing at — the LATCHED tempo. Re-read
   * from {@link pendingTempoBpm} only at a bar/pass boundary (when `sweepX` is at
   * 0) so a mid-pass tempo change does NOT discontinuously move the bar; the new
   * tempo takes effect from the next bar. 0 = not yet latched (latched on the
   * first advance).
   */
  private activeBpm = 0;
  /**
   * The tempo the HOST has pushed via {@link setTempo} (the active track's
   * manifest BPM). The latch in {@link currentSweepBpm} adopts it at the next
   * pass boundary. Defaults to {@link FALLBACK_BPM} so the bar moves on the first
   * pass even before the host pushes a tempo (audio loads async).
   */
  private pendingTempoBpm = FALLBACK_BPM;
  /**
   * The active HOST skin index (render-only), pushed via {@link setSkinIndex}.
   * Projected straight into `RenderState.skinIndex`; the controller never reads
   * it for timing/gameplay. The host (GameShell) owns the single skin system.
   */
  private skinIndex = 0;

  constructor(opts: ControllerOptions = {}) {
    this.testMode = opts.testMode ?? false;
    // Production seeds a fresh random run (audit A4); an explicit opts.seed pins
    // a reproducible game (tests). NOT a fixed default of 1.
    this.state = createGame(opts.seed ?? randomSeed());
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
    // Anchor the replay clock to the run start so each recorded input's `t` is ms
    // since the game began (audit A8).
    this.replayStartT = this.clock.now();
    if (!this.testMode) {
      // The Start click IS the user gesture: resume the AudioContext here so
      // musical time starts immediately, rather than waiting for the first
      // keyboard input (otherwise now() stays 0, dt stays 0, board frozen).
      this.resumeClockOnFirstGesture();
      this.state = spawnFromQueue(this.state);
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

  // ---- pause / resume (production loop only) --------------------------------

  /**
   * Pause play: cancel the rAF loop so neither the sweep nor gravity advances.
   * The active piece, grid, and score are preserved. No-op in test mode (the
   * loop is already quiescent), if not started, or if already paused.
   */
  pause(): void {
    if (this.testMode || !this.started || this.paused) return;
    this.paused = true;
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.emit();
  }

  /**
   * Resume play after a pause. Re-anchor the sweep baseline so the next valid
   * frame measures musical time from `now` (no rewind / discontinuous jump — the
   * same re-anchor the suspend/re-suspend path uses), then restart the loop.
   */
  resume(): void {
    if (this.testMode || !this.started || !this.paused) return;
    this.paused = false;
    // Re-anchor so the sweep continues forward from here rather than swallowing
    // the paused span. lastClockNow<=0 makes the next runFrame re-baseline.
    this.lastClockNow = 0;
    this.startLoop();
    this.emit();
  }

  /** Toggle paused state (Escape). */
  togglePause(): void {
    if (this.paused) this.resume();
    else this.pause();
  }

  isPaused(): boolean {
    return this.paused;
  }

  /** Reset to a fresh game (optionally reseeded) and restart play. */
  restart(seed?: number): void {
    this.stop();
    // A no-argument restart reseeds RANDOMLY (audit A4) — never back to seed 1,
    // which dealt an identical run every time. An explicit seed still pins one.
    this.state = createGame(seed ?? randomSeed());
    this.gravityAccumMs = 0;
    this.lastClockNow = 0;
    this.sweepStartT = 0;
    this.sweepColumnsConsumed = 0;
    this.activeBpm = 0;
    // Restart resets to the base skin + fallback tempo; the host re-pushes the
    // base skin's tempo + index via setTempo/setSkinIndex in handleRestart.
    this.pendingTempoBpm = FALLBACK_BPM;
    this.skinIndex = 0;
    this.paused = false;
    this.softDropSustained = false;
    // Fresh run -> fresh replay log (re-anchored by start() below).
    this.replayInputs = [];
    this.replayStartT = 0;
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
    this.activeBpm = 0;
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
    // Paused: freeze everything. The rAF loop is already cancelled in production,
    // but guard here too so a directly-driven frame (tests) cannot advance while
    // paused. Do not emit (state is unchanged).
    if (this.paused) return;
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

    // --- Sweep: integrate the active BPM over the clock delta ---
    // columns += dtSeconds * (bpm/60) * COLS_PER_BEAT (one column per eighth-
    // note at COLS_PER_BEAT=2). The BPM is the current SKIN's BPM, but re-read
    // only at bar boundaries (see currentSweepBpm) so a mid-pass skin change
    // does not jump the bar. Within a constant-BPM segment this is exactly the
    // absolute-time formula (integral of a constant rate), so it stays
    // frame-rate independent and drift-free.
    const dtSeconds = now - this.lastClockNow;
    const bpm = this.currentSweepBpm();
    const delta = dtSeconds * (bpm / 60) * COLS_PER_BEAT;
    if (delta > 0) {
      this.sweepColumnsConsumed += delta;
      this.advanceSweepColumns(delta);
    }

    // --- Gravity: independent dt accumulator (not music-synced) ---
    const dt = Math.min((now - this.lastClockNow) * 1000, 100); // clamp tab-out
    this.lastClockNow = now;
    this.advanceGravity(dt);
    this.emit();
  }

  /**
   * The BPM the sweep should advance at this frame. The host-pushed tempo
   * ({@link pendingTempoBpm}, the active track's manifest BPM) is latched at each
   * bar/pass boundary (when `sweepX` is at 0) rather than read live, so a tempo
   * change mid-pass does not discontinuously move the bar — the new tempo applies
   * from the next bar. Latches on the first read too.
   */
  private currentSweepBpm(): number {
    if (this.activeBpm === 0 || this.state.sweepX === 0) {
      this.activeBpm = this.pendingTempoBpm;
    }
    return this.activeBpm;
  }

  /**
   * Host seam (audio-agnostic): push the sweep tempo (the active track's manifest
   * BPM). Stored as a pending value the latch adopts at the next pass boundary —
   * never applied mid-pass, preserving the no-discontinuity guarantee. The
   * controller takes a plain number and never imports the audio engine or skins.
   */
  setTempo(bpm: number): void {
    if (Number.isFinite(bpm) && bpm > 0) this.pendingTempoBpm = bpm;
  }

  /**
   * Host seam (render-only): set the active HOST skin index, projected straight
   * into `RenderState.skinIndex` for the renderer's per-skin visual variety. A
   * plain number; never read for timing/gameplay.
   */
  setSkinIndex(index: number): void {
    this.skinIndex = Math.max(0, Math.floor(index));
    this.emit();
  }

  /** Advance the sweep by an absolute-time-derived column delta. */
  private advanceSweepColumns(columns: number): void {
    if (this.state.gameOver) return;
    this.state = advanceSweep(this.state, columns);
  }

  /**
   * Advance gravity by dt ms on a fixed tick + auto-spawn. The music-synced
   * sweep is advanced separately from absolute clock time in {@link runFrame};
   * this method is gravity-only (V2 architecture).
   */
  private advanceGravity(dtMs: number): void {
    if (this.state.gameOver) return;

    // New-block hold (brownfield): a freshly spawned piece holds at the top for
    // one beat. Gravity is suspended (accumulator pinned to 0) until the hold
    // lapses, at which point normal gravity resumes from a clean accumulator.
    // The sweep keeps moving (it lives in runFrame), so musical time is
    // unaffected by the hold.
    if (isHeld(this.state)) {
      this.state = tickHold(this.state, dtMs);
      this.gravityAccumMs = 0;
      return;
    }

    // Hold-to-sustain soft drop: while the soft-drop key is held (and the spawn-
    // hold has lapsed), descend at the faster SOFT_DROP_INTERVAL_MS cadence so the
    // piece falls CONTINUOUSLY at soft-drop speed instead of one row per press.
    // Otherwise use normal gravity. Each soft-drop step is scored via softDropStep
    // (the pure softDrop core op), matching a tapped soft drop.
    const interval = this.softDropSustained
      ? SOFT_DROP_INTERVAL_MS
      : GRAVITY_INTERVAL_MS;

    this.gravityAccumMs += dtMs;
    while (this.gravityAccumMs >= interval) {
      this.gravityAccumMs -= interval;
      if (this.softDropSustained) {
        this.sustainedSoftDropTick();
      } else {
        this.gravityTickAndSpawn();
      }
      if (this.state.gameOver) break;
    }
  }

  /**
   * One sustained-soft-drop gravity step: a scored {@link softDropStep} (the
   * piece descends one row, banking +1) with production auto-spawn on lock. Keeps
   * the same scoring + spawn behaviour as a tapped soft drop, just driven by the
   * faster sustained cadence rather than a discrete press.
   */
  private sustainedSoftDropTick(): void {
    this.softDropStep();
  }

  private gravityTickAndSpawn(): void {
    // A natural gravity tick means the player is NOT actively soft-dropping this
    // beat — cool the render-only heat glow. (No effect on game state.)
    this.softDropEngaged = false;
    const { state, locked } = gravityStep(this.state);
    this.state = state;
    if (locked) {
      this.gravityAccumMs = 0;
      // Clear sustained mode on a natural lock too, for symmetry with the
      // soft-drop lock path (the next piece's spawn-hold must be honoured).
      this.softDropSustained = false;
      // A lock that topped the game out (A5/D4: cells above row 0) must NOT
      // auto-spawn the next piece — the game is over.
      if (!this.state.gameOver) this.state = spawnFromQueue(this.state);
    }
  }

  // ---- player input (active only while playing) ----------------------------

  /**
   * Record a player input into the replay log with `t` = ms since game start
   * (audit A8). `t` is non-decreasing as long as the clock is monotonic. Called by
   * the player-input entry points so seed + this log reproduces the run.
   */
  private recordInput(action: InputAction): void {
    const t = Math.max(0, this.clock.now() * 1000 - this.replayStartT * 1000);
    this.replayInputs.push({ t, action });
  }

  input(action: InputAction): void {
    if (!this.started || this.state.gameOver || !this.state.active) return;
    this.resumeClockOnFirstGesture();
    this.recordInput(action);
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
        // new piece. A FRESH press routes to pressSoftDrop() instead. The step
        // itself uses V2's scored softDrop (+1/row) and queue-based respawn.
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

  /**
   * A FRESH, deliberate soft-drop press: ends any hold, does an immediate step,
   * and ENGAGES sustained mode so HOLDING the key keeps the piece falling at
   * soft-drop speed (see {@link advanceGravity}). Released by {@link
   * releaseSoftDrop} (key-up) or cleared automatically on the next lock/spawn.
   */
  pressSoftDrop(): void {
    if (!this.started || this.state.gameOver || !this.state.active) return;
    this.recordInput("softDrop");
    if (!this.testMode) this.softDropSustained = true;
    this.state = releaseHold(this.state);
    this.softDropStep();
    this.emit();
  }

  /**
   * Soft-drop key released: disengage sustained mode so the piece reverts to the
   * normal gravity cadence. Production-only; no-op in test mode.
   */
  releaseSoftDrop(): void {
    this.softDropSustained = false;
  }

  /** A FRESH, deliberate hard-drop press: ends any hold and drops immediately. */
  pressHardDrop(): void {
    if (!this.started || this.state.gameOver || !this.state.active) return;
    this.recordInput("hardDrop");
    this.state = releaseHold(this.state);
    this.hardDropStep();
    this.emit();
  }

  /**
   * One soft-drop gravity step; production auto-spawns the next (held) piece on
   * lock. Uses V2's scored softDrop (+1/row) and the preview-queue spawn so the
   * combined build keeps both the new-block hold AND V2's scoring/preview.
   */
  private softDropStep(): void {
    // Render-only heat signal: a soft-drop step engages the glow. Cleared again
    // on lock/spawn below (and on hard drop). Production-only so test runs that
    // call softDropStep stay observationally identical.
    if (!this.testMode) {
      this.softDropEngaged = true;
      // Render-only: tick the soft-drop pulse counter so the renderer can read
      // "a soft-drop step just happened" for the motion-smear / speed lines.
      this.softDropPulses++;
    }
    const { state, locked } = softDrop(this.state);
    this.state = state;
    if (locked && !this.testMode) {
      this.gravityAccumMs = 0;
      this.softDropEngaged = false;
      // Clear sustained mode on lock so the NEXT piece's spawn-hold is honoured:
      // the player must press soft-drop again to fast-fall it, matching the
      // deliberate-placement model (a held key cannot cascade into a new piece).
      this.softDropSustained = false;
      // A top-out lock (A5/D4) must NOT auto-spawn — the game is over.
      if (!this.state.gameOver) this.state = spawnFromQueue(this.state);
    }
  }

  /** Hard-drop to the floor + lock; production auto-spawns from the preview queue. */
  private hardDropStep(): void {
    this.softDropEngaged = false;
    // Render-only: capture the slam BEFORE the drop+spawn mutates state, so the
    // FX layer knows where (and how hard) the piece landed. The lowest piece row
    // after the fall is computed the same way `hardDrop` descends: walk down
    // until the piece can no longer place. Production-only — test paths skip it
    // so `lastHardDrop` stays undefined and existing assertions are unaffected.
    if (!this.testMode && this.state.active && !this.state.gameOver) {
      const a = this.state.active;
      const cols = [a.pos.col, a.pos.col + 1];
      let landedRow = a.pos.row;
      while (
        canPlace(this.state.grid, a.cells, { row: landedRow + 1, col: a.pos.col })
      ) {
        landedRow++;
      }
      const distance = landedRow - a.pos.row;
      this.hardDropSeq++;
      this.lastHardDrop = {
        id: this.hardDropSeq,
        cols,
        row: landedRow + 1, // impact row = the piece's LOWEST cell's resting row
        distance,
      };
    }
    this.state = hardDrop(this.state);
    if (!this.testMode) {
      this.gravityAccumMs = 0;
      // A top-out lock (A5/D4) must NOT auto-spawn — the game is over.
      if (!this.state.gameOver) this.state = spawnFromQueue(this.state);
    }
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

  /**
   * Render-only: the cells a gem will FLOOD-CLEAR on the next pass, so the
   * renderer can mark them as "about to clear" BEFORE the sweep harvests them.
   * Pure function of the current grid + specials + the marked set: a settled
   * chain-special cell that is part of a completed square (hence marked, hence it
   * WILL activate when the bar reaches it) floods its same-colour 4-connected
   * region; every cell of every such region is collected. Computes nothing that
   * feeds gameplay — it mirrors exactly what {@link chainFlood} would delete, for
   * a pre-clear visual warning only. No mutation.
   */
  private computeFloodPreview(): number[] {
    const grid = this.state.grid;
    const specials = this.state.specials;
    if (specials.size === 0) return [];
    // Cells already destined to clear this pass (completed squares). A gem only
    // floods when it is itself part of a cleared square, so restrict to armed
    // gems = specials that sit on a marked cell.
    const markedSet = new Set(
      computeMarked(grid).marked.map((m) => m.row * COLS + m.col),
    );
    const preview = new Set<number>();
    for (const coord of specials) {
      if (!markedSet.has(coord)) continue; // gem won't activate this pass
      const row = Math.floor(coord / COLS);
      const col = coord % COLS;
      const colour = grid[row]?.[col] ?? null;
      if (colour === null) continue;
      for (const c of floodFill(grid, coord, colour)) preview.add(c);
    }
    return Array.from(preview);
  }

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
      seed: this.state.seed,
      marked: computeMarked(this.state.grid).marked,
      hold: this.state.hold,
      queue: this.state.queue,
      // Render-only: the host-owned skin index + the current sweep tempo. The
      // displayed BPM is the LATCHED active tempo (or the pending one before the
      // first latch) — a pure read, no latch side effect here.
      skinIndex: this.skinIndex,
      bpm: this.activeBpm || this.pendingTempoBpm,
      // Additive render-only projections (no logic change): settled special
      // coords copied straight from the core set, and the soft-drop heat flag.
      specials: Array.from(this.state.specials),
      softDropping: this.softDropEngaged,
      // Phase 3 render-only projection: the core's record-only chain-clear event
      // (with its monotonic id) passed straight through for the wavefront effect.
      lastChainClear: this.state.lastChainClear,
      // Drop-feedback render-only projections (no logic change): the soft-drop
      // step pulse counter and the most recent hard-drop slam event.
      softDropPulses: this.softDropPulses,
      lastHardDrop: this.lastHardDrop,
      // Render-only: cells a gem is about to flood-clear (pre-clear marking).
      floodPreview: this.computeFloodPreview(),
      // D8 audio-truth telemetry passthrough (record-only, no logic change).
      // COPIED (not aliased) so a subscriber can never mutate the core's internal
      // telemetry — `lastPassComplete.groupErases[].cells` are nested mutable
      // arrays, and this is a contract a sibling audio change consumes. Mirrors the
      // deep-copy `publicState()` already does for the same fields.
      lastPassComplete: this.state.lastPassComplete
        ? {
            id: this.state.lastPassComplete.id,
            squares: this.state.lastPassComplete.squares,
            comboMultiplier: this.state.lastPassComplete.comboMultiplier,
            groupErases: this.state.lastPassComplete.groupErases.map((g) => ({
              cells: g.cells.slice(),
              hadChain: g.hadChain,
            })),
          }
        : undefined,
      lastLock: this.state.lastLock
        ? { id: this.state.lastLock.id, cause: this.state.lastLock.cause }
        : undefined,
    };
  }

  getRenderState(): RenderState {
    return this.renderState();
  }

  /**
   * The replay record for the current run (audit A8): `{ schemaVersion, seed,
   * inputs }`. Seed + ordered inputs reproduce the run because the core is a pure
   * function of (seed, inputs). Exposed on game over for download/inspection.
   * Returns a copy of the input log so callers cannot mutate the controller state.
   */
  getReplay(): ReplayRecord {
    return {
      schemaVersion: 1,
      seed: this.state.seed,
      inputs: this.replayInputs.map((i) => ({ t: i.t, action: i.action })),
    };
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

  /**
   * Test-only: mark a settled cell as carrying a chain special (additive).
   * Coordinate is `row * COLS + col`, matching `state().specials`. Lets a test
   * set up a chain activation deterministically without driving an RNG special
   * through gravity. Does not emit.
   */
  testSetSpecial(row: number, col: number): void {
    const specials = new Set(this.state.specials);
    specials.add(row * COLS + col);
    this.state = { ...this.state, specials };
  }

  /**
   * Test-only: push a sweep tempo (BPM) through the host seam. Stored as the
   * pending tempo the latch adopts at the next pass boundary (sweepX === 0), so a
   * test can assert tempo-driven sweep speed + the no-mid-pass-jump latch. Read
   * the resulting active tempo via `getRenderState().bpm`.
   */
  testSetTempo(bpm: number): void {
    this.setTempo(bpm);
    this.emit();
  }

  /**
   * Test-only: the raw GameState (additive). Exposes internal fields the public
   * projection omits so deterministic tests can assert core state directly.
   */
  testRawState(): GameState {
    return this.state;
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

  /**
   * Dev/test-only: toggle the core force-gem flag so every subsequently spawned
   * piece carries a chain special. Lets the gem cascade be exercised on demand
   * (the natural rate is too sparse to reliably observe). Off by default; flipping
   * it does not alter the RNG draw order, only the special verdict (see
   * {@link setForceGem}). Production never calls this.
   */
  setForceGem(on: boolean): void {
    setForceGem(on);
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
