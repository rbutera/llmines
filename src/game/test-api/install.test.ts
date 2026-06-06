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

  it("auth.signIn/out drive the mock identity", () => {
    const c = new GameController({ testMode: true });
    const uninstall = installTestApi(c);
    const api = window.__lumines!;

    api.auth.signIn({ name: "Alice", subject: "alice" });
    expect(mockStore.getIdentity()).toEqual({ name: "Alice", subject: "alice" });

    api.auth.signOut();
    expect(mockStore.getIdentity()).toBe(null);
    uninstall();
  });

  it("signed-in submit writes to the mock; signed-out writes nothing", () => {
    const c = new GameController({ testMode: true });
    installTestApi(c);
    const api = window.__lumines!;

    // Signed out: the unauthenticated rule — nothing persists.
    mockStore.submitScore(500);
    expect(mockStore.topN()).toEqual([]);

    // Signed in via the hook: submit attributes to that identity.
    api.auth.signIn({ name: "Bob", subject: "bob" });
    mockStore.submitScore(40);
    expect(mockStore.personalBest()).toBe(40);
    expect(mockStore.topN()).toEqual([{ subject: "bob", name: "Bob", best: 40 }]);
  });

  it("endGame drives the real game-over path with an exact score", () => {
    const c = new GameController({ testMode: true });
    installTestApi(c);
    window.__lumines!.endGame(777);
    expect(c.testState().gameOver).toBe(true);
    expect(c.testState().score).toBe(777);
  });
});
