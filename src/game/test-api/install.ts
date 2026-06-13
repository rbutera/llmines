import type { Piece, PublicState } from "../core";
import { mockStore } from "../account/mock-store";
import type { GameController, ReplayRecord } from "../engine/controller";

/** Deterministic auth hooks (TEST_MODE only) — drive the mock identity. */
export interface LuminesAuthApi {
  /**
   * Mock a Google sign-in. `subject` is the server-derived id; `displayName` is
   * the Google display name used to suggest a username (never persisted);
   * `email` is the only PII persisted. After this the player still needs to
   * choose a username (see `chooseUsername`).
   */
  signIn(payload: {
    subject: string;
    displayName: string;
    email?: string;
  }): void;
  /** Return to the unauthenticated state. */
  signOut(): void;
  /** The collision-numbered username suggestion for the current identity. */
  suggestedUsername(): string | null;
  /** Whether the current identity still needs to choose a username. */
  needsUsername(): boolean;
  /** Choose/change the username (validated + unique). Throws on failure. */
  chooseUsername(username: string): string;
}

/** The deterministic interface exposed at `window.__lumines` in test mode. */
export interface LuminesTestApi {
  seed(n: number): void;
  state(): PublicState;
  marked(): { row: number; col: number }[];
  spawn(piece: Piece): void;
  tick(): void;
  sweepNow(): void;
  sweepProgress(dtMs: number): void;
  /** Simulate a FRESH, deliberate soft-drop press (ends a spawn-hold). */
  pressSoftDrop(): void;
  /** Simulate a FRESH, deliberate hard-drop press (ends a spawn-hold). */
  pressHardDrop(): void;
  /** Deterministic auth control against the mock backend. */
  auth: LuminesAuthApi;
  /** End the current game with an exact final score via the REAL game-over
   * path (submits to the mock when signed in; writes nothing when signed out). */
  endGame(score: number): void;
  /**
   * Additive: advance the injected clock by `dtMs` and run one logical sweep
   * frame. In addition to (not a replacement for) `sweepProgress`.
   */
  clockAdvance(dtMs: number): void;
  /** Additive: mark a settled cell as a chain special (coord = row*COLS+col). */
  setSpecial(row: number, col: number): void;
  /** Additive: push the sweep tempo (BPM); latched at the next pass boundary. */
  setTempo(bpm: number): void;
  /**
   * Dev/test-only: force every subsequently spawned piece to carry a chain
   * special (a gem), so the clear cascade can be triggered on demand. Pass
   * `false` (or omit) to restore natural generation. Does not affect determinism
   * while off.
   */
  forceGem(on?: boolean): void;
  /**
   * Audit A8 replay seam: the current run's replay record `{ schemaVersion, seed,
   * inputs }`. Seed + ordered inputs reproduce the run.
   */
  getReplay(): ReplayRecord;
  /**
   * Serialise the replay record to JSON and trigger a browser download. Browser-
   * only (uses a Blob + anchor); a no-op when no DOM is available (SSR/tests).
   * A minimal dev/game-over export affordance for A8.
   */
  downloadReplay(): void;
}

declare global {
  interface Window {
    __lumines?: LuminesTestApi;
  }
}

/**
 * Serialise a replay record to JSON and trigger a browser download (audit A8).
 * Browser-only: guards on `document`/`URL.createObjectURL` so it is a safe no-op
 * under SSR or the test/Node environment. Never runs in the pure core.
 */
export function downloadReplay(replay: ReplayRecord): void {
  if (
    typeof document === "undefined" ||
    typeof URL === "undefined" ||
    typeof URL.createObjectURL !== "function"
  ) {
    return; // no DOM (SSR / tests): no-op
  }
  const json = JSON.stringify(replay, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `llmines-replay-${replay.seed}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/**
 * Install the test interface onto `window`. Called ONLY when
 * NEXT_PUBLIC_TEST_MODE=1 (see flag.ts); never invoked in a normal build, so
 * `window.__lumines` stays undefined in production.
 */
export function installTestApi(controller: GameController): () => void {
  if (typeof window === "undefined") return () => undefined;
  const api: LuminesTestApi = {
    seed: (n) => controller.testSeed(n),
    state: () => controller.testState(),
    marked: () => controller.testMarked(),
    spawn: (piece) => controller.testSpawn(piece),
    tick: () => controller.testTick(),
    sweepNow: () => controller.testSweepNow(),
    sweepProgress: (dtMs) => controller.testSweepProgress(dtMs),
    pressSoftDrop: () => controller.testPressSoftDrop(),
    pressHardDrop: () => controller.testPressHardDrop(),
    auth: {
      signIn: (payload) =>
        mockStore.signIn({
          subject: payload.subject,
          displayName: payload.displayName,
          email: payload.email ?? `${payload.subject}@test.local`,
        }),
      signOut: () => mockStore.signOut(),
      suggestedUsername: () => mockStore.suggestedUsername(),
      needsUsername: () => mockStore.needsUsername(),
      chooseUsername: (username) => mockStore.chooseUsername(username),
    },
    endGame: (score) => controller.testEndGame(score),
    clockAdvance: (dtMs) => controller.testClockAdvance(dtMs),
    setSpecial: (row, col) => controller.testSetSpecial(row, col),
    setTempo: (bpm) => controller.testSetTempo(bpm),
    forceGem: (on = true) => controller.setForceGem(on),
    getReplay: () => controller.getReplay(),
    downloadReplay: () => downloadReplay(controller.getReplay()),
  };
  window.__lumines = api;
  return () => {
    if (window.__lumines === api) delete window.__lumines;
  };
}
