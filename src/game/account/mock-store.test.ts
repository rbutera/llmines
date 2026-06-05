import { describe, expect, it } from "vitest";
import { MockStore } from "./mock-store";

describe("MockStore", () => {
  it("submit is a no-op when unauthenticated", () => {
    const s = new MockStore();
    expect(s.submit(null, 100)).toBe(null);
    expect(s.topN()).toEqual([]);
    expect(s.personalBest(null)).toBe(null);
  });

  it("keeps personal best, only rising", () => {
    const s = new MockStore();
    const me = { subject: "me", name: "Me" };
    expect(s.submit(me, 100)).toBe(100);
    expect(s.submit(me, 40)).toBe(100);
    expect(s.submit(me, 250)).toBe(250);
    expect(s.personalBest("me")).toBe(250);
  });

  it("isolates identities by subject", () => {
    const s = new MockStore();
    s.submit({ subject: "a", name: "A" }, 10);
    s.submit({ subject: "b", name: "B" }, 20);
    expect(s.personalBest("a")).toBe(10);
    expect(s.personalBest("b")).toBe(20);
  });

  it("topN returns best descending, capped at n", () => {
    const s = new MockStore();
    s.submit({ subject: "a", name: "A" }, 10);
    s.submit({ subject: "b", name: "B" }, 30);
    s.submit({ subject: "c", name: "C" }, 20);
    expect(s.topN(2).map((r) => r.best)).toEqual([30, 20]);
    expect(s.topN(2).map((r) => r.name)).toEqual(["B", "C"]);
  });
});
