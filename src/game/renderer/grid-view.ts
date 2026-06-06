import { Container, Graphics } from "pixi.js";
import { CELL_SIZE, GRID_COLS, GRID_ROWS } from "../constants";
import type { Grid } from "../types";

/** Colour_A: warm orange/amber. */
const COLOUR_A = 0xf59e0b;
/** Colour_B: cool purple/violet. */
const COLOUR_B = 0x8b5cf6;
/** Grid background. */
const BG_COLOR = 0x1a1a2e;
/** Subtle grid lines. */
const GRID_LINE_COLOR = 0x2a2a3e;
/** White overlay for marked cells. */
const MARKED_OVERLAY = 0xffffff;
/** Pulse frequency: 2Hz → full cycle every 500ms → angular vel = 2π * 2 per second. */
const PULSE_FREQ_HZ = 2;

export class GridView {
  container: Container;
  private background: Graphics;
  private cellGraphics: Graphics;
  private markedGraphics: Graphics;
  private startTime: number;

  constructor() {
    this.container = new Container();
    this.startTime = performance.now();

    // Grid background with cell fills and lines
    this.background = new Graphics();
    this.drawBackground();
    this.container.addChild(this.background);

    // Cell fills
    this.cellGraphics = new Graphics();
    this.container.addChild(this.cellGraphics);

    // Marked cell overlay (pulsing border/glow)
    this.markedGraphics = new Graphics();
    this.container.addChild(this.markedGraphics);
  }

  private drawBackground(): void {
    const g = this.background;
    const width = GRID_COLS * CELL_SIZE;
    const height = GRID_ROWS * CELL_SIZE;

    // Solid background
    g.rect(0, 0, width, height);
    g.fill({ color: BG_COLOR });

    // Subtle grid lines
    for (let r = 0; r <= GRID_ROWS; r++) {
      g.moveTo(0, r * CELL_SIZE);
      g.lineTo(width, r * CELL_SIZE);
    }
    for (let c = 0; c <= GRID_COLS; c++) {
      g.moveTo(c * CELL_SIZE, 0);
      g.lineTo(c * CELL_SIZE, height);
    }
    g.stroke({ width: 0.5, color: GRID_LINE_COLOR, alpha: 0.6 });
  }

  update(grid: Grid, markedCells: Set<string>): void {
    const elapsed = performance.now() - this.startTime;
    // 2Hz pulse: sin wave oscillates at 2 cycles per second
    const pulseT = Math.sin((elapsed / 1000) * Math.PI * 2 * PULSE_FREQ_HZ);

    // Redraw filled cells
    const cg = this.cellGraphics;
    cg.clear();

    for (let r = 0; r < GRID_ROWS; r++) {
      for (let c = 0; c < GRID_COLS; c++) {
        const cell = grid[r]![c] ?? null;
        if (cell === null) continue;

        const x = c * CELL_SIZE + 2;
        const y = r * CELL_SIZE + 2;
        const size = CELL_SIZE - 4;

        const color = cell === 0 ? COLOUR_A : COLOUR_B;
        cg.roundRect(x, y, size, size, 4);
        cg.fill({ color, alpha: 0.92 });

        // Subtle inner highlight for depth
        cg.roundRect(x + 2, y + 2, size - 4, size * 0.3, 3);
        cg.fill({ color: 0xffffff, alpha: 0.12 });
      }
    }

    // Marked cell overlay: pulsing white border/glow at 2Hz
    const mg = this.markedGraphics;
    mg.clear();

    if (markedCells.size === 0) return;

    // pulseT ranges from -1 to 1; map to alpha 0.15..0.55
    const borderAlpha = 0.35 + 0.2 * pulseT;
    const glowAlpha = 0.08 + 0.07 * pulseT;

    for (const key of markedCells) {
      const [rowStr, colStr] = key.split(",");
      const r = parseInt(rowStr!, 10);
      const c = parseInt(colStr!, 10);

      const x = c * CELL_SIZE + 1;
      const y = r * CELL_SIZE + 1;
      const size = CELL_SIZE - 2;

      // Outer glow fill
      mg.roundRect(x, y, size, size, 4);
      mg.fill({ color: MARKED_OVERLAY, alpha: glowAlpha });

      // Pulsing border
      mg.roundRect(x + 1, y + 1, size - 2, size - 2, 3);
      mg.stroke({ color: MARKED_OVERLAY, alpha: borderAlpha, width: 2 });
    }
  }
}
