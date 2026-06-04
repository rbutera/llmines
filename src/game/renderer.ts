import { type Application, Container, Graphics } from "pixi.js";

import { COLS, ROWS } from "./constants";
import type { GameEngine } from "./engine";
import { markedMask } from "./grid";
import type { CellCoord, Color } from "./types";

/** Per-colour palette: base, glossy top highlight, bottom shadow. */
const PALETTE: Record<Color, { base: number; light: number; dark: number }> = {
  0: { base: 0xff9f43, light: 0xffd9a0, dark: 0xc56f1a }, // amber
  1: { base: 0x46d6c8, light: 0xa9f0e8, dark: 0x1f8a80 }, // teal
};

const BG = 0x0d1020;
const GRID_LINE = 0xffffff;

/** A single rendered cell: smoothly animates its row, scale and alpha. */
class Block extends Container {
  gfx = new Graphics();
  color: Color;
  /** Logical (target) position. */
  targetRow: number;
  col: number;
  /** Animated (visual) position and scale. */
  visualRow: number;
  scaleAmt = 1;

  constructor(color: Color, row: number, col: number, fromAbove: boolean) {
    super();
    this.color = color;
    this.targetRow = row;
    this.col = col;
    this.visualRow = fromAbove ? row - 1.4 : row;
    this.addChild(this.gfx);
    this.draw();
  }

  setColor(color: Color): void {
    if (color === this.color) return;
    this.color = color;
    this.draw();
  }

  private draw(): void {
    const g = this.gfx;
    g.clear();
    drawCell(g, this.color, CELL);
  }
}

let CELL = 40;
let PAD = 0;

function drawCell(g: Graphics, color: Color, size: number): void {
  const p = PALETTE[color];
  const inset = 1.5;
  const s = size - inset * 2;
  const r = Math.max(4, size * 0.16);
  // Base body with a vertical gloss: base fill, lighter top band, dark bottom.
  g.roundRect(inset, inset, s, s, r).fill({ color: p.base });
  g.roundRect(inset, inset, s, s * 0.46, r).fill({
    color: p.light,
    alpha: 0.55,
  });
  g.roundRect(inset, inset + s * 0.6, s, s * 0.4, r).fill({
    color: p.dark,
    alpha: 0.4,
  });
  // Specular dot + crisp rim.
  g.circle(inset + s * 0.28, inset + s * 0.26, s * 0.07).fill({
    color: 0xffffff,
    alpha: 0.5,
  });
  g.roundRect(inset, inset, s, s, r).stroke({
    width: 1.5,
    color: p.light,
    alpha: 0.5,
  });
}

interface Burst {
  gfx: Graphics;
  life: number;
  ttl: number;
}

/**
 * Renders the engine to a PixiJS canvas with Lumines-style motion: pieces fall
 * smoothly, marked squares pulse, the timeline bar sweeps with a glowing trail,
 * cleared cells burst, and survivors collapse into the gaps.
 */
export class LuminesRenderer {
  private app: Application;
  private engine: GameEngine;

  private boardRoot = new Container();
  private cellLayer = new Container();
  private markLayer = new Graphics();
  private burstLayer = new Container();
  private pieceLayer = new Container();
  private sweepLayer = new Graphics();
  private bgLayer = new Graphics();

  /** Settled blocks per column, ordered bottom (index 0) to top. */
  private columns: Block[][] = Array.from({ length: COLS }, () => []);
  private pieceBlocks: Block[] = [];
  private bursts: Burst[] = [];

  private time = 0;
  private unsub: Array<() => void> = [];
  private destroyed = false;

  constructor(app: Application, engine: GameEngine, cell: number) {
    this.app = app;
    this.engine = engine;
    CELL = cell;
    PAD = Math.round(cell * 0.5);

    this.boardRoot.x = PAD;
    this.boardRoot.y = PAD;
    app.stage.addChild(this.bgLayer);
    this.boardRoot.addChild(
      this.cellLayer,
      this.markLayer,
      this.pieceLayer,
      this.sweepLayer,
      this.burstLayer,
    );
    app.stage.addChild(this.boardRoot);

    this.drawBackground();

    this.unsub.push(
      engine.on("clear", (p) => this.onClear(p as CellCoord[])),
      engine.on("change", () => this.syncSettled()),
      engine.on("lock", () => this.syncSettled()),
      engine.on("phase", () => this.syncSettled()),
    );

    this.syncSettled();
    app.ticker.add(this.update);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.app.ticker.remove(this.update);
    this.unsub.forEach((u) => u());
  }

