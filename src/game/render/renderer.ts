import { Application, Container, Graphics } from "pixi.js";
import { COLS, ROWS, type Cell, type Grid } from "../core";
import type { GameController, RenderState } from "../engine/controller";

const CELL = 40;
const BOARD_W = COLS * CELL; // 640
const BOARD_H = ROWS * CELL; // 400

const BG = 0x0b0e1a;
const GRID_LINE = 0x1b2138;
const COLOR_A = 0x37e0c9; // cyan
const COLOR_A_HI = 0x9bf6e8;
const COLOR_B = 0xff5fb0; // magenta
const COLOR_B_HI = 0xffc1e3;
const SWEEP = 0xfff2a8;

function colorOf(c: Cell): { base: number; hi: number } {
  return c === 0
    ? { base: COLOR_A, hi: COLOR_A_HI }
    : { base: COLOR_B, hi: COLOR_B_HI };
}

interface Flash {
  x: number;
  y: number;
  color: number;
  life: number; // 0..1, 1 = fresh
}

/** Per-column occupied rows, bottom-to-top, with colours. */
function columnStack(grid: Grid, col: number): { row: number; cell: Cell }[] {
  const out: { row: number; cell: Cell }[] = [];
  for (let row = ROWS - 1; row >= 0; row--) {
    const c = grid[row]![col] ?? null;
    if (c !== null) out.push({ row, cell: c });
  }
  return out;
}

/**
 * Immediate-mode Pixi renderer. Redraws each frame from the latest RenderState
 * plus a small animation model:
 *  - active piece descends smoothly via fallProgress
 *  - settled cells animate a collapse (per-column identity match) after clears
 *  - marked cells pulse; the sweep bar glides with a glow + trail
 *  - cleared cells emit a brief flash as the bar passes
 */
export class PixiRenderer {
  private app: Application | null = null;
  private cellG = new Graphics();
  private pieceG = new Graphics();
  private markG = new Graphics();
  private sweepG = new Graphics();
  private fxG = new Graphics();

  private last: RenderState | null = null;
  private prevGrid: Grid | null = null;
  private prevMarked = new Set<number>();
  private fallOffsets = new Map<number, number>(); // key row*COLS+col -> px offset
  private flashes: Flash[] = [];
  private clock = 0;
  private unsub: (() => void) | null = null;
  private destroyed = false;

  async init(parent: HTMLElement): Promise<void> {
    const app = new Application();
    await app.init({
      width: BOARD_W,
      height: BOARD_H,
      background: BG,
      antialias: true,
      autoDensity: true,
      resolution: Math.min(
        2,
        typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1,
      ),
    });
    // Guard against StrictMode double-invoke / unmount during async init.
    if (this.destroyed) {
      app.destroy(true);
      return;
    }
    this.app = app;
    parent.appendChild(app.canvas);
    app.canvas.style.display = "block";
    app.canvas.style.width = "100%";
    app.canvas.style.height = "auto";
    app.canvas.style.maxWidth = `${BOARD_W}px`;
    app.canvas.setAttribute("aria-hidden", "true");

    const stage = new Container();
    stage.addChild(this.buildGrid());
    stage.addChild(this.cellG, this.markG, this.pieceG, this.fxG, this.sweepG);
    app.stage.addChild(stage);

    app.ticker.add((t) => this.frame(t.deltaMS));
  }

  attach(controller: GameController): void {
    this.unsub = controller.subscribe((rs) => this.onState(rs));
  }

  destroy(): void {
    this.destroyed = true;
    this.unsub?.();
    this.unsub = null;
    if (this.app) {
      this.app.destroy(true, { children: true });
      this.app = null;
    }
  }

  // ---- state intake --------------------------------------------------------

  private onState(rs: RenderState): void {
    const markedSet = new Set(rs.marked.map((m) => m.row * COLS + m.col));

    if (this.prevGrid) {
      this.seedCollapse(this.prevGrid, rs.grid);
      this.seedClearFlashes(this.prevGrid, rs.grid);
    }
    this.prevGrid = rs.grid.map((r) => r.slice());
    this.prevMarked = markedSet;
    this.last = rs;
  }

  /** Match each column's new stack to its old stack to animate fallen cells. */
  private seedCollapse(oldGrid: Grid, newGrid: Grid): void {
    for (let col = 0; col < COLS; col++) {
      const oldStack = columnStack(oldGrid, col);
      const newStack = columnStack(newGrid, col);
      const n = Math.min(oldStack.length, newStack.length);
      for (let i = 0; i < n; i++) {
        const oldRow = oldStack[i]!.row;
        const newRow = newStack[i]!.row;
        if (newRow > oldRow) {
          // fell downward: start visually at old position, ease to new
          const key = newRow * COLS + col;
          this.fallOffsets.set(key, (oldRow - newRow) * CELL);
        }
      }
    }
  }

  /** Emit a flash wherever a previously-marked cell just disappeared. */
  private seedClearFlashes(oldGrid: Grid, newGrid: Grid): void {
    for (const idx of this.prevMarked) {
      const row = Math.floor(idx / COLS);
      const col = idx % COLS;
      const was = oldGrid[row]![col] ?? null;
      if (was !== null && (newGrid[row]![col] ?? null) === null) {
        this.flashes.push({
          x: col * CELL,
          y: row * CELL,
          color: colorOf(was).hi,
          life: 1,
        });
      }
    }
  }

