import { GRAVITY_TICK_MS, SOFT_DROP_TICK_MS } from "../constants";
import {
  createInitialState,
  hardDrop,
  moveLeft,
  moveRight,
  placePiece,
  restart as restartState,
  rotate,
  seed as seedState,
  spawnNext,
  stepGravity,
  sweepNow as sweepNowState,
  sweepProgress as sweepProgressState,
} from "../core/engine";
import type { GameState, Piece } from "../core/types";
import { AudioClock } from "../audio/audioClock";
import { TEST_MODE } from "../testMode";

type Listener = () => void;

/**
 * The single source of truth for a running game. Owns the GameState, the
 * production rAF loop (auto-gravity + audio-synced sweep), and the audio clock.
 *
 * In TEST_MODE the auto loop never runs; the game advances only through the
 * deterministic methods (seed/tick/spawn/sweepNow/sweepProgress) that the test
 * API calls. In normal builds those methods still exist but the loop drives play.
 */
export class GameController {
  private state: GameState = createInitialState();
  private listeners = new Set<Listener>();
  private rafId: number | null = null;
  private lastTs: number | null = null;
  private gravityAccum = 0;
  private softDropping = false;
  private running = false;
  private audio: AudioClock | null = null;

  // --- subscription (for React useSyncExternalStore) ---
  subscribe = (fn: Listener): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getState = (): GameState => this.state;

  private set(next: GameState): void {
    this.state = next;
    this.listeners.forEach((l) => l());
  }

  // --- audio ---
  private ensureAudio(): AudioClock {
    this.audio ??= new AudioClock();
    return this.audio;
  }

  getAudioElement(): HTMLAudioElement | null {
    return this.audio?.el ?? null;
  }

  // --- lifecycle ---
  start(): void {
    let s = restartState();
    this.set(s);
    this.gravityAccum = 0;
    this.softDropping = false;
    const audio = this.ensureAudio();
    audio.el.currentTime = 0;
    audio.play();
    if (!TEST_MODE) {
      // spawn the first piece for normal play; test mode waits for spawn()
      s = spawnNext(this.state);
      this.set(s);
      this.startLoop();
    }
  }

  restart(): void {
    this.start();
  }

  private startLoop(): void {
    if (TEST_MODE) return;
    this.running = true;
    this.lastTs = null;
    const loop = (ts: number) => {
      if (!this.running) return;
      this.frame(ts);
      this.rafId = requestAnimationFrame(loop);
    };
    this.rafId = requestAnimationFrame(loop);
  }

  private stopLoop(): void {
    this.running = false;
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.rafId = null;
  }

  private frame(ts: number): void {
    if (this.lastTs === null) {
      this.lastTs = ts;
      return;
    }
    const dt = Math.min(ts - this.lastTs, 100); // clamp to avoid huge jumps
    this.lastTs = ts;

    let s = this.state;
    if (s.gameOver) {
      this.stopLoop();
      this.audio?.pause();
      return;
    }

    // sweep advances continuously at the track tempo (250ms/col = 8 beats/field)
    s = sweepProgressState(s, dt);

    // gravity
    this.gravityAccum += dt;
    const tick = this.softDropping ? SOFT_DROP_TICK_MS : GRAVITY_TICK_MS;
    while (this.gravityAccum >= tick) {
      this.gravityAccum -= tick;
      const before = s.active;
      s = stepGravity(s);
      if (before && !s.active) {
        // locked -> spawn next
        s = spawnNext(s);
        if (s.gameOver) break;
      }
    }

    this.set(s);
  }

  // --- player input (no-ops if not playing) ---
  private guardPlaying(): boolean {
    return this.state.phase === "playing" && !this.state.gameOver;
  }

  moveLeft(): void {
    if (this.guardPlaying()) this.set(moveLeft(this.state));
  }
  moveRight(): void {
    if (this.guardPlaying()) this.set(moveRight(this.state));
  }
  rotate(): void {
    if (this.guardPlaying()) this.set(rotate(this.state));
  }
  setSoftDrop(on: boolean): void {
    this.softDropping = on;
  }
  hardDrop(): void {
    if (!this.guardPlaying()) return;
    let s = hardDrop(this.state);
    if (!TEST_MODE) {
      s = spawnNext(s);
    }
    this.set(s);
  }

  // --- deterministic API (used by the test interface) ---
  seed(n: number): void {
    this.set(seedState(this.state, n));
  }
  tick(): void {
    this.set(stepGravity(this.state));
  }
  spawn(piece: Piece): void {
    this.set(placePiece(this.state, piece));
  }
  sweepNow(): void {
    this.set(sweepNowState(this.state));
  }
  sweepProgress(dtMs: number): void {
    this.set(sweepProgressState(this.state, dtMs));
  }

  destroy(): void {
    this.stopLoop();
    this.audio?.destroy();
    this.audio = null;
    this.listeners.clear();
  }
}
