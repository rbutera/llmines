import { describe, expect, it } from "vitest";
import { FakeClock } from "./clock";

describe("FakeClock", () => {
  it("starts at 0", () => {
    expect(new FakeClock().now()).toBe(0);
  });

  it("reflects set() and advance() in now()", () => {
    const c = new FakeClock();
    c.set(2);
    c.advance(0.5);
    expect(c.now()).toBe(2.5);
  });

  it("reports now() in seconds-compatible units (set t0 then advance dt -> t0+dt)", () => {
    const c = new FakeClock();
    const t0 = 1.25;
    const dt = 0.75;
    c.set(t0);
    c.advance(dt);
    expect(c.now()).toBeCloseTo(t0 + dt, 12);
  });

  it("step-size independence: advance T once == advance T in N steps", () => {
    const T = 1.0;
    const N = 8;

    const oneStep = new FakeClock();
    oneStep.advance(T);

    const manySteps = new FakeClock();
    for (let i = 0; i < N; i++) manySteps.advance(T / N);

    expect(manySteps.now()).toBeCloseTo(oneStep.now(), 12);
  });
});
