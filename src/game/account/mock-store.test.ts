import { beforeEach, describe, expect, it } from "vitest";
import { mockStore } from "./mock-store";

// The mock MUST mirror convex/users.ts + convex/scores.ts exactly (see the
// convex/*.test.ts) so the dev/eval seam and the real backend enforce identical
// rules.

const signIn = (
  subject: string,
  displayName: string,
  email = `${subject}@x.com`,
) => mockStore.signIn({ subject, email, displayName });

describe("mock store: identity + username", () => {
  beforeEach(() => mockStore.reset());

  it("a fresh sign-in needs a username; persists only email (no name yet)", () => {
    signIn("g|mark", "Mark Jacobs", "mark@example.com");
    expect(mockStore.needsUsername()).toBe(true);
    const id = mockStore.getIdentity();
    expect(id).toMatchObject({
      subject: "g|mark",
      email: "mark@example.com",
      displayName: "Mark Jacobs",
      username: null,
    });
  });

  it("suggests firstName+lastName from the Google display name", () => {
    signIn("g|mark", "Mark Jacobs");
    expect(mockStore.suggestedUsername()).toBe("MarkJacobs");
  });

  it("numbers the suggestion when the name is taken by someone else", () => {
    signIn("g|m1", "Mark Jacobs");
    mockStore.chooseUsername("MarkJacobs");
    signIn("g|m2", "Mark Jacobs");
    expect(mockStore.suggestedUsername()).toBe("MarkJacobs2");
  });

  it("chooseUsername persists + clears needsUsername", () => {
    signIn("g|mark", "Mark Jacobs");
    mockStore.chooseUsername("GemLord");
    expect(mockStore.needsUsername()).toBe(false);
    expect(mockStore.getIdentity()?.username).toBe("GemLord");
  });

  it("rejects a duplicate username (case-insensitive)", () => {
    signIn("g|a", "A");
    mockStore.chooseUsername("Champion");
    signIn("g|b", "B");
    expect(() => mockStore.chooseUsername("champion")).toThrow(/taken/i);
    expect(mockStore.checkUsername("champion")).toMatchObject({
      available: false,
    });
  });

  it("rejects an invalid username", () => {
    signIn("g|a", "A");
    expect(() => mockStore.chooseUsername("x")).toThrow();
    expect(() => mockStore.chooseUsername("bad@name")).toThrow();
    expect(mockStore.checkUsername("x")).toMatchObject({ available: false });
  });

  it("lets a user re-keep their own name and frees the old one on change", () => {
    signIn("g|a", "A");
    mockStore.chooseUsername("First");
    mockStore.chooseUsername("First"); // own name: allowed
    mockStore.chooseUsername("Second");
    expect(mockStore.getIdentity()?.username).toBe("Second");
    signIn("g|b", "B");
    mockStore.chooseUsername("First"); // freed up
    expect(mockStore.getIdentity()?.username).toBe("First");
  });

  it("an empty/emoji display name suggests a valid fallback", () => {
    signIn("g|x", "🚀🚀");
    const s = mockStore.suggestedUsername();
    expect(s).toBe("Player");
    expect(mockStore.checkUsername(s!)).toMatchObject({ available: true });
  });
});

describe("mock store: scores mirror convex", () => {
  beforeEach(() => mockStore.reset());

  it("unauthenticated submit is a no-op", () => {
    mockStore.submitScore(50);
    expect(mockStore.topN()).toEqual([]);
    expect(mockStore.personalBest()).toBe(null);
  });

  it("best only rises; one row per subject; leaderboard shows the username", () => {
    signIn("g|a", "Alice");
    mockStore.chooseUsername("AceAlice");
    mockStore.submitScore(10);
    expect(mockStore.personalBest()).toBe(10);
    mockStore.submitScore(5); // lower: ignored
    expect(mockStore.personalBest()).toBe(10);
    mockStore.submitScore(20); // higher: raises
    expect(mockStore.personalBest()).toBe(20);
    expect(mockStore.topN()).toEqual([
      { subject: "g|a", name: "AceAlice", best: 20 },
    ]);
  });

  it("write is attributed to the signed-in identity, never an argument", () => {
    signIn("g|bob", "Bob");
    mockStore.chooseUsername("Bobby");
    mockStore.submitScore(7);
    signIn("g|carol", "Carol");
    expect(mockStore.personalBest()).toBe(null); // carol has no record
    expect(mockStore.topN()).toEqual([
      { subject: "g|bob", name: "Bobby", best: 7 },
    ]);
  });

  it("leaderboard reflects a username change retroactively", () => {
    signIn("g|a", "Alice");
    mockStore.chooseUsername("OldName");
    mockStore.submitScore(10);
    mockStore.chooseUsername("NewName");
    expect(mockStore.topN()[0]).toMatchObject({ name: "NewName", best: 10 });
  });

  it("topN is ordered desc and capped at 10", () => {
    for (let i = 0; i < 12; i++) {
      signIn(`u${i}`, `U${i}`);
      mockStore.chooseUsername(`User${i}`);
      mockStore.submitScore(i);
    }
    const top = mockStore.topN();
    expect(top.length).toBe(10);
    expect(top.map((t) => t.best)).toEqual([11, 10, 9, 8, 7, 6, 5, 4, 3, 2]);
  });

  it("signOut returns to unauthenticated; prior best is preserved", () => {
    signIn("g|a", "A");
    mockStore.chooseUsername("Player_A");
    mockStore.submitScore(8);
    mockStore.signOut();
    expect(mockStore.getIdentity()).toBe(null);
    expect(mockStore.personalBest()).toBe(null);
    mockStore.submitScore(100); // no-op while signed out
    signIn("g|a", "A");
    expect(mockStore.personalBest()).toBe(8);
  });
});
