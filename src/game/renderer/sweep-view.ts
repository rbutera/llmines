import { Container, Graphics } from "pixi.js";
import { CELL_SIZE, GRID_COLS, GRID_ROWS } from "../constants";

/** Bright cyan sweep bar. */
const SWEEP_COLOR = 0x06b6d4;
/** Glow around bar: same cyan but semi-transparent. */
const GLOW_COLOR = 0x06b6d4;

export class SweepView {
  container: Container;
  private glowGraphics: Graphics;
  private barGraphics: Graphics;

  constructor() {
    this.container = new Container();

    // Glow region drawn behind the bar
    this.glowGraphics = new Graphics();
    this.container.addChild(this.glowGraphics);

    // The bar line itself
    this.barGraphics = new Graphics();
    this.container.addChild(this.barGraphics);
  }

  /**
   * Update sweep bar position.
   * @param sweepX - value in 0–16 range representing column position.
   *   Maps linearly: 0 → 0px, 16 → 640px.
   */
  update(sweepX: number): void {
    const canvasWidth = GRID_COLS * CELL_SIZE; // 640
    const height = GRID_ROWS * CELL_SIZE; // 400

    // Map sweepX (0–16) to pixel position (0–640)
    const x = (sweepX / GRID_COLS) * canvasWidth;

    // --- Glow effect: extends ≥1 column width (40px) around bar ---
    const glow = this.glowGraphics;
    glow.clear();

    // Outer glow: ~1.5 columns wide (60px total), faint
    const outerGlowWidth = CELL_SIZE * 1.5;
    glow.rect(x - outerGlowWidth / 2, 0, outerGlowWidth, height);
    glow.fill({ color: GLOW_COLOR, alpha: 0.06 });

    // Inner glow: ~1 column wide (40px), slightly brighter
    const innerGlowWidth = CELL_SIZE;
    glow.rect(x - innerGlowWidth / 2, 0, innerGlowWidth, height);
    glow.fill({ color: GLOW_COLOR, alpha: 0.1 });

    // Core glow: narrow bright center
    const coreGlowWidth = CELL_SIZE * 0.4;
    glow.rect(x - coreGlowWidth / 2, 0, coreGlowWidth, height);
    glow.fill({ color: GLOW_COLOR, alpha: 0.15 });

    // --- Bar: vertical line ≥1px wide ---
    const bar = this.barGraphics;
    bar.clear();

    // Main bar body: 3px wide
    bar.rect(x - 1.5, 0, 3, height);
    bar.fill({ color: SWEEP_COLOR, alpha: 0.9 });

    // Bright center line: 1px
    bar.rect(x - 0.5, 0, 1, height);
    bar.fill({ color: 0xffffff, alpha: 0.95 });
  }
}
