"use client";

import {
  ConvexProvider,
  ConvexReactClient,
  useMutation,
  useQuery,
} from "convex/react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { api } from "../../../../convex/_generated/api";
import { env } from "~/env";
import { mockBackend, type LeaderboardRow } from "~/game/react/auth/mockBackend";
import { TEST_MODE } from "~/game/test-api/flag";
import { useAuth } from "./AuthProvider";

/**
 * Scores data seam. UI consumes `useScores()` — backed by the deterministic
 * in-memory mock (TEST_MODE) or real Convex queries/mutations (normal mode). The
 * submit path always derives the user server-side; `submit` passes only a score.
 */
export interface ScoresValue {
  personalBest: number | null;
  leaderboard: LeaderboardRow[];
  submit: (score: number) => void;
}

const ScoresContext = createContext<ScoresValue | null>(null);

export function useScores(): ScoresValue {
  const value = useContext(ScoresContext);
  if (!value) throw new Error("useScores must be used within a ScoresProvider");
  return value;
}

function MockScoresProvider({ children }: { children: React.ReactNode }) {
  const auth = useAuth();
  const subject = auth.status === "authenticated" ? (auth.subject ?? null) : null;
  const name = auth.name ?? "Player";

  const [leaderboard, setLeaderboard] = useState<LeaderboardRow[]>(() =>
    mockBackend.topN(),
  );
  const [personalBest, setPersonalBest] = useState<number | null>(() =>
    mockBackend.personalBest(subject),
  );

  useEffect(() => {
    const recompute = () => {
      setLeaderboard(mockBackend.topN());
      setPersonalBest(mockBackend.personalBest(subject));
    };
    recompute();
    return mockBackend.subscribe(recompute);
  }, [subject]);

  const submit = useCallback(
    (score: number) => {
      mockBackend.submitScore(subject ? { subject, name } : null, score);
    },
    [subject, name],
  );

  return (
    <ScoresContext.Provider value={{ personalBest, leaderboard, submit }}>
      {children}
    </ScoresContext.Provider>
  );
}

function RealScoresBridge({ children }: { children: React.ReactNode }) {
  const leaderboard = useQuery(api.scores.topN, {}) ?? [];
  const pb = useQuery(api.scores.personalBest, {}) ?? null;
  const submitMut = useMutation(api.scores.submitScore);
  const submit = useCallback(
    (score: number) => {
      void submitMut({ score });
    },
    [submitMut],
  );
  return (
    <ScoresContext.Provider value={{ personalBest: pb, leaderboard, submit }}>
      {children}
    </ScoresContext.Provider>
  );
}

function RealScoresProvider({ children }: { children: React.ReactNode }) {
  const client = useMemo(
    () => new ConvexReactClient(env.NEXT_PUBLIC_CONVEX_URL ?? ""),
    [],
  );
  return (
    <ConvexProvider client={client}>
      <RealScoresBridge>{children}</RealScoresBridge>
    </ConvexProvider>
  );
}

export function ScoresProvider({ children }: { children: React.ReactNode }) {
  if (TEST_MODE) return <MockScoresProvider>{children}</MockScoresProvider>;
  return <RealScoresProvider>{children}</RealScoresProvider>;
}
