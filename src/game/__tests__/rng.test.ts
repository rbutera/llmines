import { describe, it, expect } from "vitest";
import { createRng } from "../rng";

describe("createRng (mulberry32)", () => {
  it("returns values in [0, 1)", () => {
    const rng = createRng(42);
    for (let i = 0; i < 1000; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("produces deterministic output for the same seed", () => {
    const rng1 = createRng(123);
    const rng2 = createRng(123);
    for (let i = 0; i < 100; i++) {
      expect(rng1()).toBe(rng2());
    }
  });

  it("produces different sequences for different seeds", () => {
    const rng1 = createRng(1);
    const rng2 = createRng(2);
    const seq1 = Array.from({ length: 10 }, () => rng1());
    const seq2 = Array.from({ length: 10 }, () => rng2());
    expect(seq1).not.toEqual(seq2);
  });

  it("produces known first values for seed 42", () => {
    const rng = createRng(42);
    // Just capture and pin the first 5 values for regression
    const values = Array.from({ length: 5 }, () => rng());
    // All values should be numbers
    values.forEach((v) => expect(typeof v).toBe("number"));
    // Pin snapshot for determinism regression
    expect(values).toMatchSnapshot();
  });
});
