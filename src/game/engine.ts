import { GRAVITY_INTERVAL, GRID_COLS, SWEEP_PERIOD } from "./constants";
import { getFullGrid, lockPiece, markSquares } from "./grid";
import { InputHandler } from "./input";
import {
  canPlace,
  hardDrop,
  moveDown,
  moveLeft,
  moveRight,
  spawnPiece,
  spawnSpecificPiece,
  tryRotate,
} from "./piece";
import { createRng } from "./rng";
import { createInitialState } from "./state";
import { advanceSweep, sweepNow as sweepNowFn } from "./sweep";
import type { GameState, MarkedCell, PieceDef, StateSnapshot } from "./types";

export type EngineEvent =
  | "pieceMoved"
  | "pieceLocked"
  | "cellsCleared"
  | "gravityApplied"
  | "gameOver"
  | "scoreChanged";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type EventCallback = (...args: any[]) => void;

export class GameEngine {
  state: GameState;
  private input: InputHandler;
  private rng: () => number;
  private running = false;
  private testMode: boolean;
  private audio: HTMLAudioElement | null = null;
  private lastFrameTime = 0;
  private lastGravityTime = 0;
  private gameStartTime = 0;
  private listeners = new Map<EngineEvent, Set<EventCallback>>();
  private rafId: number | null = null;

  constructor(testMode = false) {
    this.testMode = testMode;
    this.state = createInitialState();
    this.rng = createRng(Date.now());
    this.input = new InputHandler({
      moveLeft: () => this.handleMoveLeft(),
      moveRight: () => this.handleMoveRight(),
      softDrop: () => this.handleSoftDrop(),
      rotate: () => this.handleRotate(),
      hardDrop: () => this.handleHardDrop(),
    });
  }

  // --- Events ---

