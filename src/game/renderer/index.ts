import { Application, Container } from "pixi.js";
import { CELL_SIZE, GRID_COLS, GRID_ROWS } from "../constants";
import type { GameState } from "../types";
import { GridView } from "./grid-view";
import { PieceView } from "./piece-view";
import { SweepView } from "./sweep-view";
import { EffectsManager } from "./effects";

/**
 * PixiJS 8 renderer for LLMines.
 *
 * Container hierarchy (back to front):
 *   background → cells → marked overlay → piece → sweep → effects
 *
 * Canvas: 640px wide × 400px tall (16 cols × 10 rows × 40px cell size).
 *
 * All animations are purely visual — they never block game state or input.
 */
export class PixiRenderer {
  private app: Application;
  private gridView!: GridView;
  private pieceView!: PieceView;
  private sweepView!: SweepView;
  private effects!: EffectsManager;
  private initialized = false;

  constructor() {
    this.app = new Application();
  }

  /**
   * Initialize the PixiJS application and create all view layers.
   * Must be called before render().
   */
  async init(canvas: HTMLCanvasElement): Promise<void> {
    await this.app.init({
      canvas,
      width: GRID_COLS * CELL_SIZE, // 640
      height: GRID_ROWS * CELL_SIZE, // 400
      backgroundColor: 0x1a1a2e,
      antialias: true,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,
    });

    // Build container hierarchy (back to front rendering order)
    const gameContainer = new Container();
    this.app.stage.addChild(gameContainer);

    // 1. Grid background + filled cells + marked overlay
    this.gridView = new GridView();
    gameContainer.addChild(this.gridView.container);

    // 2. Active piece layer
    this.pieceView = new PieceView();
    gameContainer.addChild(this.pieceView.container);

    // 3. Sweep bar + glow
    this.sweepView = new SweepView();
    gameContainer.addChild(this.sweepView.container);

    // 4. Effects layer (lock flash, dissolve, gravity) on top
    this.effects = new EffectsManager();
    gameContainer.addChild(this.effects.container);

    this.initialized = true;
  }

  /**
   * Render the current game state. Called each frame.
   *
   * 1. Updates grid cells (filled/empty/marked with colors)
   * 2. Updates active piece position (with lerp animation)
   * 3. Updates sweep bar position (with glow)
   * 4. Processes active effects (lock, dissolve, gravity)
   *
   * If no state has been provided yet or renderer not initialized, does nothing.
   */
  render(state: GameState): void {
    if (!this.initialized) return;

    // Update grid: filled cells + marked overlay
    this.gridView.update(state.grid, state.markedCells);

    // Update active piece with lerp interpolation
    this.pieceView.update(state.activePiece);

    // Update sweep bar horizontal position + glow
    this.sweepView.update(state.sweepX);

    // Process time-based effects (purely visual, non-blocking)
    this.effects.update();
  }

  /**
   * Trigger a lock effect: brief flash/scale pulse on the locked piece.
   * Duration: 150ms. Purely visual, does not block state.
   */
  triggerLockEffect(row: number, col: number): void {
    if (!this.initialized) return;
    this.effects.playLockEffect(row, col);
  }

  /**
   * Trigger deletion dissolve effect on the given cells.
   * Duration: ≤250ms. Called when sweep passes marked cells.
   */
  triggerClearEffect(cells: Array<{ row: number; col: number }>): void {
    if (!this.initialized) return;
    this.effects.playClearEffect(cells);
  }

  /**
   * Trigger gravity settle animation for a cell dropping.
   * Duration: ≤150ms per row traveled. Purely visual.
   */
  triggerGravityEffect(
    col: number,
    fromRow: number,
    toRow: number,
    color: 0 | 1,
  ): void {
    if (!this.initialized) return;
    this.effects.playGravityEffect(col, fromRow, toRow, color);
  }

  /**
   * Clean up all PixiJS resources.
   */
  destroy(): void {
    if (this.initialized) {
      this.app.destroy(true);
      this.initialized = false;
    }
  }

  /** Canvas width in pixels. */
  getWidth(): number {
    return GRID_COLS * CELL_SIZE;
  }

  /** Canvas height in pixels. */
  getHeight(): number {
    return GRID_ROWS * CELL_SIZE;
  }
}
