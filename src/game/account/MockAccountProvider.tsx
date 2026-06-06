"use client";

import { useMemo, useSyncExternalStore } from "react";
import {
  AuthProviderCtx,
  ScoresProviderCtx,
  type AuthApi,
  type ScoresApi,
} from "./context";
import { mockStore } from "./mock-store";

/**
 * TEST_MODE account provider: backs `useAuth`/`useScores` with the in-memory
 * {@link mockStore}, which the `window.__lumines` hooks drive. No NextAuth,
 * no Convex, no network — deterministic for the eval harness.
 */
export function MockAccountProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const snap = useSyncExternalStore(
    (cb) => mockStore.subscribe(cb),
    () => mockStore.getSnapshot(),
    () => mockStore.getSnapshot(),
  );

  const auth = useMemo<AuthApi>(
    () => ({
      user: snap.identity ? { name: snap.identity.name } : null,
      // The deterministic suite authenticates via window.__lumines.auth.signIn;
      // the visible button signs in a default local identity for manual play.
      signIn: () =>
        mockStore.signIn({ name: "Player", subject: "mock|local" }),
      signOut: () => mockStore.signOut(),
    }),
    [snap.identity],
  );

  const scores = useMemo<ScoresApi>(
    () => ({
      personalBest: snap.personalBest,
      leaderboard: snap.leaderboard,
      submitScore: (score: number) => {
        mockStore.submitScore(score);
      },
    }),
    [snap.personalBest, snap.leaderboard],
  );

  return (
    <AuthProviderCtx value={auth}>
      <ScoresProviderCtx value={scores}>{children}</ScoresProviderCtx>
    </AuthProviderCtx>
  );
}
