import { describe, expect, it } from "vitest";
import { COLS_PER_BEAT } from "../core";
import {
  beatBreathe,
  beatPhase,
  clearBurstCount,
  dropHeat,
} from "./beatFx";

describe("beatFx: beatPhase", () => {
  it("is 0 on the beat (sweepX a multiple of COLS_PER_BEAT)", () => {
    expect(beatPhase(0)).toBe(0);
    expect(beatPhase(COLS_PER_BEAT)).toBeCloseTo(0, 10);
    expect(beatPhase(COLS_PER_BEAT * 4)).toBeCloseTo(0, 10);
  });

  it("is 0.5 at the half-beat", () => {
    expect(beatPhase(COLS_PER_BEAT / 2)).toBeCloseTo(0.5, 10);
  });

  it("always returns a value in [0, 1)", () => {
    for (let x = 0; x <= 16; x += 0.37) {
      const p = beatPhase(x);
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThan(1);
    }
  });
});

describe("beatFx: beatBreathe (gentle, never a strobe)", () => {
  it("returns a flat 1 when disabled", () => {
    expect(beatBreathe(0, 0.5, false)).toBe(1);
    expect(beatBreathe(0.5, 0.5, false)).toBe(1);
  });

  it("peaks at 1+strength on the beat and troughs at 1-strength at the half-beat", () => {
    expect(beatBreathe(0, 0.12, true)).toBeCloseTo(1.12, 10);
    expect(beatBreathe(0.5, 0.12, true)).toBeCloseTo(0.88, 10);
  });

  it("stays within [1-strength, 1+strength] for any phase (bounded swell, no overshoot)", () => {
    const strength = 0.15;
    for (let p = 0; p < 1; p += 0.05) {
      const v = beatBreathe(p, strength, true);
      expect(v).toBeGreaterThanOrEqual(1 - strength - 1e-9);
      expect(v).toBeLessThanOrEqual(1 + strength + 1e-9);
    }
  });

  it("is continuous across the beat boundary (no hard flash/discontinuity)", () => {
    const justBefore = beatBreathe(0.999, 0.15, true);
    const justAfter = beatBreathe(0.001, 0.15, true);
    // The two samples straddle phase 0; they must be within a hair of each other.
    expect(Math.abs(justBefore - justAfter)).toBeLessThan(0.01);
  });
});

describe("beatFx: dropHeat", () => {
  it("is 0 at or below idle velocity (normal gravity must not glow)", () => {
    expect(dropHeat(0)).toBe(0);
    expect(dropHeat(1.4)).toBe(0); // ~700ms/row gravity
    expect(dropHeat(3)).toBe(0);
  });

  it("ramps to 1 at/above the saturation velocity (a real soft drop)", () => {
    expect(dropHeat(14)).toBeCloseTo(1, 10);
    expect(dropHeat(40)).toBe(1);
  });

  it("is monotonic non-decreasing in velocity", () => {
    let prev = -1;
    for (let v = 0; v <= 20; v += 0.5) {
      const h = dropHeat(v);
      expect(h).toBeGreaterThanOrEqual(prev);
      prev = h;
    }
  });

  it("handles non-finite input safely (returns 0, never NaN)", () => {
    expect(dropHeat(Number.NaN)).toBe(0);
    expect(dropHeat(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe("beatFx: clearBurstCount", () => {
  it("is 0 for non-positive clears", () => {
    expect(clearBurstCount(0)).toBe(0);
    expect(clearBurstCount(-2)).toBe(0);
  });

  it("has a floor so even a tiny clear sparks", () => {
    expect(clearBurstCount(1)).toBe(8);
  });

  it("scales with cleared cells", () => {
    expect(clearBurstCount(4)).toBe(24); // 4 * 6
  });

  it("is hard-capped", () => {
    expect(clearBurstCount(1000)).toBe(60);
  });
});
