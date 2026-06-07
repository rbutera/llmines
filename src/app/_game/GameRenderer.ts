// Host-layer file (Req 1.1, 1.2, 1.3, 14): framework-agnostic renderer that
// draws the immutable GameState each frame and layers tasteful animation on top
// of the discrete logical transitions. This module lives in the host layer, so
// importing from `pixi.js` and `~/game` is allowed here (unlike the pure game
// core in `src/game/`, which never imports rendering code).

import { Container, Graphics, type Application, type Ticker } from "pixi.js";
import { COLS, ROWS } from "~/game/constants";
import { compositeGrid } from "~/game/engine";
import { blockCells } from "~/game/grid";
import type { Cell, GameState } from "~/game/types";

/**
 * High-contrast, distinct fills for the two colours (Req 1.3). Color A reads as
 * a cool teal/cyan; Color B as a warm amber/orange. `base` is the cell fill and
 * `edge` a slightly brighter inner highlight for a polished, slightly-raised
 * Lumines look.
 */
const COLOR_THEME = {
  0: { base: 0x21c7c7, edge: 0x6fe9e9 },
  1: { base: 0xf08a24, edge: 0xffba6b },
} as const;

/** Playfield grid line / border colour. */
const GRID_LINE = 0x232336;
/** Sweep bar colour. */
const SWEEP_COLOR = 0xffffff;

/**
 * Draws a {@link GameState} onto a PixiJS stage and animates the sweep bar,
 * marked-cell pulse, and newly-placed cell ease-in. Construct it with the live
 * `Application` and a snapshot source, call {@link start} to drive it from the
 * ticker, and {@link destroy} to remove listeners and graphics.
 */
export class GameRenderer {
  private readonly app: Application;
  private readonly getState: () => GameState;

  // Scene graph layers, back-to-front.
  private readonly bgLayer: Graphics;
  private readonly cellsLayer: Container;
  private readonly activeLayer: Container;
  private readonly markedLayer: Graphics;
  private readonly sweepLayer: Graphics;

  // Reusable graphics for the per-frame cell / active redraw.
  private readonly cellsGraphics: Graphics;
  private readonly activeGraphics: Graphics;

  private cellW = 0;
  private cellH = 0;

  /** Wall-clock-ish elapsed time (ms) for pulsing/easing animations. */
  private elapsedMs = 0;
  /** Smoothly interpolated sweep-bar column position. */
  private displaySweepX = 0;
  /** Whether the smoothed sweep position has been initialised. */
  private sweepInitialised = false;

  private readonly tick = (ticker: Ticker): void => {
    this.update(ticker.deltaMS);
  };
  private started = false;

  constructor(app: Application, getState: () => GameState) {
    this.app = app;
    this.getState = getState;

    this.bgLayer = new Graphics();
    this.cellsLayer = new Container();
    this.activeLayer = new Container();
    this.markedLayer = new Graphics();
    this.sweepLayer = new Graphics();

    this.cellsGraphics = new Graphics();
    this.activeGraphics = new Graphics();
    this.cellsLayer.addChild(this.cellsGraphics);
    this.activeLayer.addChild(this.activeGraphics);

    // Back-to-front: playfield grid, settled cells, active block, marked
    // highlight, then the sweep bar on top.
    this.app.stage.addChild(
      this.bgLayer,
      this.cellsLayer,
      this.activeLayer,
      this.markedLayer,
      this.sweepLayer,
    );

    this.computeLayout();
    this.drawBackground();
  }

  /** Recompute cell size from the current canvas size. */
  private computeLayout(): void {
    this.cellW = this.app.screen.width / COLS;
    this.cellH = this.app.screen.height / ROWS;
  }

  /** Draw the static playfield: a dark field with subtle per-cell grid lines. */
  private drawBackground(): void {
    const g = this.bgLayer;
    g.clear();
    const w = this.app.screen.width;
    const h = this.app.screen.height;
    g.rect(0, 0, w, h).fill({ color: 0x0b0b14, alpha: 1 });
    for (let c = 0; c <= COLS; c++) {
      const x = c * this.cellW;
      g.moveTo(x, 0).lineTo(x, h);
    }
    for (let r = 0; r <= ROWS; r++) {
      const y = r * this.cellH;
      g.moveTo(0, y).lineTo(w, y);
    }
    g.stroke({ width: 1, color: GRID_LINE, alpha: 0.8 });
  }

  /** Register the per-frame update on the PixiJS ticker (Req 14). */
  start(): void {
    if (this.started) {
      return;
    }
    this.started = true;
    this.app.ticker.add(this.tick);
  }

  /**
   * Advance animation clocks by `dtMs` and redraw. Safe to call directly (e.g.
   * for a deterministic single-frame render in tests) as well as from the
   * ticker.
   */
  update(dtMs: number): void {
    this.elapsedMs += dtMs;
    const state = this.getState();
    this.updateSweep(state, dtMs);
    this.drawCells(state);
    this.drawActive(state);
    this.drawMarked(state);
    this.drawSweepBar(state);
  }

  /** Convenience alias: redraw using a zero time delta (no animation advance). */
  render(): void {
    this.update(0);
  }

  /** Smoothly interpolate the display sweep position toward `state.sweepX`. */
  private updateSweep(state: GameState, dtMs: number): void {
    if (!this.sweepInitialised) {
      this.displaySweepX = state.sweepX;
      this.sweepInitialised = true;
      return;
    }
    // The logical bar wraps from COLS back to 0; snap on wrap so we don't sweep
    // backwards across the whole field, otherwise ease toward the target.
    if (state.sweepX + 0.5 < this.displaySweepX) {
      this.displaySweepX = state.sweepX;
      return;
    }
    const ease = Math.min(1, dtMs / 80);
    this.displaySweepX += (state.sweepX - this.displaySweepX) * ease;
  }

