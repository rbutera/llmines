/**
 * The single time seam for the game.
 *
 * `Clock.now()` returns the current time in **seconds** — the same unit as
 * `AudioContext.currentTime` — so the production audio clock and the test
 * fake clock are interchangeable with no unit conversion.
 *
 * This module is deliberately neutral: it imports nothing from `core/**`, the
 * DOM, `Date`, `performance`, or `AudioContext`. The pure core never reads a
 * clock; the controller is the sole consumer of `Clock`.
 */
export interface Clock {
  /** Current time in seconds (matching `AudioContext.currentTime`). */
  now(): number;
}

/**
 * A manually-advanced clock for deterministic tests. Holds an internal time in
 * seconds; tests `set()` or `advance()` it and `now()` reflects the result.
 *
 * Step-size independence is guaranteed by construction: advancing by a total of
 * `T` in one call yields the same `now()` as advancing by `T` across several
 * calls, because `advance` is plain addition.
 */
export class FakeClock implements Clock {
  private t = 0;

  now(): number {
    return this.t;
  }

  /** Set the absolute time (seconds). */
  set(seconds: number): void {
    this.t = seconds;
  }

  /** Move the clock forward by `seconds`. */
  advance(seconds: number): void {
    this.t += seconds;
  }
}
