import { Application, Container, Graphics } from "pixi.js";
import { COLS, ROWS } from "../constants";
import type { Color, Grid, MarkedCell } from "../types";
import {
  APPEAR_MS,
  BEAT_MS,
  BOARD_BG,
  CELL,
  CLEAR_MS,
  FLASH,
  GAP,
  GRID_LINE,
  MARK_RING,
  SETTLE_K,
  SWEEP,
  SWEEP_CORE,
  cellFill,
  cellHi,
} from "./theme";

export interface RenderInput {
  grid: Grid; // settled + active merged
  marked: MarkedCell[];
  sweepX: number; // 0..COLS
  timeMs: number; // monotonic, for pulsing/animation phase
}

/** Per-position visual state, so cells can appear/move/clear smoothly. */
interface VisualCell {
  color: Color;
  col: number; // grid column (x is column-locked)
  targetY: number; // px (top-left, includes GAP)
  curY: number; // px, eased toward targetY
  appear: number; // 0..1 spawn progress
  clearing: boolean; // true once the cell has left the grid
  clear: number; // 0..1 clear progress (only while clearing)
}

const key = (row: number, col: number): string => `${row},${col}`;
const cellY = (row: number): number => row * CELL + GAP;
const cellX = (col: number): number => col * CELL + GAP;
const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export class Renderer {
  readonly app: Application;
  private board = new Container();
  private cells = new Container();
  private overlay = new Container();
  private sweep = new Graphics();

  private visuals = new Map<string, VisualCell>();
  private lastTime = -1; // for deriving dt from successive timeMs

  static async create(parent: HTMLElement): Promise<Renderer> {
    const app = new Application();
    await app.init({
      width: COLS * CELL,
      height: ROWS * CELL,
      background: BOARD_BG,
      antialias: true,
      resolution: Math.min(2, window.devicePixelRatio || 1),
      autoDensity: true,
    });
    parent.appendChild(app.canvas);
    return new Renderer(app);
  }

  private constructor(app: Application) {
    this.app = app;
    this.app.stage.addChild(this.board, this.cells, this.overlay, this.sweep);
    this.drawGridLines();
  }

  private drawGridLines(): void {
    const g = new Graphics();
    for (let c = 0; c <= COLS; c++)
      g.moveTo(c * CELL, 0).lineTo(c * CELL, ROWS * CELL);
    for (let r = 0; r <= ROWS; r++)
      g.moveTo(0, r * CELL).lineTo(COLS * CELL, r * CELL);
    g.stroke({ color: GRID_LINE, width: 1, alpha: 0.6 });
    this.board.addChild(g);
  }

  draw(input: RenderInput): void {
    // Derive a robust frame delta from the monotonic clock. Guard the first
    // frame (no prior sample) and any pathological gaps (tab restore, etc.).
    let dt = this.lastTime < 0 ? 16 : input.timeMs - this.lastTime;
    if (!Number.isFinite(dt) || dt < 0) dt = 16;
    if (dt > 100) dt = 100;
    this.lastTime = input.timeMs;

    this.syncVisuals(input.grid, dt);
    this.drawCells();
    this.drawMarks(input);
    this.drawSweep(input);
  }

  /**
   * Reconcile the tracked per-position visuals against the latest grid:
   *  - new occupied positions fade + scale in,
   *  - surviving positions ease toward their target y,
   *  - vanished positions flash white and scale out (then are dropped).
   * When a cell vanishes and a same-colour cell appears lower in the same
   * column (gravity / post-sweep collapse), we hand the old cell's current y
   * to the new one so it visibly slides down instead of snapping.
   */
  private syncVisuals(grid: Grid, dt: number): void {
    const present = new Set<string>();
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (grid[r]![c] != null) present.add(key(r, c));
      }
    }

    // Tracked (non-clearing) positions that are now empty have "left". Stage
    // them by column so we can match falls to new appearances below.
    const departedByCol = new Map<number, { row: number; v: VisualCell }[]>();
    for (const [k, v] of this.visuals) {
      if (v.clearing) continue;
      if (!present.has(k)) {
        const row = Number(k.slice(0, k.indexOf(",")));
        const list = departedByCol.get(v.col) ?? [];
        list.push({ row, v });
        departedByCol.set(v.col, list);
        // Remove from the live map; we'll either re-home it as a fall or
        // re-insert it under its old key as a clearing cell.
        this.visuals.delete(k);
      }
    }

    // Survivors + appearances. A new position inherits motion from a departed
    // same-colour cell higher up in the same column (a fall) so it slides.
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const color = grid[r]![c];
        if (color == null) continue;
        const k = key(r, c);
        const targetY = cellY(r);
        const existing = this.visuals.get(k);
        if (existing && !existing.clearing) {
          existing.color = color;
          existing.targetY = targetY;
          existing.appear = clamp01(existing.appear + dt / APPEAR_MS);
          continue;
        }
        const candidates = departedByCol.get(c);
        let startY = targetY;
        let appear = 0;
        if (candidates && candidates.length > 0) {
          // Nearest departed same-colour cell above this row.
          let bestIdx = -1;
          for (let i = 0; i < candidates.length; i++) {
            const cand = candidates[i]!;
            if (
              cand.v.color === color &&
              cand.row < r &&
              (bestIdx === -1 || cand.row > candidates[bestIdx]!.row)
            ) {
              bestIdx = i;
            }
          }
          if (bestIdx !== -1) {
            const src = candidates.splice(bestIdx, 1)[0]!;
            startY = src.v.curY;
            appear = 1; // already on-screen — it's a move, not a spawn
          }
        }
        this.visuals.set(k, {
          color,
          col: c,
          targetY,
          curY: startY,
          appear,
          clearing: false,
          clear: 0,
        });
      }
    }

    // Departed cells not consumed by a fall are genuine clears — animate out.
    for (const list of departedByCol.values()) {
      for (const { row, v } of list) {
        v.clearing = true;
        v.clear = 0;
        v.targetY = cellY(row);
        // Re-insert under a unique clearing key so it can't collide with a
        // live cell that may re-occupy this slot next frame.
        this.visuals.set(`clear:${row},${v.col}:${v.curY.toFixed(2)}`, v);
      }
    }

    // Advance easing + clear timers; drop finished clears.
    for (const [k, v] of this.visuals) {
      v.curY = lerp(v.curY, v.targetY, Math.min(1, dt * SETTLE_K));
      if (Math.abs(v.curY - v.targetY) < 0.15) v.curY = v.targetY;
      if (v.clearing) {
        v.clear = clamp01(v.clear + dt / CLEAR_MS);
        if (v.clear >= 1) this.visuals.delete(k);
      }
    }
  }

  private drawCells(): void {
    this.cells.removeChildren();
    const w = CELL - GAP * 2;
    for (const v of this.visuals.values()) {
      let scale = 1;
      let alpha = 1;
      let flash = 0;

      if (v.clearing) {
        // White flash then scale-to-zero / fade.
        const t = v.clear;
        scale = 1 - t * 0.85;
        alpha = 1 - t;
        flash = Math.sin(Math.min(1, t * 2) * Math.PI * 0.5); // quick rise
      } else if (v.appear < 1) {
        // Quick fade + scale-in (ease-out, no overshoot).
        const t = clamp01(v.appear);
        const e = 1 - (1 - t) * (1 - t);
        scale = 0.6 + e * 0.4;
        alpha = e;
      }

      if (scale <= 0 || alpha <= 0) continue;

      // Centre-anchored scaling within the cell box.
      const cw = w * scale;
      const offset = (w - cw) / 2;
      const x = cellX(v.col) + offset;
      const y = v.curY + offset;

      const tile = new Graphics();
      tile.roundRect(x, y, cw, cw, 6).fill({ color: cellFill(v.color), alpha });
      // Bevel highlight.
      tile
        .roundRect(
          x + 2 * scale,
          y + 2 * scale,
          cw - 4 * scale,
          (cw - 4 * scale) * 0.45,
          5,
        )
        .fill({ color: cellHi(v.color), alpha: 0.35 * alpha });
      // Clear flash overlay.
      if (flash > 0) {
        tile
          .roundRect(x, y, cw, cw, 6)
          .fill({ color: FLASH, alpha: 0.85 * flash });
      }
      this.cells.addChild(tile);
    }
  }

  private drawMarks(input: RenderInput): void {
    this.overlay.removeChildren();
    // Breathe on the beat (one beat = 500ms).
    const beatPhase = (input.timeMs % BEAT_MS) / BEAT_MS;
    const pulse = 0.5 + 0.5 * Math.sin(beatPhase * Math.PI * 2);
    const w = CELL - GAP * 2;
    for (const { row, col } of input.marked) {
      const x = cellX(col);
      const y = cellY(row);
      const ring = new Graphics();
      // Inset brighter "charged" core — reads as ready-to-clear.
      const inset = 4 + 2 * pulse;
      ring
        .roundRect(x + inset, y + inset, w - inset * 2, w - inset * 2, 4)
        .fill({ color: MARK_RING, alpha: 0.1 + 0.18 * pulse });
      // Breathing outer ring.
      ring
        .roundRect(x, y, w, w, 6)
        .stroke({ color: MARK_RING, width: 2, alpha: 0.4 + 0.5 * pulse });
      this.overlay.addChild(ring);
    }
  }

  private drawSweep(input: RenderInput): void {
    const x = input.sweepX * CELL;
    const h = ROWS * CELL;
    // Beat-synced intensity pulse (one beat = 500ms).
    const beatPhase = (input.timeMs % BEAT_MS) / BEAT_MS;
    const pulse = 0.7 + 0.3 * (0.5 + 0.5 * Math.sin(beatPhase * Math.PI * 2));

    this.sweep.clear();
    // Soft trailing glow, layered to fake a gradient falloff behind the edge.
    this.sweep
      .rect(x - 28, 0, 28, h)
      .fill({ color: SWEEP, alpha: 0.06 * pulse })
      .rect(x - 16, 0, 16, h)
      .fill({ color: SWEEP, alpha: 0.1 * pulse })
      .rect(x - 7, 0, 7, h)
      .fill({ color: SWEEP, alpha: 0.18 * pulse });
    // Bright leading edge with a white-hot core.
    this.sweep
      .rect(x - 2, 0, 3, h)
      .fill({ color: SWEEP, alpha: 0.95 * pulse })
      .rect(x - 1, 0, 1.5, h)
      .fill({ color: SWEEP_CORE, alpha: 0.9 * pulse });
    // Faint bright "wake" just behind the bar.
    this.sweep.rect(x - 4, 0, 2, h).fill({ color: SWEEP_CORE, alpha: 0.12 * pulse });
  }

  destroy(): void {
    this.app.destroy(true, { children: true });
  }
}
