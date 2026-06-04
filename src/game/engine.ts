import {
  applyGravity,
  createGrid,
  footprintValid,
  mergeActive,
  stampPiece,
} from "./board";
import { COLS, MS_PER_COL, ROWS, SPAWN_COL, SPAWN_ROW } from "./constants";
import { canFall, rotateCW } from "./piece";
import { nextPiece } from "./rng";
import { computeMarkedGrid, countSquares, markedList } from "./squares";
import type { GameState, Grid, MarkedCell, Piece } from "./types";

const DEFAULT_SEED = 1;

export class LuminesEngine {
  private s: GameState;

  constructor(seed: number = DEFAULT_SEED) {
    this.s = this.fresh(seed);
  }

  private fresh(seed: number): GameState {
    return {
      settled: createGrid(),
      active: null,
      score: 0,
      gameOver: false,
      sweepX: 0,
      rngState: seed | 0,
      sweepMarked: null,
      sweepSquares: 0,
      sweepNextCol: 0,
    };
  }

  reset(seed: number = DEFAULT_SEED): void {
    this.s = this.fresh(seed);
  }

  seed(n: number): void {
    this.s.rngState = n | 0;
  }

  state(): { grid: Grid; score: number; gameOver: boolean; sweepX: number } {
    return {
      grid: mergeActive(this.s.settled, this.s.active),
      score: this.s.score,
      gameOver: this.s.gameOver,
      sweepX: this.s.sweepX,
    };
  }

  /** Internal state, used by the driver/renderer (not part of the public test API). */
  stateRef(): GameState {
    return this.s;
  }

  marked(): MarkedCell[] {
    return markedList(this.s.settled);
  }

  countDistinctSquares(): number {
    return countSquares(this.s.settled);
  }

  hasActive(): boolean {
    return this.s.active !== null;
  }

  moveLeft(): void {
    const a = this.s.active;
    if (a && footprintValid(this.s.settled, a.row, a.col - 1)) a.col--;
  }

  moveRight(): void {
    const a = this.s.active;
    if (a && footprintValid(this.s.settled, a.row, a.col + 1)) a.col++;
  }

  rotate(): void {
    if (this.s.active) this.s.active.cells = rotateCW(this.s.active.cells);
  }

  private stepDown(): void {
    const a = this.s.active;
    if (!a) return;
    if (canFall(this.s.settled, a)) a.row++;
    else this.lock();
  }

  /** Gravity step. Never auto-spawns. */
  tick(): void {
    this.stepDown();
  }

  softDrop(): void {
    this.stepDown();
  }

  hardDrop(): void {
    const a = this.s.active;
    if (!a) return;
    while (canFall(this.s.settled, a)) a.row++;
    this.lock();
  }

  private lock(): void {
    const a = this.s.active;
    if (!a) return;
    stampPiece(this.s.settled, a);
    this.s.active = null;
    applyGravity(this.s.settled); // decompose / settle
  }

  /** Lock any falling piece, then place a new one at the spawn position. */
  spawnPiece(piece?: Piece): void {
    if (this.s.gameOver) return;
    if (this.s.active) this.lock();

    let cells = piece;
    if (!cells) {
      const [p, ns] = nextPiece(this.s.rngState);
      cells = p;
      this.s.rngState = ns;
    }

    if (!footprintValid(this.s.settled, SPAWN_ROW, SPAWN_COL)) {
      this.s.gameOver = true;
      this.s.active = null;
      return;
    }
    this.s.active = { cells, row: SPAWN_ROW, col: SPAWN_COL };
  }

  private captureSweep(): void {
    this.s.sweepMarked = computeMarkedGrid(this.s.settled);
    this.s.sweepSquares = countSquares(this.s.settled);
    this.s.sweepNextCol = 0;
  }

  private processColumn(c: number): void {
    const m = this.s.sweepMarked;
    if (!m) return;
    let deleted = 0;
    for (let r = 0; r < ROWS; r++) {
      if (m[r]![c] && this.s.settled[r]![c] !== null) {
        this.s.settled[r]![c] = null;
        deleted++;
      }
    }
    this.s.score += deleted * this.s.sweepSquares;
  }

  /** Run one full sweep immediately and apply scoring (atomic). */
  sweepNow(): void {
    this.captureSweep();
    for (let c = 0; c < COLS; c++) this.processColumn(c);
    applyGravity(this.s.settled);
    // Drop the active piece to its natural resting row so that state().grid
    // contains no holes between the piece and the settled stack beneath it.
    if (this.s.active) {
      while (canFall(this.s.settled, this.s.active)) this.s.active.row++;
    }
    this.s.sweepX = 0;
    this.s.sweepMarked = null;
    this.s.sweepSquares = 0;
    this.s.sweepNextCol = 0;
  }

  /** Advance the sweep deterministically by dtMs. */
  sweepProgress(dtMs: number): void {
    if (this.s.sweepMarked === null) this.captureSweep();
    this.s.sweepX += dtMs / MS_PER_COL;

    const limit = Math.min(Math.floor(this.s.sweepX), COLS);
    while (this.s.sweepNextCol < limit) {
      this.processColumn(this.s.sweepNextCol);
      this.s.sweepNextCol++;
    }

    if (this.s.sweepX >= COLS) {
      applyGravity(this.s.settled);
      this.s.sweepX -= COLS;
      if (this.s.sweepX < 0) this.s.sweepX = 0;
      this.captureSweep(); // begin next pass
    }
  }
}
