import { Application, Container, Graphics } from "pixi.js";
import { COLS, ROWS } from "../constants";
import type { Grid, MarkedCell } from "../types";
import {
  BOARD_BG,
  CELL,
  GAP,
  GRID_LINE,
  MARK_RING,
  SWEEP,
  cellFill,
  cellHi,
} from "./theme";

export interface RenderInput {
  grid: Grid; // settled + active merged
  marked: MarkedCell[];
  sweepX: number; // 0..COLS
  timeMs: number; // monotonic, for pulsing/animation phase
}

export class Renderer {
  readonly app: Application;
  private board = new Container();
  private cells = new Container();
  private overlay = new Container();
  private sweep = new Graphics();

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
    this.drawCells(input);
    this.drawMarks(input);
    this.drawSweep(input);
  }

  private drawCells(input: RenderInput): void {
    this.cells.removeChildren();
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const v = input.grid[r]![c];
        if (v == null) continue;
        const x = c * CELL + GAP;
        const y = r * CELL + GAP;
        const w = CELL - GAP * 2;
        const tile = new Graphics();
        tile
          .roundRect(x, y, w, w, 6)
          .fill(cellFill(v))
          .roundRect(x + 2, y + 2, w - 4, (w - 4) * 0.45, 5)
          .fill({ color: cellHi(v), alpha: 0.35 }); // bevel highlight
        this.cells.addChild(tile);
      }
    }
  }

  private drawMarks(input: RenderInput): void {
    this.overlay.removeChildren();
    const pulse = 0.5 + 0.5 * Math.sin(input.timeMs / 140);
    for (const { row, col } of input.marked) {
      const x = col * CELL + GAP;
      const y = row * CELL + GAP;
      const w = CELL - GAP * 2;
      const ring = new Graphics();
      ring
        .roundRect(x, y, w, w, 6)
        .stroke({ color: MARK_RING, width: 2, alpha: 0.4 + 0.5 * pulse });
      this.overlay.addChild(ring);
    }
  }

  private drawSweep(input: RenderInput): void {
    const x = input.sweepX * CELL;
    this.sweep.clear();
    this.sweep
      .rect(x - 14, 0, 14, ROWS * CELL)
      .fill({ color: SWEEP, alpha: 0.12 }) // trailing glow
      .rect(x - 2, 0, 3, ROWS * CELL)
      .fill({ color: SWEEP, alpha: 0.95 }); // bright leading edge
  }

  destroy(): void {
    this.app.destroy(true, { children: true });
  }
}
