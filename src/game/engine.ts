import {
  COLS,
  ROWS,
  SPAWN_COL,
  SPAWN_ROW,
  SWEEP_COLS_PER_MS,
} from "./constants";
import {
  applyGravity,
  cloneGrid,
  createGrid,
  inBounds,
  markedCells,
  markedMask,
  squareTopLefts,
} from "./grid";
import { Rng } from "./rng";
import type {
  ActivePiece,
  CellCoord,
  Grid,
  Phase,
  Piece,
  PublicState,
} from "./types";

const EPS = 1e-9;

interface SweepState {
  /** Current bar position in columns, 0..16. */
  x: number;
  /** Marked-cell snapshot taken at the start of the current traversal. */
  marked: boolean[][] | null;
  /** Distinct monochrome 2x2 count snapshot for the current traversal. */
  distinctSquares: number;
  /** Cells deleted so far during the current traversal. */
  deleted: number;
  /** Highest column index already passed/processed this traversal. */
  lastCol: number;
}

export type EngineEvent =
  | "change"
  | "spawn"
  | "lock"
  | "clear"
  | "gameover"
  | "phase";

type Listener = (payload?: unknown) => void;

/**
 * Environment-agnostic game state machine. It knows nothing about rendering,
 * audio, the DOM, or the clock — callers (the React/Pixi layer, or the test
 * harness) drive it explicitly. This keeps every pinned rule unit-testable.
 */
export class GameEngine {
  grid: Grid = createGrid();
  piece: ActivePiece | null = null;
  score = 0;
  phase: Phase = "start";

  private rng = new Rng(1);
  private sweep: SweepState = {
    x: 0,
    marked: null,
    distinctSquares: 0,
    deleted: 0,
    lastCol: -1,
  };
  private listeners = new Map<EngineEvent, Set<Listener>>();

  // ---- events -----------------------------------------------------------

  on(event: EngineEvent, fn: Listener): () => void {
    const set = this.listeners.get(event) ?? new Set<Listener>();
    this.listeners.set(event, set);
    set.add(fn);
    return () => set.delete(fn);
  }

  private emit(event: EngineEvent, payload?: unknown): void {
    this.listeners.get(event)?.forEach((fn) => fn(payload));
  }

  // ---- lifecycle --------------------------------------------------------

  /** Reset to a clean playing field. `autoSpawn` drops the first piece. */
  start(autoSpawn: boolean): void {
    this.grid = createGrid();
    this.piece = null;
    this.score = 0;
    this.resetSweep();
    this.setPhase("playing");
    if (autoSpawn) this.spawnFromRng();
    this.emit("change");
  }

  restart(autoSpawn: boolean): void {
    this.start(autoSpawn);
  }

  private setPhase(phase: Phase): void {
    if (this.phase === phase) return;
    this.phase = phase;
    this.emit("phase", phase);
  }

  seed(n: number): void {
    this.rng.seed(n);
  }

  // ---- piece geometry ---------------------------------------------------

  /** True if a 2x2 of `cells` would fit at (row, col) against the settled grid. */
  private fits(row: number, col: number): boolean {
    for (let dr = 0; dr < 2; dr++) {
      for (let dc = 0; dc < 2; dc++) {
        const r = row + dr;
        const c = col + dc;
        if (!inBounds(r, c)) return false;
        if (this.grid[r]![c] !== null) return false;
      }
    }
    return true;
  }

  private canMoveDown(): boolean {
    if (!this.piece) return false;
    return this.fits(this.piece.row + 1, this.piece.col);
  }

  // ---- spawning & locking ----------------------------------------------

  private spawnFromRng(): void {
    this.placePiece(this.rng.nextPiece());
  }

  /**
   * Place `piece` at the pinned top-centre spawn. If a piece is mid-fall it is
   * locked first. If the spawn cells are already occupied, the game is over.
   */
  placePiece(piece: Piece): void {
    if (this.piece) this.lockPiece();
    if (this.phase !== "playing") return;
    if (!this.fits(SPAWN_ROW, SPAWN_COL)) {
      this.piece = null;
      this.setPhase("gameover");
      this.emit("gameover");
      this.emit("change");
      return;
    }
    this.piece = { cells: piece, col: SPAWN_COL, row: SPAWN_ROW };
    this.emit("spawn");
    this.emit("change");
  }

  /** Settle the active piece into the stack and collapse via gravity. */
  private lockPiece(): void {
    const p = this.piece;
    if (!p) return;
    const locked: CellCoord[] = [];
    for (let dr = 0; dr < 2; dr++) {
      for (let dc = 0; dc < 2; dc++) {
        const r = p.row + dr;
        const c = p.col + dc;
        if (inBounds(r, c)) {
          this.grid[r]![c] = p.cells[dr]![dc]!;
          locked.push({ row: r, col: c });
        }
      }
    }
    this.piece = null;
    applyGravity(this.grid);
    this.emit("lock", locked);
    this.emit("change");
  }

  // ---- controls ---------------------------------------------------------

  moveLeft(): void {
    const p = this.piece;
    if (!p || this.phase !== "playing") return;
    if (this.fits(p.row, p.col - 1)) {
      p.col -= 1;
      this.emit("change");
    }
  }