  // ---- static background ------------------------------------------------

  private drawBackground(): void {
    const g = this.bgLayer;
    const w = COLS * CELL;
    const h = ROWS * CELL;
    g.clear();
    // Outer panel with rounded frame.
    g.roundRect(PAD - 10, PAD - 10, w + 20, h + 20, 16).fill({
      color: 0x05060f,
    });
    g.roundRect(PAD - 4, PAD - 4, w + 8, h + 8, 12).fill({ color: BG });
    // Column shading to suggest the 8-column sweep "blocks".
    for (let c = 0; c < COLS; c++) {
      if (c % 2 === 0) {
        g.rect(PAD + c * CELL, PAD, CELL, h).fill({
          color: 0xffffff,
          alpha: 0.015,
        });
      }
    }
    // Grid lines.
    for (let c = 0; c <= COLS; c++) {
      g.moveTo(PAD + c * CELL, PAD)
        .lineTo(PAD + c * CELL, PAD + h)
        .stroke({ width: 1, color: GRID_LINE, alpha: 0.05 });
    }
    for (let r = 0; r <= ROWS; r++) {
      g.moveTo(PAD, PAD + r * CELL)
        .lineTo(PAD + w, PAD + r * CELL)
        .stroke({ width: 1, color: GRID_LINE, alpha: 0.05 });
    }
  }

  // ---- settled reconciliation ------------------------------------------

  /** Reconcile the rendered column stacks against the engine's settled grid. */
  private syncSettled(): void {
    const grid = this.engine.grid;
    for (let col = 0; col < COLS; col++) {
      // Engine column colours, bottom-up.
      const colours: { color: Color; row: number }[] = [];
      for (let row = ROWS - 1; row >= 0; row--) {
        const v = grid[row]![col] ?? null;
        if (v !== null) colours.push({ color: v, row });
      }
      const blocks = this.columns[col]!;
      // Pair bottom-up; reuse existing sprites so survivors slide into gaps.
      for (let i = 0; i < colours.length; i++) {
        const want = colours[i]!;
        let block = blocks[i];
        if (!block) {
          block = new Block(want.color, want.row, col, true);
          block.scaleAmt = 1.18;
          blocks[i] = block;
          this.cellLayer.addChild(block);
        } else {
          block.setColor(want.color);
        }
        block.targetRow = want.row;
      }
      // Remove surplus sprites (cells that left this column).
      while (blocks.length > colours.length) {
        const extra = blocks.pop()!;
        extra.destroy();
      }
    }
  }

  // ---- clear bursts -----------------------------------------------------

  private onClear(cells: CellCoord[]): void {
    for (const { row, col } of cells) {
      const g = new Graphics();
      g.x = col * CELL + CELL / 2;
      g.y = row * CELL + CELL / 2;
      this.burstLayer.addChild(g);
      this.bursts.push({ gfx: g, life: 0, ttl: 360 });
    }
  }

  // ---- per-frame update -------------------------------------------------

  private update = (): void => {
    if (this.destroyed) return;
    const dt = this.app.ticker.deltaMS;
    this.time += dt;
    const k = 1 - Math.exp(-dt / 55); // smoothing factor

    // Settled blocks: ease toward target row and rest scale.
    for (const col of this.columns) {
      for (const b of col) {
        b.visualRow += (b.targetRow - b.visualRow) * k;
        b.scaleAmt += (1 - b.scaleAmt) * k;
        b.x = b.col * CELL;
        b.y = b.visualRow * CELL;
        this.applyScale(b);
      }
    }

    this.renderPiece(k);
    this.renderMarks();
    this.renderSweep();
    this.renderBursts(dt);
  };

  private applyScale(b: Block): void {
    const s = b.scaleAmt;
    b.gfx.scale.set(s);
    const off = (CELL * (1 - s)) / 2;
    b.gfx.x = off;
    b.gfx.y = off;
  }