  /** Draw all settled + active cell fills from the composite grid (Req 1.2). */
  private drawCells(state: GameState): void {
    const g = this.cellsGraphics;
    g.clear();
    const composite = compositeGrid(state);
    for (let r = 0; r < ROWS; r++) {
      const row = composite[r];
      if (row === undefined) {
        continue;
      }
      for (let c = 0; c < COLS; c++) {
        const cell = row[c];
        if (cell === undefined || cell === null) {
          continue;
        }
        this.paintCell(g, r, c, cell, 1);
      }
    }
  }

  /** Paint a single rounded cell with a subtle inner highlight border. */
  private paintCell(
    g: Graphics,
    row: number,
    col: number,
    cell: NonNullable<Cell>,
    alpha: number,
  ): void {
    const theme = COLOR_THEME[cell];
    const pad = Math.max(1, Math.min(this.cellW, this.cellH) * 0.06);
    const radius = Math.min(this.cellW, this.cellH) * 0.18;
    const x = col * this.cellW + pad;
    const y = row * this.cellH + pad;
    const w = this.cellW - pad * 2;
    const h = this.cellH - pad * 2;
    g.roundRect(x, y, w, h, radius).fill({ color: theme.base, alpha });
    g.roundRect(x, y, w, h, radius).stroke({
      width: Math.max(1, pad * 0.9),
      color: theme.edge,
      alpha: 0.9 * alpha,
    });
  }

  /**
   * Overlay the falling block with a brighter, slightly inset treatment so the
   * Active_Block reads as elevated above the settled stack (Req 14.1). A gentle
   * ease-in alpha on the inset highlight gives the piece a lively feel.
   */
  private drawActive(state: GameState): void {
    const g = this.activeGraphics;
    g.clear();
    if (state.active === null) {
      return;
    }
    const pulse = 0.75 + 0.25 * Math.sin(this.elapsedMs / 220);
    for (const { row, col, color } of blockCells(state.active)) {
      if (row < 0 || row >= ROWS || col < 0 || col >= COLS) {
        continue;
      }
      const theme = COLOR_THEME[color];
      const pad = Math.max(1, Math.min(this.cellW, this.cellH) * 0.06);
      const radius = Math.min(this.cellW, this.cellH) * 0.18;
      const inset = Math.min(this.cellW, this.cellH) * 0.22;
      const x = col * this.cellW + pad;
      const y = row * this.cellH + pad;
      const w = this.cellW - pad * 2;
      const h = this.cellH - pad * 2;
      // Brighter base so the active block stands apart from settled cells.
      g.roundRect(x, y, w, h, radius).fill({ color: theme.edge, alpha: 0.95 });
      // Inset glow that gently pulses.
      g.roundRect(
        x + inset,
        y + inset,
        Math.max(0, w - inset * 2),
        Math.max(0, h - inset * 2),
        radius * 0.6,
      ).fill({ color: 0xffffff, alpha: 0.18 * pulse });
    }
  }

  /**
   * Highlight marked cells with a pulsing white outline so the squares about to
   * be cleared read clearly (Req 14.3).
   */
  private drawMarked(state: GameState): void {
    const g = this.markedLayer;
    g.clear();
    const pulse = 0.5 + 0.5 * Math.sin(this.elapsedMs / 180);
    const alpha = 0.35 + 0.45 * pulse;
    for (let r = 0; r < ROWS; r++) {
      const markedRow = state.marked[r];
      if (markedRow === undefined) {
        continue;
      }
      for (let c = 0; c < COLS; c++) {
        if (markedRow[c] !== true) {
          continue;
        }
        const pad = Math.max(1, Math.min(this.cellW, this.cellH) * 0.06);
        const radius = Math.min(this.cellW, this.cellH) * 0.18;
        const x = c * this.cellW + pad;
        const y = r * this.cellH + pad;
        const w = this.cellW - pad * 2;
        const h = this.cellH - pad * 2;
        g.roundRect(x, y, w, h, radius).stroke({
          width: Math.max(1.5, pad * 1.2),
          color: SWEEP_COLOR,
          alpha,
        });
      }
    }
  }

  /**
   * Draw the timeline bar at the smoothed sweep position with a translucent
   * leading edge and trailing gradient so it reads as a moving timeline
   * (Req 14.2).
   */
  private drawSweepBar(state: GameState): void {
    const g = this.sweepLayer;
    g.clear();
    if (state.gameOver) {
      return;
    }
    const h = this.app.screen.height;
    const x = this.displaySweepX * this.cellW;
    // Trailing wash behind the leading edge.
    const trail = this.cellW * 1.5;
    g.rect(Math.max(0, x - trail), 0, trail, h).fill({
      color: SWEEP_COLOR,
      alpha: 0.08,
    });
    // The leading edge bar.
    const barW = Math.max(2, this.cellW * 0.12);
    g.rect(x - barW / 2, 0, barW, h).fill({ color: SWEEP_COLOR, alpha: 0.85 });
  }

  /** Remove ticker listener and all graphics from the stage. */
  destroy(): void {
    if (this.started) {
      this.app.ticker.remove(this.tick);
      this.started = false;
    }
    this.bgLayer.destroy();
    this.cellsLayer.destroy({ children: true });
    this.activeLayer.destroy({ children: true });
    this.markedLayer.destroy();
    this.sweepLayer.destroy();
  }
}
