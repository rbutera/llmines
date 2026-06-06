"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useAuth } from "~/auth/AuthProvider";
import { TEST_MODE } from "~/game/test-api/flag";
import { ConvexScoreClient } from "./convexClient";
import { MockScoreClient } from "./mockClient";
import type { LeaderboardEntry, ScoreClient } from "./types";

interface ScoreContextValue {
  leaderboard: LeaderboardEntry[];
  personalBest: number | null;
  refreshScores: () => Promise<void>;
  submitScore: (score: number) => Promise<void>;
}

const ScoreContext = createContext<ScoreContextValue | null>(null);

function createScoreClient(): ScoreClient {
  return TEST_MODE ? new MockScoreClient() : new ConvexScoreClient();
}

export function ScoreProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const clientRef = useRef<ScoreClient | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [personalBest, setPersonalBest] = useState<number | null>(null);

  clientRef.current ??= createScoreClient();

  const refreshScores = useCallback(async () => {
    const client = clientRef.current;
    if (!client) return;

    const [top, best] = await Promise.all([
      client.topN(),
      user ? client.personalBest() : Promise.resolve(null),
    ]);
    setLeaderboard(top);
    setPersonalBest(best);
  }, [user]);

  useEffect(() => {
    const client = clientRef.current;
    if (!client) return;
    client.setIdentity(user);
    void refreshScores();
  }, [refreshScores, user]);

  const submitScore = useCallback(
    async (score: number) => {
      const client = clientRef.current;
      if (!client || !user) return;
      const result = await client.submitScore(score);
      if (result) setPersonalBest(result.personalBest);
      const top = await client.topN();
      setLeaderboard(top);
    },
    [user],
  );

  const value = useMemo<ScoreContextValue>(
    () => ({
      leaderboard,
      personalBest,
      refreshScores,
      submitScore,
    }),
    [leaderboard, personalBest, refreshScores, submitScore],
  );

  return (
    <ScoreContext.Provider value={value}>{children}</ScoreContext.Provider>
  );
}

export function useScores() {
  const value = useContext(ScoreContext);
  if (value === null)
    throw new Error("useScores must be used inside ScoreProvider");
  return value;
}
