import { describe, expect, it } from "vitest";
import {
  BIG_CLEAR_DELTA,
  burstParticleCount,
  countUpValue,
  scoreIntensity,
  shouldBurst,
  shouldBurstOnClear,
} from "./scoreFx";

describe("score-fx model: shouldBurst", () => {
  it("fires only on a positive change", () => {
    expect(shouldBurst(0, 4)).toBe(true);
    expect(shouldBurst(8, 20)).toBe(true);
  });

  it("does not fire on no change or a reset", () => {
    expect(shouldBurst(4, 4)).toBe(false);
    expect(shouldBurst(12, 0)).toBe(false); // restart
    expect(shouldBurst(5, 3)).toBe(false);
  });
});

describe("score-fx model: shouldBurstOnClear", () => {
  it("fires only when cells were actually cleared this frame", () => {
    expect(shouldBurstOnClear(1)).toBe(true);
    expect(shouldBurstOnClear(4)).toBe(true);
  });

  it("does not fire when no cells cleared (soft-drop / settle score change)", () => {
    expect(shouldBurstOnClear(0)).toBe(false);
    expect(shouldBurstOnClear(-3)).toBe(false);
  });
});

describe("score-fx model: scoreIntensity", () => {
  it("is 0 for non-positive deltas", () => {
    expect(scoreIntensity(0)).toBe(0);
    expect(scoreIntensity(-5)).toBe(0);
  });

  it("scales up with the delta and clamps at 1", () => {
    const small = scoreIntensity(4);
    const big = scoreIntensity(BIG_CLEAR_DELTA);
    expect(small).toBeGreaterThan(0);
    expect(small).toBeLessThan(1);
    expect(big).toBe(1);
    expect(scoreIntensity(BIG_CLEAR_DELTA * 3)).toBe(1); // capped
    expect(big).toBeGreaterThan(small); // bigger clear => more intense
  });
});

describe("score-fx model: countUpValue", () => {
  it("hits the endpoints exactly", () => {
    expect(countUpValue(0, 12, 0)).toBe(0);
    expect(countUpValue(0, 12, 1)).toBe(12);
    expect(countUpValue(0, 12, 2)).toBe(12); // clamped past the end
    expect(countUpValue(0, 12, -1)).toBe(0);
  });

  it("is monotonic and integer between the endpoints", () => {
    let last = -1;
    for (let i = 0; i <= 10; i++) {
      const v = countUpValue(0, 100, i / 10);
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(last);
      last = v;
    }
  });
});

describe("score-fx model: burstParticleCount", () => {
  it("is 0 for non-positive deltas", () => {
    expect(burstParticleCount(0)).toBe(0);
    expect(burstParticleCount(-3)).toBe(0);
  });

  it("scales with the delta and never exceeds the cap", () => {
    const small = burstParticleCount(4);
    const big = burstParticleCount(BIG_CLEAR_DELTA);
    expect(small).toBeGreaterThan(0);
    expect(big).toBeGreaterThan(small);
    expect(big).toBeLessThanOrEqual(40);
    expect(burstParticleCount(1000, 40)).toBe(40); // hard cap
    expect(burstParticleCount(1000, 12)).toBe(12); // custom cap respected
  });
});
