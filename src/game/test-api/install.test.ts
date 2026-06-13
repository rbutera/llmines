// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { mockStore } from "../account/mock-store";
import { GameController } from "../engine/controller";
import { installTestApi } from "./install";

describe("window.__lumines account seam (TEST_MODE hooks)", () => {
  afterEach(() => {
    mockStore.reset();
    delete window.__lumines;
  });

  it("auth.signIn/out drive the mock identity (needs a username first)", () => {
    const c = new GameController({ testMode: true });
    const uninstall = installTestApi(c);
    const api = window.__lumines!;

    api.auth.signIn({
      subject: "alice",
      displayName: "Alice",
      email: "a@x.com",
    });
    expect(mockStore.getIdentity()).toMatchObject({
      subject: "alice",
      email: "a@x.com",
      displayName: "Alice",
      username: null,
    });
    expect(api.auth.needsUsername()).toBe(true);

    api.auth.signOut();
    expect(mockStore.getIdentity()).toBe(null);
    uninstall();
  });

  it("auth username hooks: suggest -> choose clears needsUsername", () => {
    const c = new GameController({ testMode: true });
    installTestApi(c);
    const api = window.__lumines!;

    api.auth.signIn({
      subject: "alice",
      displayName: "Alice",
      email: "a@x.com",
    });
    expect(api.auth.suggestedUsername()).toBe("Alice");
    api.auth.chooseUsername("AceAlice");
    expect(api.auth.needsUsername()).toBe(false);
    expect(mockStore.getIdentity()?.username).toBe("AceAlice");
  });

  it("signed-in submit writes to the mock; signed-out writes nothing", () => {
    const c = new GameController({ testMode: true });
    installTestApi(c);
    const api = window.__lumines!;

    // Signed out: the unauthenticated rule — nothing persists.
    mockStore.submitScore(500);
    expect(mockStore.topN()).toEqual([]);

    // Signed in + username chosen: submit attributes to that identity, and the
    // leaderboard shows the chosen username.
    api.auth.signIn({ subject: "bob", displayName: "Bob", email: "b@x.com" });
    api.auth.chooseUsername("Bobby");
    mockStore.submitScore(40);
    expect(mockStore.personalBest()).toBe(40);
    expect(mockStore.topN()).toEqual([
      { subject: "bob", name: "Bobby", best: 40 },
    ]);
  });

  it("endGame drives the real game-over path with an exact score", () => {
    const c = new GameController({ testMode: true });
    installTestApi(c);
    window.__lumines!.endGame(777);
    expect(c.testState().gameOver).toBe(true);
    expect(c.testState().score).toBe(777);
  });

  it("getReplay seam exposes the run record; downloadReplay is guarded (no throw)", () => {
    const c = new GameController({ testMode: true, seed: 4242 });
    installTestApi(c);
    const replay = window.__lumines!.getReplay();
    expect(replay.schemaVersion).toBe(1);
    expect(replay.seed).toBe(4242);
    expect(Array.isArray(replay.inputs)).toBe(true);
    // The download seam must not throw even where URL.createObjectURL is absent
    // (jsdom): it guards and no-ops rather than blowing up the game-over screen.
    expect(() => window.__lumines!.downloadReplay()).not.toThrow();
  });
});
