"use client";

import { useSyncExternalStore } from "react";
import { AuthContext, ScoresContext } from "./context";
import { mockStore } from "./mock-store";
import type { AuthApi, ScoresApi } from "./types";

/** Default identity used when the `signin` button is clicked in TEST_MODE (the
 * automated suite instead drives `window.__lumines.auth.signIn(...)`). */
const DEFAULT_MOCK_IDENTITY = { subject: "player-local", name: "Player" };

/**
 * TEST_MODE provider: backs `useAuth`/`useScores` with the in-memory mockStore.
 * No network, no env. Re-renders whenever the store changes.
 */
export function MockAccountProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  // The snapshot token re-renders this provider on every store change, so the
  // derived auth/scores below always reflect the latest store state.
  useSyncExternalStore(mockStore.subscribe, mockStore.getVersion, () => 0);

  const auth: AuthApi = {
    user: mockStore.getIdentity(),
    signIn: () => mockStore.signIn(DEFAULT_MOCK_IDENTITY),
    signOut: () => mockStore.signOut(),
  };

  const scores: ScoresApi = {
    personalBest: mockStore.personalBest(),
    leaderboard: mockStore.topN(),
    submitScore: (s: number) => mockStore.submitScore(s),
  };

  return (
    <AuthContext.Provider value={auth}>
      <ScoresContext.Provider value={scores}>{children}</ScoresContext.Provider>
    </AuthContext.Provider>
  );
}
