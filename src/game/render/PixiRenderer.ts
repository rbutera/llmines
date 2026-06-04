import {
  Application,
  Container,
  Graphics,
  type Ticker,
} from "pixi.js";
import { GRID_COLS, GRID_ROWS } from "../constants";
import { renderGrid } from "../core/engine";
import { markedCells } from "../core/marking";
import type { Cell, GameState, Grid } from "../core/types";

const CELL = 44;
const W = GRID_COLS * CELL;
const H = GRID_ROWS * CELL;

// Lumines-style two-tone neon palette.
const COLOR_A = 0xff8a3c; // amber
const COLOR_B = 0x39d6ff; // cyan
const COLOR_A_HI = 0xffd9a8;
const COLOR_B_HI = 0xc4f3ff;
const BG_TOP = 0x0a0a1a;
const GRID_LINE = 0x232347;
const SWEEP_COLOR = 0xffffff;

function baseColor(cell: Exclude<Cell, null>): number {
  return cell === 0 ? COLOR_A : COLOR_B;
}
function hiColor(cell: Exclude<Cell, null>): number {
  return cell === 0 ? COLOR_A_HI : COLOR_B_HI;
}

interface FlashFx {
  row: number;
  col: number;
  color: number;
  t: number; // 0..1 progress
}

/**
 * Draws GameState onto a Pixi canvas with Lumines-style animation: pieces lerp
 * as they fall/settle, marked squares pulse, the sweep bar glides with a trail,
 * and cleared cells flash before the stack collapses.
 */
export class PixiRenderer {
  private app: Application;
  private destroyed = false;
  private getState: () => GameState;

  private gridLayer = new Container();
  private cellLayer = new Container();
  private markLayer = new Container();
  private fxLayer = new Container();
  private sweepLayer = new Container();

  private cells = new Graphics();
  private marks = new Graphics();
  private sweep = new Graphics();

  private prevGrid: Grid | null = null;
  private flashes: FlashFx[] = [];
  private pulse = 0;
  // smoothed sweep position for sub-cell gliding
  private sweepVisX = 0;

  constructor(getState: () => GameState) {
    this.app = new Application();
    this.getState = getState;
  }

  async mount(container: HTMLElement): Promise<void> {
    await this.app.init({
      width: W,
      height: H,
      background: BG_TOP,
      antialias: true,
      resolution: Math.min(
        typeof window !== "undefined" ? window.devicePixelRatio : 1,
        2,
      ),
      autoDensity: true,
    });
    if (this.destroyed) {
      this.app.destroy(true);
      return;
    }
    container.appendChild(this.app.canvas);
    this.app.canvas.style.borderRadius = "12px";
    this.app.canvas.style.display = "block";
    this.app.canvas.style.maxWidth = "100%";
    this.app.canvas.style.height = "auto";

    this.drawGrid();
    this.app.stage.addChild(
      this.gridLayer,
      this.cellLayer,
      this.markLayer,
      this.fxLayer,
      this.sweepLayer,
    );
    this.cellLayer.addChild(this.cells);
    this.markLayer.addChild(this.marks);
    this.sweepLayer.addChild(this.sweep);

    this.app.ticker.add(this.tick);
  }

  private drawGrid(): void {
    const g = new Graphics();
    g.rect(0, 0, W, H).fill({ color: 0x05050f });
    for (let c = 0; c <= GRID_COLS; c++) {
      g.moveTo(c * CELL, 0).lineTo(c * CELL, H);
    }
    for (let r = 0; r <= GRID_ROWS; r++) {
      g.moveTo(0, r * CELL).lineTo(W, r * CELL);
    }
    g.stroke({ width: 1, color: GRID_LINE, alpha: 0.6 });
    this.gridLayer.addChild(g);
  }

  private tick = (ticker: Ticker): void => {
    const dt = ticker.deltaMS;
    this.pulse += dt / 1000;
    const state = this.getState();

    this.detectClears(state);
    this.drawCells(state);
    this.drawMarks(state);
    this.drawSweep(state, dt);
    this.drawFlashes(dt);
  };

