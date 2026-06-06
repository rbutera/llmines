import { Container, Graphics } from "pixi.js";
import { CELL_SIZE } from "../constants";
import type { ActivePiece } from "../types";

/** Colour_A: warm orange/amber. */
const COLOUR_A = 0xf59e0b;
/** Colour_B: cool purple/violet. */
const COLOUR_B = 0x8b5cf6;

/**
 * Lerp factor per frame for position interpolation.
 * At 60fps, each frame ≈16.7ms. With factor 0.3, ~90% of distance covered in ~100ms.
 */
const LERP_FACTOR = 0.3;
/** Snap threshold in pixels. Below this, snap to target immediately. */
const SNAP_THRESHOLD = 0.5;

export class PieceView {
  container: Container;
  private graphics: Graphics;
  private currentX = 0;
  private currentY = 0;
  private targetX = 0;
  private targetY = 0;
  private hasTarget = false;

  constructor() {
    this.container = new Container();
    this.graphics = new Graphics();
    this.container.addChild(this.graphics);
  }

  update(piece: ActivePiece | null): void {
    this.graphics.clear();

    if (!piece) {
      this.container.visible = false;
      this.hasTarget = false;
      return;
    }

    this.container.visible = true;

    const newTargetX = piece.col * CELL_SIZE;
    const newTargetY = piece.row * CELL_SIZE;

    if (!this.hasTarget) {
      // First time seeing a piece — snap immediately (no lerp on spawn)
      this.currentX = newTargetX;
      this.currentY = newTargetY;
      this.targetX = newTargetX;
      this.targetY = newTargetY;
      this.hasTarget = true;
    } else {
      this.targetX = newTargetX;
      this.targetY = newTargetY;

      // Lerp toward target
      this.currentX += (this.targetX - this.currentX) * LERP_FACTOR;
      this.currentY += (this.targetY - this.currentY) * LERP_FACTOR;

      // Snap if within threshold
      if (Math.abs(this.targetX - this.currentX) < SNAP_THRESHOLD) {
        this.currentX = this.targetX;
      }
      if (Math.abs(this.targetY - this.currentY) < SNAP_THRESHOLD) {
        this.currentY = this.targetY;
      }
    }

    this.container.x = this.currentX;
    this.container.y = this.currentY;

    // Draw the 4 cells of the piece
    const g = this.graphics;
    for (let r = 0; r < 2; r++) {
      for (let c = 0; c < 2; c++) {
        const cell = piece.cells[r]![c]!;
        const color = cell === 0 ? COLOUR_A : COLOUR_B;
        const x = c * CELL_SIZE + 2;
        const y = r * CELL_SIZE + 2;
        const size = CELL_SIZE - 4;

        // Main cell fill
        g.roundRect(x, y, size, size, 4);
        g.fill({ color, alpha: 1 });

        // Inner highlight
        g.roundRect(x + 2, y + 2, size - 4, size * 0.3, 3);
        g.fill({ color: 0xffffff, alpha: 0.2 });

        // Subtle border glow (piece stands out from grid)
        g.roundRect(x, y, size, size, 4);
        g.stroke({ color: 0xffffff, alpha: 0.35, width: 1.5 });
      }
    }
  }

  /** Snap position immediately without interpolation (e.g., on new piece spawn). */
  snapTo(col: number, row: number): void {
    this.currentX = col * CELL_SIZE;
    this.currentY = row * CELL_SIZE;
    this.targetX = this.currentX;
    this.targetY = this.currentY;
    this.hasTarget = true;
  }
}
