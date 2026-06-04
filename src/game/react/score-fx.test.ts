import { describe, expect, it } from "vitest";
import {
  BURST_MS,
  easeOutCubic,
  scoreTier,
  tierParticleCount,
  tweenValue,
} from "./score-fx";

describe("scoreTier", () => {
  it("classifies by gain magnitude at the 12 and 24 boundaries", () => {
    expect(scoreTier(0)).toBe("small");
    expect(scoreTier(11)).toBe("small");
    expect(scoreTier(12)).toBe("big");
    expect(scoreTier(23)).toBe("big");
    expect(scoreTier(24)).toBe("huge");
    expect(scoreTier(100)).toBe("huge");
  });
});

describe("tierParticleCount", () => {
  it("escalates with tier", () => {
    expect(tierParticleCount("small")).toBe(6);
    expect(tierParticleCount("big")).toBe(12);
    expect(tierParticleCount("huge")).toBe(20);
  });
});

describe("easeOutCubic", () => {
  it("maps endpoints and clamps out-of-range t", () => {
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(1)).toBe(1);
    expect(easeOutCubic(-5)).toBe(0);
    expect(easeOutCubic(5)).toBe(1);
  });

  it("is monotonic increasing", () => {
    expect(easeOutCubic(0.25)).toBeLessThan(easeOutCubic(0.75));
    expect(easeOutCubic(0.5)).toBeCloseTo(0.875, 6);
  });
});

describe("tweenValue", () => {
  it("returns from at t=0 and to at t=1", () => {
    expect(tweenValue(0, 8, 0)).toBe(0);
    expect(tweenValue(0, 8, 1)).toBe(8);
  });

  it("eases toward the target (eased midpoint)", () => {
    // easeOutCubic(0.5) = 0.875 -> 0 + 8*0.875 = 7
    expect(tweenValue(0, 8, 0.5)).toBeCloseTo(7, 6);
  });
});

describe("BURST_MS", () => {
  it("is a positive duration", () => {
    expect(BURST_MS).toBeGreaterThan(0);
  });
});
