"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  signIn as nextAuthSignIn,
  signOut as nextAuthSignOut,
  useSession,
} from "next-auth/react";

import { TEST_MODE } from "../test-api/flag";

export interface LeaderboardUser {
  subject: string;
  name: string;
  avatarUrl?: string;
}

export interface LeaderboardEntry extends LeaderboardUser {
  bestScore: number;
  updatedAt: number;
}

interface SubmitResult {
  saved: boolean;
  bestScore: number | null;
  improved: boolean;
}

interface LeaderboardContextValue {
  user: LeaderboardUser | null;
  personalBest: number | null;
  leaderboard: LeaderboardEntry[];
  submitScore: (score: number) => Promise<SubmitResult>;
  signIn: () => void;
  signOut: () => void;
  mockSignIn: (user: LeaderboardUser) => void;
  mockSignOut: () => void;
}

const LeaderboardContext = createContext<LeaderboardContextValue | null>(null);

function normalizeScore(score: number): number {
  return Math.max(0, Math.floor(score));
}

function sortLeaderboard(rows: LeaderboardEntry[]): LeaderboardEntry[] {
  return [...rows]
    .sort((a, b) => b.bestScore - a.bestScore || a.updatedAt - b.updatedAt)
    .slice(0, 10);
}

export function LeaderboardProvider({ children }: { children: ReactNode }) {
  const { data: session } = useSession();
  const [mockUser, setMockUser] = useState<LeaderboardUser | null>(null);
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);

  const sessionUser = session?.user
    ? {
        subject:
          (session.user as { id?: string }).id ??
          session.user.email ??
          session.user.name ??
          "unknown",
        name: session.user.name ?? "Player",
        avatarUrl: session.user.image ?? undefined,
      }
    : null;
  const user = TEST_MODE ? mockUser : sessionUser;

  const personalBest = useMemo(() => {
    if (!user) return null;
    return (
      entries.find((entry) => entry.subject === user.subject)?.bestScore ?? null
    );
  }, [entries, user]);

  const submitScore = useCallback(
    async (score: number): Promise<SubmitResult> => {
      if (!user) return { saved: false, bestScore: null, improved: false };

      const safeScore = normalizeScore(score);
      let result: SubmitResult = {
        saved: true,
        bestScore: safeScore,
        improved: true,
      };

      setEntries((current) => {
        const existing = current.find(
          (entry) => entry.subject === user.subject,
        );
        if (existing && safeScore <= existing.bestScore) {
          result = {
            saved: true,
            bestScore: existing.bestScore,
            improved: false,
          };
          return current.map((entry) =>
            entry.subject === user.subject
              ? {
                  ...entry,
                  name: user.name,
                  avatarUrl: user.avatarUrl,
                  updatedAt: Date.now(),
                }
              : entry,
          );
        }

        const nextEntry: LeaderboardEntry = {
          ...user,
          bestScore: safeScore,
          updatedAt: Date.now(),
        };
        result = { saved: true, bestScore: safeScore, improved: true };
        const withoutUser = current.filter(
          (entry) => entry.subject !== user.subject,
        );
        return sortLeaderboard([...withoutUser, nextEntry]);
      });

      return result;
    },
    [user],
  );

  const signIn = useCallback(() => {
    if (TEST_MODE) {
      setMockUser({ subject: "demo", name: "Demo Player" });
      return;
    }
    void nextAuthSignIn("google");
  }, []);

  const signOut = useCallback(() => {
    if (TEST_MODE) {
      setMockUser(null);
      return;
    }
    void nextAuthSignOut();
  }, []);

  const mockSignIn = useCallback((nextUser: LeaderboardUser) => {
    setMockUser(nextUser);
  }, []);

  const mockSignOut = useCallback(() => {
    setMockUser(null);
  }, []);

  const leaderboard = useMemo(() => sortLeaderboard(entries), [entries]);

  const value: LeaderboardContextValue = useMemo(
    () => ({
      user,
      personalBest,
      leaderboard,
      submitScore,
      signIn,
      signOut,
      mockSignIn,
      mockSignOut,
    }),
    [
      user,
      personalBest,
      leaderboard,
      submitScore,
      signIn,
      signOut,
      mockSignIn,
      mockSignOut,
    ],
  );

  return (
    <LeaderboardContext.Provider value={value}>
      {children}
    </LeaderboardContext.Provider>
  );
}

export function useLeaderboard() {
  const value = useContext(LeaderboardContext);
  if (!value) throw new Error("useLeaderboard must be used within provider");
  return value;
}
