import { describe, it, expect, beforeEach } from "vitest";
import { LuminesEngine } from "./engine";
import { buildTestApi } from "./testApi";

describe("buildTestApi", () => {
  let api: ReturnType<typeof buildTestApi>;
  beforeEach(() => {
    api = buildTestApi(new LuminesEngine());
  });

  it("exposes the pinned surface", () => {
    for (const m of [
      "seed",
      "state",
      "marked",
      "spawn",
      "tick",
      "sweepNow",
      "sweepProgress",
    ]) {
      expect(typeof (api as Record<string, unknown>)[m]).toBe("function");
    }
  });

  it("spawn + sweepNow scores per the pinned rule", () => {
    api.spawn([[0, 0], [0, 0]]);
    api.spawn([[1, 1], [1, 1]]); // locks the first 2x2 of colour 0
    expect(api.marked()).toHaveLength(4);
    api.sweepNow();
    expect(api.state().score).toBe(4);
  });

  it("seed makes the auto-piece sequence reproducible", () => {
    api.seed(123);
    api.spawn(); // draws from rng
    const a = api.state().grid.map((r) => r.slice());
    const api2 = buildTestApi(new LuminesEngine());
    api2.seed(123);
    api2.spawn();
    expect(api2.state().grid).toEqual(a);
  });
});