  moveRight(): void {
    const p = this.piece;
    if (!p || this.phase !== "playing") return;
    if (this.fits(p.row, p.col + 1)) {
      p.col += 1;
      this.emit("change");
    }
  }

  /** Rotate the 2x2 clockwise in place (skips if it would not fit). */
  rotate(): void {
    const p = this.piece;
    if (!p || this.phase !== "playing") return;
    const [[a, b], [c, d]] = p.cells;
    const rotated: Piece = [
      [c, a],
      [d, b],
    ];
    p.cells = rotated;
    this.emit("change");
  }

  /** Soft drop: nudge down one row if possible. */
  softDrop(): boolean {
    const p = this.piece;
    if (!p || this.phase !== "playing") return false;
    if (this.canMoveDown()) {
      p.row += 1;
      this.emit("change");
      return true;
    }
    return false;
  }

  /** Hard drop: fall to rest and lock immediately. Returns true if it locked. */
  hardDrop(): boolean {
    const p = this.piece;
    if (!p || this.phase !== "playing") return false;
    while (this.canMoveDown()) p.row += 1;
    this.lockPiece();
    return true;
  }

  /**
   * Advance one gravity step. Moves the piece down, or locks it if it cannot
   * fall. NEVER auto-spawns — callers decide whether to spawn the next piece.
   */
  tick(): void {
    if (this.phase !== "playing" || !this.piece) return;
    if (this.canMoveDown()) {
      this.piece.row += 1;
      this.emit("change");
    } else {
      this.lockPiece();
    }
  }

  /** Production helper: gravity step, then auto-spawn the next piece if idle. */
  tickWithAutoSpawn(): void {
    if (this.phase !== "playing") return;
    if (this.piece) {
      this.tick();
    }
    if (!this.piece && this.phase === "playing") {
      this.spawnFromRng();
    }
  }

  /** Production helper used after a hard drop to keep the board fed. */
  spawnNextIfIdle(): void {
    if (this.phase === "playing" && !this.piece) this.spawnFromRng();
  }

  // ---- sweep ------------------------------------------------------------

  private resetSweep(): void {
    this.sweep = {
      x: 0,
      marked: null,
      distinctSquares: 0,
      deleted: 0,
      lastCol: -1,
    };
  }

  private ensureSnapshot(): void {
    if (this.sweep.marked === null) {
      this.sweep.marked = markedMask(this.grid);
      this.sweep.distinctSquares = squareTopLefts(this.grid).length;
      this.sweep.deleted = 0;
      this.sweep.lastCol = -1;
    }
  }

  /** Advance the sweep by `dtMs`, deleting/scoring as columns are passed. */
  sweepProgress(dtMs: number): void {
    this.advanceSweepCols(dtMs * SWEEP_COLS_PER_MS);
  }

  /** Run exactly one full, clean traversal immediately and apply scoring. */
  sweepNow(): void {
    this.resetSweep();
    this.advanceSweepCols(COLS);
  }

  private advanceSweepCols(dtCols: number): void {
    if (this.phase !== "playing" || dtCols <= 0) return;
    let remaining = dtCols;
    const cleared: CellCoord[] = [];

    while (remaining > EPS) {
      this.ensureSnapshot();
      const distToEnd = COLS - this.sweep.x;
      const step = Math.min(remaining, distToEnd);
      this.sweep.x += step;
      remaining -= step;

      // Delete marked cells in every column the bar has now fully passed.
      while (
        this.sweep.lastCol < COLS - 1 &&
        this.sweep.x >= this.sweep.lastCol + 2 - EPS
      ) {
        const c = this.sweep.lastCol + 1;
        for (let r = 0; r < ROWS; r++) {
          if (this.sweep.marked![r]![c] && this.grid[r]![c] !== null) {
            this.grid[r]![c] = null;
            this.sweep.deleted += 1;
            cleared.push({ row: r, col: c });
          }
        }
        this.sweep.lastCol = c;
      }

      // End of a full traversal: collapse, score, then start the next pass.
      if (this.sweep.x >= COLS - EPS) {
        applyGravity(this.grid);
        this.score += this.sweep.deleted * this.sweep.distinctSquares;
        this.sweep.x = 0;
        this.sweep.marked = null;
        this.sweep.lastCol = -1;
        this.sweep.deleted = 0;
      }
    }

    if (cleared.length) this.emit("clear", cleared);
    this.emit("change");
  }

  get sweepX(): number {
    return this.sweep.x;
  }

  // ---- views ------------------------------------------------------------

  /** Settled grid with the active falling piece overlaid (a copy). */
  mergedGrid(): Grid {
    const g = cloneGrid(this.grid);
    const p = this.piece;
    if (p) {
      for (let dr = 0; dr < 2; dr++) {
        for (let dc = 0; dc < 2; dc++) {
          const r = p.row + dr;
          const c = p.col + dc;
          if (inBounds(r, c)) g[r]![c] = p.cells[dr]![dc]!;
        }
      }
    }
    return g;
  }

  state(): PublicState {
    return {
      grid: this.mergedGrid(),
      score: this.score,
      gameOver: this.phase === "gameover",
      sweepX: this.sweep.x,
    };
  }

  marked(): CellCoord[] {
    return markedCells(this.mergedGrid());
  }
}
