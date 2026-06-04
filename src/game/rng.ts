import type { Color, Piece } from "./types";

/**
 * Small, fast, fully deterministic PRNG (mulberry32). Seeding it with the same
 * value always yields the same sequence, which is what the test harness relies
 * on via `window.__lumines.seed(n)`.
 */
export class Rng {
  private state: number;

  constructor(seed = 1) {
    // Coerce to a 32-bit unsigned integer.
    this.state = seed >>> 0;
  }

  /** Reseed, restarting the deterministic sequence. */
  seed(n: number): void {
    this.state = n >>> 0;
  }

  /** Next float in [0, 1). */
  next(): number {
    this.state |= 0;
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = Math.imul(this.state ^ (this.state >>> 15), 1 | this.state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** A single random colour (0 or 1). */
  nextColor(): Color {
    return this.next() < 0.5 ? 0 : 1;
  }

  /** A fresh 2x2 piece with each of the 4 cells independently coloured. */
  nextPiece(): Piece {
    return [
      [this.nextColor(), this.nextColor()],
      [this.nextColor(), this.nextColor()],
    ];
  }
}
