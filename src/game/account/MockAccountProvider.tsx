"use client";

import { useSyncExternalStore } from "react";
import { AuthContext, ScoresContext } from "./context";
import { mockStore } from "./mock-store";
import type { AuthApi, ScoresApi } from "./types";

/** Default Google payload used when the `signin` button is clicked in TEST_MODE
 * (the automated suite instead drives `window.__lumines.auth.signIn(...)`). */
const DEFAULT_MOCK_SIGNIN = {
  subject: "player-local",
  email: "player@local.test",
  displayName: "Player One",
};

/**
 * TEST_MODE / dev-seam provider: backs `useAuth`/`useScores` with the in-memory
 * mockStore. No network, no env. Re-renders whenever the store changes. This is
 * the seam used to exercise the full username flow + screens locally without a
 * Convex deployment or a live Google OAuth client.
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
    needsUsername: mockStore.needsUsername(),
    signIn: () => mockStore.signIn(DEFAULT_MOCK_SIGNIN),
    signOut: () => mockStore.signOut(),
    suggestedUsername: mockStore.suggestedUsername(),
    checkUsername: (u: string) => mockStore.checkUsername(u),
    chooseUsername: async (u: string) => mockStore.chooseUsername(u),
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
