import { beforeEach, describe, expect, it } from "vitest";
import { mockStore } from "./mock-store";

// The mock MUST mirror convex/scores.ts exactly (see convex/scores.test.ts) so
// eval (mock) and the real backend enforce identical rules.
describe("mock store mirrors convex scores", () => {
  beforeEach(() => mockStore.reset());

  it("unauthenticated submit is a no-op", () => {
    mockStore.submitScore(50);
    expect(mockStore.topN()).toEqual([]);
    expect(mockStore.personalBest()).toBe(null);
  });

  it("best only rises; one row per subject", () => {
    mockStore.signIn({ subject: "a", name: "Alice" });
    mockStore.submitScore(10);
    expect(mockStore.personalBest()).toBe(10);
    mockStore.submitScore(5); // lower: ignored
    expect(mockStore.personalBest()).toBe(10);
    mockStore.submitScore(20); // higher: raises
    expect(mockStore.personalBest()).toBe(20);
    expect(mockStore.topN()).toEqual([{ subject: "a", name: "Alice", best: 20 }]);
  });

  it("write is attributed to the signed-in identity, never an argument", () => {
    mockStore.signIn({ subject: "bob", name: "Bob" });
    mockStore.submitScore(7);
    mockStore.signIn({ subject: "carol", name: "Carol" });
    expect(mockStore.personalBest()).toBe(null); // carol has no record
    expect(mockStore.topN()).toEqual([{ subject: "bob", name: "Bob", best: 7 }]);
  });

  it("topN is ordered desc and capped at 10", () => {
    for (let i = 0; i < 12; i++) {
      mockStore.signIn({ subject: `u${i}`, name: `U${i}` });
      mockStore.submitScore(i);
    }
    const top = mockStore.topN();
    expect(top.length).toBe(10);
    expect(top.map((t) => t.best)).toEqual([11, 10, 9, 8, 7, 6, 5, 4, 3, 2]);
  });

  it("signOut returns to unauthenticated; prior best is preserved", () => {
    mockStore.signIn({ subject: "a", name: "A" });
    mockStore.submitScore(8);
    mockStore.signOut();
    expect(mockStore.getIdentity()).toBe(null);
    expect(mockStore.personalBest()).toBe(null);
    mockStore.submitScore(100); // no-op while signed out
    mockStore.signIn({ subject: "a", name: "A" });
    expect(mockStore.personalBest()).toBe(8);
  });
});
