import { describe, expect, it } from "vitest";
import {
  BIG_THRESHOLD,
  countUpDurationMs,
  fxTier,
  type FxTier,
} from "./score-effects";

/**
 * Pure unit tests for the score-effects tier helper. No DOM — runs in the
 * default node Vitest env. Drives US2 (intensity scaling) and US3 (no effect on
 * non-positive deltas).
 */

describe("fxTier", () => {
  it("is 'none' for zero or negative deltas (no celebration; e.g. restart)", () => {
    expect(fxTier(0)).toBe<FxTier>("none");
    expect(fxTier(-4)).toBe<FxTier>("none");
  });

  it("is 'modest' for a small positive delta (e.g. a single 2x2 square = 4)", () => {
    expect(fxTier(1)).toBe<FxTier>("modest");
    expect(fxTier(4)).toBe<FxTier>("modest");
    expect(fxTier(BIG_THRESHOLD - 1)).toBe<FxTier>("modest");
  });

  it("is 'big' at/above the big threshold (multi-square clears)", () => {
    expect(fxTier(BIG_THRESHOLD)).toBe<FxTier>("big");
    expect(fxTier(BIG_THRESHOLD + 8)).toBe<FxTier>("big");
    expect(fxTier(100)).toBe<FxTier>("big");
  });
});

describe("countUpDurationMs", () => {
  it("returns a positive, clamped duration that does not shrink as the delta grows", () => {
    const small = countUpDurationMs(1);
    const mid = countUpDurationMs(12);
    const huge = countUpDurationMs(10000);
    expect(small).toBeGreaterThan(0);
    expect(mid).toBeGreaterThanOrEqual(small);
    expect(huge).toBeGreaterThanOrEqual(mid);
    // clamped to a sane ceiling (never an absurd count-up)
    expect(huge).toBeLessThanOrEqual(2000);
  });

  it("is non-negative even for a zero/negative delta", () => {
    expect(countUpDurationMs(0)).toBeGreaterThanOrEqual(0);
    expect(countUpDurationMs(-5)).toBeGreaterThanOrEqual(0);
  });
});
