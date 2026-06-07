"use client";

import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useSyncExternalStore,
} from "react";

import type { GameController } from "../engine/controller";
import { TEST_MODE } from "../test-api/flag";
import { LeaderboardContext } from "./context-shared";
import { mockAuth, mockLeaderboard } from "./mock";
import { RealProvider } from "./real";
import { useLeaderboard } from "./context-shared";
import type { AuthUser, ScoreEntry, LeaderboardContextValue } from "./types";

export { useLeaderboard } from "./context-shared";

/** Auth slice of the seam: current user + sign-in/out. */
export function useAuth(): {
  user: AuthUser | null;
  signIn: () => void;
  signOut: () => void;
} {
  const { user, signIn, signOut } = useLeaderboard();
  return { user, signIn, signOut };
}

/** The signed-in user's personal best, or null when signed out. */
export function usePersonalBest(): number | null {
  return useLeaderboard().personalBest;
}

/** Submit a finished run's score (server-derived identity; signed-out no-op). */
export function useSubmitScore(): (score: number) => void {
  return useLeaderboard().submitScore;
}

/** Global top-N leaderboard entries (highest first). */
export function useEntries(): ScoreEntry[] {
  return useLeaderboard().entries;
}

/**
 * Deterministic in-memory provider (TEST_MODE). Mirrors the real Convex rules:
 * server-derived identity, personal-best-only-improves. Also installs the
 * `window.__lumines.auth` + `endGame` test hooks.
 */
function MockProvider({
  controller,
  children,
}: {
  controller: GameController;
  children: ReactNode;
}) {
  const user = useSyncExternalStore(
    mockAuth.subscribe,
    mockAuth.getSnapshot,
    () => null,
  );
  // A monotonic version primitive is the stable snapshot for the store; the
  // derived top-N / personal-best arrays are memoised off it (so getSnapshot
  // never returns a fresh reference each render — required by the hook).
  const version = useSyncExternalStore(
    mockLeaderboard.subscribe,
    mockLeaderboard.getVersion,
    () => 0,
  );

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const entries = useMemo<ScoreEntry[]>(() => mockLeaderboard.top(10), [version]);
  const personalBest = useMemo(
    () => (user ? mockLeaderboard.bestOf(user.subject) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [user, version],
  );

  const submitScore = useCallback((score: number) => {
    // Server-derived identity: use the CURRENT authenticated user, not an arg.
    const u = mockAuth.getSnapshot();
    if (!u) return; // signed out ⇒ never written
    mockLeaderboard.submit(u.subject, u.name, score);
  }, []);

  const signIn = useCallback(
    () => mockAuth.signIn("Player", "local-player"),
    [],
  );
  const signOut = useCallback(() => mockAuth.signOut(), []);

  const value = useMemo<LeaderboardContextValue>(
    () => ({ user, signIn, signOut, entries, personalBest, submitScore }),
    [user, signIn, signOut, entries, personalBest, submitScore],
  );

  // Deterministic test hooks (mock auth + real game-over path via endGame).
  useEffect(() => {
    if (!TEST_MODE || typeof window === "undefined") return;
    const w = (window.__lumines ??= {} as NonNullable<
      typeof window.__lumines
    >);
    w.auth = {
      signIn: ({ name, subject }) => mockAuth.signIn(name, subject),
      signOut: () => mockAuth.signOut(),
    };
    w.endGame = (score: number) => controller.testEndGame(score);
    return () => {
      if (window.__lumines) {
        delete window.__lumines.auth;
        delete window.__lumines.endGame;
      }
    };
  }, [controller]);

  return (
    <LeaderboardContext.Provider value={value}>
      {children}
    </LeaderboardContext.Provider>
  );
}

/**
 * Chooses the data/auth backing: the deterministic mock in TEST_MODE, the real
 * Convex + NextAuth layer otherwise. UI is identical across both.
 */
export function LeaderboardProvider({
  controller,
  children,
}: {
  controller: GameController;
  children: ReactNode;
}) {
  if (TEST_MODE) {
    return <MockProvider controller={controller}>{children}</MockProvider>;
  }
  return <RealProvider>{children}</RealProvider>;
}
