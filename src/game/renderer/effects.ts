import { Container, Graphics } from "pixi.js";
import { CELL_SIZE } from "../constants";

/**
 * An active visual effect with a fixed duration.
 * The update callback receives progress 0→1 and redraws the graphics each frame.
 */
interface Effect {
  graphics: Graphics;
  startTime: number;
  duration: number;
  update: (progress: number) => void;
}

/**
 * Easing: ease-out cubic for snappy attack and smooth decay.
 */
function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

/**
 * Easing: ease-in quad for accelerating fade-out.
 */
function easeInQuad(t: number): number {
  return t * t;
}

export class EffectsManager {
  container: Container;
  private effects: Effect[] = [];

  constructor() {
    this.container = new Container();
  }

  /** Process all active effects. Call once per frame. */
  update(): void {
    const now = performance.now();
    const toRemove: number[] = [];

    for (let i = 0; i < this.effects.length; i++) {
      const effect = this.effects[i]!;
      const elapsed = now - effect.startTime;
      const progress = Math.min(1, elapsed / effect.duration);

      effect.update(progress);

      if (progress >= 1) {
        this.container.removeChild(effect.graphics);
        effect.graphics.destroy();
        toRemove.push(i);
      }
    }

    // Remove completed effects in reverse order to maintain indices
    for (let i = toRemove.length - 1; i >= 0; i--) {
      this.effects.splice(toRemove[i]!, 1);
    }
  }

  /**
   * Lock effect: brief flash/scale pulse on the locked piece area.
   * Duration: 150ms (within 80-200ms requirement).
   * Visual: white flash that expands slightly and fades.
   */
  playLockEffect(row: number, col: number): void {
    const g = new Graphics();
    this.container.addChild(g);

    const effect: Effect = {
      graphics: g,
      startTime: performance.now(),
      duration: 150, // 80-200ms range
      update: (progress: number) => {
        g.clear();
        const eased = easeOutCubic(progress);
        const alpha = 0.7 * (1 - eased);
        const scale = 1 + eased * 0.2;

        // Flash covers the full 2×2 piece area
        const cx = col * CELL_SIZE + CELL_SIZE; // center of 2×2
        const cy = row * CELL_SIZE + CELL_SIZE;
        const w = CELL_SIZE * 2 * scale;
        const h = CELL_SIZE * 2 * scale;

        g.roundRect(cx - w / 2, cy - h / 2, w, h, 6);
        g.fill({ color: 0xffffff, alpha });

        // Inner bright core
        const innerScale = 1 + eased * 0.1;
        const iw = CELL_SIZE * 1.6 * innerScale;
        const ih = CELL_SIZE * 1.6 * innerScale;
        g.roundRect(cx - iw / 2, cy - ih / 2, iw, ih, 4);
        g.fill({ color: 0xffffff, alpha: alpha * 0.5 });
      },
    };

    this.effects.push(effect);
  }

  /**
   * Deletion/dissolve effect: cells fade out and scale down when sweep passes.
   * Duration: 220ms (within ≤250ms requirement).
   * Visual: fade + shrink + particle burst.
   */
  playClearEffect(cells: Array<{ row: number; col: number }>): void {
    for (const cell of cells) {
      const g = new Graphics();
      this.container.addChild(g);

      const effect: Effect = {
        graphics: g,
        startTime: performance.now(),
        duration: 220, // ≤250ms
        update: (progress: number) => {
          g.clear();
          const eased = easeInQuad(progress);
          const alpha = 0.85 * (1 - eased);
          const scale = 1 - eased * 0.6; // shrink to 40%

          const cx = cell.col * CELL_SIZE + CELL_SIZE / 2;
          const cy = cell.row * CELL_SIZE + CELL_SIZE / 2;
          const size = (CELL_SIZE - 4) * scale;

          // Dissolving cell
          g.roundRect(cx - size / 2, cy - size / 2, size, size, 3);
          g.fill({ color: 0xffffff, alpha });

          // Particles flying outward
          if (progress < 0.8) {
            const particleAlpha = alpha * 0.6;
            const particleCount = 4;
            for (let i = 0; i < particleCount; i++) {
              const angle =
                (i / particleCount) * Math.PI * 2 + progress * 4;
              const dist = eased * CELL_SIZE * 0.7;
              const px = cx + Math.cos(angle) * dist;
              const py = cy + Math.sin(angle) * dist;
              const pSize = 2.5 * (1 - progress);
              g.circle(px, py, pSize);
              g.fill({ color: 0xffffff, alpha: particleAlpha });
            }
          }
        },
      };

      this.effects.push(effect);
    }
  }

  /**
   * Gravity settle animation: eased fall per row.
   * Duration: 120ms per row traveled (≤150ms per row requirement).
   * Visual: cell drops from start position to end position with ease-out.
   */
  playGravityEffect(
    col: number,
    fromRow: number,
    toRow: number,
    color: 0 | 1,
  ): void {
    const rowsTraveled = toRow - fromRow;
    if (rowsTraveled <= 0) return;

    const duration = Math.min(rowsTraveled * 120, 600); // cap at 600ms
    const g = new Graphics();
    this.container.addChild(g);

    const COLOUR_A = 0xf59e0b;
    const COLOUR_B = 0x8b5cf6;
    const fillColor = color === 0 ? COLOUR_A : COLOUR_B;

    const startY = fromRow * CELL_SIZE + 2;
    const endY = toRow * CELL_SIZE + 2;
    const x = col * CELL_SIZE + 2;
    const size = CELL_SIZE - 4;

    const effect: Effect = {
      graphics: g,
      startTime: performance.now(),
      duration,
      update: (progress: number) => {
        g.clear();
        const eased = easeOutCubic(progress);
        const y = startY + (endY - startY) * eased;

        g.roundRect(x, y, size, size, 4);
        g.fill({ color: fillColor, alpha: 0.8 });
      },
    };

    this.effects.push(effect);
  }

  /** Check if any effects are currently active. */
  get active(): boolean {
    return this.effects.length > 0;
  }
}