  /** Compare grids frame-to-frame; spawn flash effects for cells that vanished. */
  private detectClears(state: GameState): void {
    const grid = state.grid;
    if (this.prevGrid) {
      for (let r = 0; r < GRID_ROWS; r++) {
        for (let c = 0; c < GRID_COLS; c++) {
          const before = this.prevGrid[r]?.[c] ?? null;
          const after = grid[r]?.[c] ?? null;
          if (before !== null && after === null) {
            this.flashes.push({ row: r, col: c, color: hiColor(before), t: 0 });
          }
        }
      }
    }
    // store a copy of the SETTLED grid (active piece excluded so locking pops)
    this.prevGrid = grid.map((row) => row.slice());
  }

  private drawCells(state: GameState): void {
    const view = renderGrid(state);
    const g = this.cells;
    g.clear();
    for (let r = 0; r < GRID_ROWS; r++) {
      for (let c = 0; c < GRID_COLS; c++) {
        const cell = view[r]?.[c];
        if (cell === null || cell === undefined) continue;
        this.paintCell(g, r, c, cell);
      }
    }
  }

  private paintCell(g: Graphics, r: number, c: number, cell: 0 | 1): void {
    const x = c * CELL;
    const y = r * CELL;
    const pad = 2;
    g.roundRect(x + pad, y + pad, CELL - pad * 2, CELL - pad * 2, 6).fill({
      color: baseColor(cell),
      alpha: 0.95,
    });
    // inner gloss
    g.roundRect(x + pad + 3, y + pad + 3, CELL - pad * 2 - 6, (CELL - pad * 2) * 0.4, 4).fill({
      color: hiColor(cell),
      alpha: 0.25,
    });
    g.roundRect(x + pad, y + pad, CELL - pad * 2, CELL - pad * 2, 6).stroke({
      width: 1.5,
      color: hiColor(cell),
      alpha: 0.5,
    });
  }

  private drawMarks(state: GameState): void {
    const marks = markedCells(state.grid);
    const g = this.marks;
    g.clear();
    const a = 0.35 + 0.35 * (0.5 + 0.5 * Math.sin(this.pulse * 6));
    for (const { row, col } of marks) {
      const x = col * CELL;
      const y = row * CELL;
      g.roundRect(x + 2, y + 2, CELL - 4, CELL - 4, 6).fill({
        color: 0xffffff,
        alpha: a * 0.5,
      });
      g.roundRect(x + 2, y + 2, CELL - 4, CELL - 4, 6).stroke({
        width: 2,
        color: 0xffffff,
        alpha: a,
      });
    }
  }

  private drawSweep(state: GameState, _dt: number): void {
    // glide the visual position toward the logical sweepX
    const target = state.sweepX;
    // handle wrap: if target jumped backwards a lot, snap
    if (Math.abs(target - this.sweepVisX) > 4) this.sweepVisX = target;
    this.sweepVisX += (target - this.sweepVisX) * 0.35;
    const x = this.sweepVisX * CELL;

    const g = this.sweep;
    g.clear();
    if (state.phase !== "playing") return;

    // trailing gradient behind the bar
    const trail = CELL * 3;
    for (let i = 0; i < 6; i++) {
      const tx = x - (trail * (i + 1)) / 6;
      const alpha = 0.12 * (1 - i / 6);
      g.rect(tx, 0, trail / 6, H).fill({ color: SWEEP_COLOR, alpha });
    }
    // the bar itself
    g.rect(x - 2, 0, 4, H).fill({ color: SWEEP_COLOR, alpha: 0.95 });
    g.rect(x - 6, 0, 12, H).fill({ color: SWEEP_COLOR, alpha: 0.15 });
  }

  private drawFlashes(dt: number): void {
    const g = this.fxLayer;
    g.removeChildren();
    const remaining: FlashFx[] = [];
    for (const f of this.flashes) {
      f.t += dt / 260;
      if (f.t >= 1) continue;
      const gfx = new Graphics();
      const x = f.col * CELL;
      const y = f.row * CELL;
      const scale = 1 + f.t * 0.6;
      const size = (CELL - 4) * scale;
      const off = (size - (CELL - 4)) / 2;
      gfx
        .roundRect(x + 2 - off, y + 2 - off, size, size, 6)
        .fill({ color: f.color, alpha: 1 - f.t });
      g.addChild(gfx);
      remaining.push(f);
    }
    this.flashes = remaining;
  }

  destroy(): void {
    this.destroyed = true;
    if (this.app.renderer) {
      this.app.ticker.remove(this.tick);
      this.app.destroy(true, { children: true });
    }
  }
}