  private renderPiece(k: number): void {
    const piece = this.engine.piece;
    if (!piece || this.engine.phase !== "playing") {
      this.pieceBlocks.forEach((b) => b.destroy());
      this.pieceBlocks = [];
      return;
    }
    // Ensure 4 blocks exist.
    if (this.pieceBlocks.length !== 4) {
      this.pieceBlocks.forEach((b) => b.destroy());
      this.pieceBlocks = [];
      for (let i = 0; i < 4; i++) {
        const b = new Block(0, 0, 0, false);
        this.pieceBlocks.push(b);
        this.pieceLayer.addChild(b);
      }
    }
    let i = 0;
    for (let dr = 0; dr < 2; dr++) {
      for (let dc = 0; dc < 2; dc++) {
        const b = this.pieceBlocks[i++]!;
        const targetRow = piece.row + dr;
        const targetCol = piece.col + dc;
        b.setColor(piece.cells[dr]![dc]!);
        b.visualRow += (targetRow - b.visualRow) * k;
        // Snap column instantly for responsive lateral movement.
        b.col = targetCol;
        b.x = targetCol * CELL;
        b.y = b.visualRow * CELL;
        b.scaleAmt += (1 - b.scaleAmt) * k;
        this.applyScale(b);
      }
    }
  }

  private renderMarks(): void {
    const g = this.markLayer;
    g.clear();
    const mask = markedMask(this.engine.grid);
    const pulse = 0.32 + 0.18 * Math.sin(this.time / 180);
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        if (!mask[row]![col]) continue;
        const x = col * CELL;
        const y = row * CELL;
        g.roundRect(x + 3, y + 3, CELL - 6, CELL - 6, 6).stroke({
          width: 2,
          color: 0xffffff,
          alpha: 0.7,
        });
        g.roundRect(x + 1, y + 1, CELL - 2, CELL - 2, 8).fill({
          color: 0xffffff,
          alpha: pulse * 0.4,
        });
      }
    }
  }

  private renderSweep(): void {
    if (this.engine.phase !== "playing") {
      this.sweepLayer.clear();
      return;
    }
    const g = this.sweepLayer;
    g.clear();
    const h = ROWS * CELL;
    const x = this.engine.sweepX * CELL;
    // Soft scanned region trailing the bar.
    const trail = CELL * 1.6;
    g.rect(Math.max(0, x - trail), 0, Math.min(trail, x), h).fill({
      color: 0xffffff,
      alpha: 0.06,
    });
    // Glow column.
    g.rect(x - 6, 0, 12, h).fill({ color: 0x7df9ff, alpha: 0.18 });
    g.rect(x - 2.5, 0, 5, h).fill({ color: 0xeafdff, alpha: 0.85 });
    // Leading edge highlight.
    g.rect(x - 1, 0, 2, h).fill({ color: 0xffffff, alpha: 1 });
    // Cap glows top & bottom.
    g.circle(x, 0, 8).fill({ color: 0x7df9ff, alpha: 0.5 });
    g.circle(x, h, 8).fill({ color: 0x7df9ff, alpha: 0.5 });
  }

  private renderBursts(dt: number): void {
    for (let i = this.bursts.length - 1; i >= 0; i--) {
      const b = this.bursts[i]!;
      b.life += dt;
      const t = b.life / b.ttl;
      if (t >= 1) {
        b.gfx.destroy();
        this.bursts.splice(i, 1);
        continue;
      }
      const ease = 1 - (1 - t) * (1 - t);
      const radius = CELL * (0.2 + ease * 0.7);
      b.gfx.clear();
      b.gfx
        .circle(0, 0, radius)
        .stroke({ width: 3 * (1 - t), color: 0xffffff, alpha: 1 - t });
      b.gfx.circle(0, 0, radius * 0.6).fill({
        color: 0xeafdff,
        alpha: (1 - t) * 0.5,
      });
    }
  }
}

/** Total pixel size of the rendered board for a given cell size. */
export function boardPixelSize(cell: number): {
  width: number;
  height: number;
} {
  const pad = Math.round(cell * 0.5);
  return {
    width: COLS * cell + pad * 2,
    height: ROWS * cell + pad * 2,
  };
}
