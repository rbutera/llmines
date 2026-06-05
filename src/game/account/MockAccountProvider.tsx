"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AuthContext, ScoresContext } from "./context";
import { MockStore } from "./mock-store";
import type { AuthUser, LeaderboardEntry } from "./types";

/**
 * TEST_MODE account provider: an in-memory MockStore behind the same contexts
 * as the real provider, plus the deterministic `window.__lumines.auth` seam so
 * the e2e harness can sign in/out without a real OAuth round-trip.
 */
export function MockAccountProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const storeRef = useRef<MockStore | null>(null);
  storeRef.current ??= new MockStore();
  const store = storeRef.current;

  const [user, setUser] = useState<AuthUser | null>(null);
  const [personalBest, setPersonalBest] = useState<number | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);

  const refresh = useCallback(
    (current: AuthUser | null) => {
      setPersonalBest(store.personalBest(current?.subject ?? null));
      setLeaderboard(store.topN(10));
    },
    [store],
  );

  const signInAs = useCallback(
    (u: AuthUser) => {
      setUser(u);
      refresh(u);
    },
    [refresh],
  );

  const signOut = useCallback(() => {
    setUser(null);
    refresh(null);
  }, [refresh]);

  // Mock mode has no real Google SSO; the visible button signs in a demo user.
  const signIn = useCallback(() => {
    signInAs({ subject: "demo", name: "Demo Player" });
  }, [signInAs]);

  const submitScore = useCallback(
    (score: number) => {
      store.submit(
        user ? { subject: user.subject, name: user.name } : null,
        score,
      );
      refresh(user);
    },
    [store, user, refresh],
  );

  useEffect(() => {
    const w = window as unknown as { __lumines?: Record<string, unknown> };
    w.__lumines = {
      ...(w.__lumines ?? {}),
      auth: {
        signIn: (id: { name: string; subject: string }) =>
          signInAs({ subject: id.subject, name: id.name }),
        signOut,
      },
    };
  }, [signInAs, signOut]);

  const authApi = useMemo(
    () => ({ user, signIn, signOut }),
    [user, signIn, signOut],
  );
  const scoresApi = useMemo(
    () => ({ personalBest, leaderboard, submitScore }),
    [personalBest, leaderboard, submitScore],
  );

  return (
    <AuthContext.Provider value={authApi}>
      <ScoresContext.Provider value={scoresApi}>
        {children}
      </ScoresContext.Provider>
    </AuthContext.Provider>
  );
}