  on(event: EngineEvent, callback: EventCallback): void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(callback);
  }

  off(event: EngineEvent, callback: EventCallback): void {
    const set = this.listeners.get(event);
    if (set) {
      set.delete(callback);
    }
  }

  private emit(event: EngineEvent, data?: unknown): void {
    const set = this.listeners.get(event);
    if (set) {
      for (const cb of set) {
        cb(data);
      }
    }
  }

  // --- Lifecycle ---

  start(): void {
    if (this.running) return;
    this.running = true;
    this.state = createInitialState();
    this.gameStartTime = performance.now();
    this.lastGravityTime = this.gameStartTime;
    this.lastFrameTime = this.gameStartTime;

    if (!this.testMode) {
      this.doSpawn();
      this.input.attach();
      this.input.setEnabled(true);
      this.loop(performance.now());
    }
  }

  stop(): void {
    this.running = false;
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.input.setEnabled(false);
    this.input.detach();
  }

  reset(): void {
    this.stop();
    this.state = createInitialState();
  }

  // --- Audio ---

  setAudio(audio: HTMLAudioElement): void {
    this.audio = audio;
  }

  // --- Game loop (internal) ---

  private loop = (timestamp: number): void => {
    if (!this.running) return;

    const dt = timestamp - this.lastFrameTime;
    this.lastFrameTime = timestamp;

    this.update(dt);

    this.rafId = requestAnimationFrame(this.loop);
  };

  private update(_dt: number): void {
    if (this.state.gameOver) return;

    const now = performance.now();

    // Gravity
    if (this.state.activePiece) {
      if (now - this.lastGravityTime >= GRAVITY_INTERVAL) {
        this.lastGravityTime = now;
        this.applyGravityTick();
      }
    }

    // Sweep advancement
    const sweepDt = this.getSweepDt(now);
    if (sweepDt > 0) {
      const prevScore = this.state.score;
      advanceSweep(this.state, sweepDt);
      if (this.state.score !== prevScore) {
        this.emit("scoreChanged", { score: this.state.score });
      }
    }
  }

  // --- Test mode API methods ---

  seed(n: number): void {
    this.rng = createRng(n);
  }

  getState(): StateSnapshot {
    return {
      grid: getFullGrid(this.state),
      score: this.state.score,
      gameOver: this.state.gameOver,
      sweepX: this.state.sweepX,
    };
  }

  getMarked(): MarkedCell[] {
    const result: MarkedCell[] = [];
    for (const key of this.state.markedCells) {
      const [rowStr, colStr] = key.split(",");
      result.push({ row: parseInt(rowStr!, 10), col: parseInt(colStr!, 10) });
    }
    return result;
  }

  spawnPiece(piece?: PieceDef): void {
    // Lock current piece if one is active
    if (this.state.activePiece) {
      const { row, col } = this.state.activePiece;
      lockPiece(this.state);
      markSquares(this.state);
      this.emit("pieceLocked", { row, col });
    }

    if (piece) {
      this.state.activePiece = spawnSpecificPiece(piece);
    } else {
      this.state.activePiece = spawnPiece(this.rng);
    }

    // Check game over
    if (
      !canPlace(
        this.state.grid,
        this.state.activePiece.cells,
        this.state.activePiece.row,
        this.state.activePiece.col,
      )
    ) {
      this.state.gameOver = true;
      this.emit("gameOver", undefined);
    }
  }

  /** Advance one gravity tick. In test mode, does NOT auto-spawn on lock. */
  tick(): void {
    if (!this.state.activePiece || this.state.gameOver) return;

    const moved = moveDown(this.state.grid, this.state.activePiece);
    if (moved) {
      this.state.activePiece = moved;
      this.emit("gravityApplied", undefined);
      this.emit("pieceMoved", {
        row: moved.row,
        col: moved.col,
      });
    } else {
      // Lock
      const { row, col } = this.state.activePiece;
      lockPiece(this.state);
      markSquares(this.state);
      this.emit("pieceLocked", { row, col });

      // In test mode, do NOT auto-spawn
      if (!this.testMode) {
        this.doSpawn();
      }
    }
  }

  sweepNow(): void {
    const prevScore = this.state.score;
    sweepNowFn(this.state);
    if (this.state.score !== prevScore) {
      this.emit("scoreChanged", { score: this.state.score });
    }
    this.emit("cellsCleared", undefined);
  }

  sweepProgress(dtMs: number): void {
    const prevScore = this.state.score;
    advanceSweep(this.state, dtMs);
    if (this.state.score !== prevScore) {
      this.emit("scoreChanged", { score: this.state.score });
    }
  }

  // --- Helpers (public for integration) ---

  isRunning(): boolean {
    return this.running;
  }

  // --- Private ---

  private doSpawn(): void {
    const newPiece = spawnPiece(this.rng);
    this.state.activePiece = newPiece;

    if (!canPlace(this.state.grid, newPiece.cells, newPiece.row, newPiece.col)) {
      this.state.gameOver = true;
      this.running = false;
      this.input.setEnabled(false);
      this.emit("gameOver", undefined);
    }
  }

  /** Apply one gravity step (used by both loop and tick()). */
  private applyGravityTick(): void {
    if (!this.state.activePiece) return;

    const moved = moveDown(this.state.grid, this.state.activePiece);
    if (moved) {
      this.state.activePiece = moved;
      this.emit("gravityApplied", undefined);
      this.emit("pieceMoved", { row: moved.row, col: moved.col });
    } else {
      const { row, col } = this.state.activePiece;
      lockPiece(this.state);
      markSquares(this.state);
      this.emit("pieceLocked", { row, col });
      this.doSpawn();
    }
  }

  private handleMoveLeft(): void {
    if (this.state.gameOver || !this.state.activePiece) return;
    const moved = moveLeft(this.state.grid, this.state.activePiece);
    if (moved) {
      this.state.activePiece = moved;
      this.emit("pieceMoved", { row: moved.row, col: moved.col });
    }
  }

  private handleMoveRight(): void {
    if (this.state.gameOver || !this.state.activePiece) return;
    const moved = moveRight(this.state.grid, this.state.activePiece);
    if (moved) {
      this.state.activePiece = moved;
      this.emit("pieceMoved", { row: moved.row, col: moved.col });
    }
  }

  private handleSoftDrop(): void {
    if (this.state.gameOver || !this.state.activePiece) return;
    const moved = moveDown(this.state.grid, this.state.activePiece);
    if (moved) {
      this.state.activePiece = moved;
      this.emit("pieceMoved", { row: moved.row, col: moved.col });
    } else {
      // Lock
      const { row, col } = this.state.activePiece;
      lockPiece(this.state);
      markSquares(this.state);
      this.emit("pieceLocked", { row, col });
      this.doSpawn();
    }
    // Reset gravity timer on soft drop
    this.lastGravityTime = performance.now();
  }

  private handleRotate(): void {
    if (this.state.gameOver || !this.state.activePiece) return;
    const rotated = tryRotate(this.state.grid, this.state.activePiece);
    if (rotated) {
      this.state.activePiece = rotated;
      this.emit("pieceMoved", { row: rotated.row, col: rotated.col });
    }
  }

  private handleHardDrop(): void {
    if (this.state.gameOver || !this.state.activePiece) return;
    const dropped = hardDrop(this.state.grid, this.state.activePiece);
    this.state.activePiece = dropped;
    this.emit("pieceMoved", { row: dropped.row, col: dropped.col });
    lockPiece(this.state);
    markSquares(this.state);
    this.emit("pieceLocked", { row: dropped.row, col: dropped.col });
    this.doSpawn();
    this.lastGravityTime = performance.now();
  }

  private getSweepDt(now: number): number {
    // Try to derive from audio time for sync
    if (this.audio && !this.audio.paused) {
      const audioTime = this.audio.currentTime;
      const expectedX =
        ((audioTime % (SWEEP_PERIOD / 1000)) / (SWEEP_PERIOD / 1000)) *
        GRID_COLS;
      // Calculate how much to advance to reach the expected position
      let diff = expectedX - this.state.sweepX;
      if (diff < -GRID_COLS / 2) diff += GRID_COLS; // wrap-around
      if (diff > 0 && diff < GRID_COLS) {
        return (diff / GRID_COLS) * SWEEP_PERIOD;
      }
      return 0;
    }

    // Fallback: wall-clock based advancement
    const elapsed = now - this.gameStartTime;
    const expectedX = ((elapsed % SWEEP_PERIOD) / SWEEP_PERIOD) * GRID_COLS;
    let diff = expectedX - this.state.sweepX;
    if (diff < -GRID_COLS / 2) diff += GRID_COLS;
    if (diff > 0 && diff < GRID_COLS) {
      return (diff / GRID_COLS) * SWEEP_PERIOD;
    }
    return 0;
  }
}