  // ---- per-frame draw ------------------------------------------------------

  private frame(dtMs: number): void {
    if (!this.app || !this.last) return;
    this.clock += dtMs;

    // ease fall offsets toward 0
    const ease = Math.min(1, dtMs / 90);
    for (const [key, off] of this.fallOffsets) {
      const next = off * (1 - ease);
      if (Math.abs(next) < 0.5) this.fallOffsets.delete(key);
      else this.fallOffsets.set(key, next);
    }
    // age flashes
    this.flashes = this.flashes.filter((f) => {
      f.life -= dtMs / 260;
      return f.life > 0;
    });

    this.drawCells(this.last);
    this.drawMarked(this.last);
    this.drawPiece(this.last);
    this.drawFlashes();
    this.drawSweep(this.last);
  }

  private buildGrid(): Graphics {
    const g = new Graphics();
    g.rect(0, 0, BOARD_W, BOARD_H).fill({ color: 0x070912 });
    for (let c = 0; c <= COLS; c++) {
      g.moveTo(c * CELL, 0).lineTo(c * CELL, BOARD_H);
    }
    for (let r = 0; r <= ROWS; r++) {
      g.moveTo(0, r * CELL).lineTo(BOARD_W, r * CELL);
    }
    g.stroke({ width: 1, color: GRID_LINE, alpha: 0.8 });
    return g;
  }

  private cellRect(
    g: Graphics,
    col: number,
    row: number,
    yOff: number,
    color: Cell,
    opts: { glow?: number } = {},
  ): void {
    const x = col * CELL;
    const y = row * CELL + yOff;
    const { base, hi } = colorOf(color);
    const pad = 2;
    if (opts.glow) {
      g.roundRect(x - 1, y - 1, CELL + 2, CELL + 2, 9).fill({
        color: hi,
        alpha: opts.glow,
      });
    }
    g.roundRect(x + pad, y + pad, CELL - pad * 2, CELL - pad * 2, 7).fill(base);
    // top sheen
    g.roundRect(x + pad + 3, y + pad + 3, CELL - pad * 2 - 6, 6, 4).fill({
      color: hi,
      alpha: 0.55,
    });
  }

  private drawCells(rs: RenderState): void {
    const g = this.cellG;
    g.clear();
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        const cell = rs.grid[row]![col] ?? null;
        if (cell === null) continue;
        const yOff = this.fallOffsets.get(row * COLS + col) ?? 0;
        this.cellRect(g, col, row, yOff, cell);
      }
    }
  }

  private drawMarked(rs: RenderState): void {
    const g = this.markG;
    g.clear();
    const pulse = 0.35 + 0.35 * (0.5 + 0.5 * Math.sin(this.clock / 160));
    for (const { row, col } of rs.marked) {
      const x = col * CELL;
      const y = row * CELL + (this.fallOffsets.get(row * COLS + col) ?? 0);
      g.roundRect(x + 1, y + 1, CELL - 2, CELL - 2, 7).stroke({
        width: 2.5,
        color: 0xffffff,
        alpha: pulse,
      });
      g.roundRect(x + 4, y + 4, CELL - 8, CELL - 8, 5).fill({
        color: 0xffffff,
        alpha: pulse * 0.25,
      });
    }
  }

  private drawPiece(rs: RenderState): void {
    const g = this.pieceG;
    g.clear();
    if (!rs.active) return;
    const { cells, pos } = rs.active;
    const yOff = rs.fallProgress * CELL;
    const map: [number, number, Cell][] = [
      [pos.row, pos.col, cells[0][0]],
      [pos.row, pos.col + 1, cells[0][1]],
      [pos.row + 1, pos.col, cells[1][0]],
      [pos.row + 1, pos.col + 1, cells[1][1]],
    ];
    for (const [row, col, color] of map) {
      this.cellRect(g, col, row, yOff, color, { glow: 0.4 });
    }
  }

  private drawFlashes(): void {
    const g = this.fxG;
    g.clear();
    for (const f of this.flashes) {
      const grow = (1 - f.life) * 10;
      g.roundRect(
        f.x - grow,
        f.y - grow,
        CELL + grow * 2,
        CELL + grow * 2,
        8,
      ).fill({ color: f.color, alpha: f.life * 0.8 });
    }
  }

  private drawSweep(rs: RenderState): void {
    const g = this.sweepG;
    g.clear();
    const x = rs.sweepX * CELL;
    // trail
    const trailW = CELL * 2.2;
    for (let i = 0; i < 6; i++) {
      const a = 0.06 * (1 - i / 6);
      g.rect(x - trailW + (i * trailW) / 6, 0, trailW / 6, BOARD_H).fill({
        color: SWEEP,
        alpha: a,
      });
    }
    // glow + core bar
    g.rect(x - 6, 0, 12, BOARD_H).fill({ color: SWEEP, alpha: 0.18 });
    g.rect(x - 1.5, 0, 3, BOARD_H).fill({ color: 0xffffff, alpha: 0.95 });
    g.circle(x, 6, 5).fill({ color: 0xffffff });
    g.circle(x, BOARD_H - 6, 5).fill({ color: 0xffffff });
  }
}
