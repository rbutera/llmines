import type { Color, Piece } from "./types";

export class SeededRng {
  private state: number;

  constructor(seed = 0x5eed1234) {
    this.state = seed >>> 0;
  }

  seed(seed: number) {
    this.state = seed >>> 0;
  }

  next() {
    this.state = (1664525 * this.state + 1013904223) >>> 0;
    return this.state / 0x100000000;
  }

  color(): Color {
    return this.next() < 0.5 ? 0 : 1;
  }

  piece(): Piece {
    return [
      [this.color(), this.color()],
      [this.color(), this.color()],
    ];
  }
}
