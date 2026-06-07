"use client";

import { createContext, useContext } from "react";
import type { LeaderboardContextValue } from "./types";

/** Shared context object used by both the mock and real providers. */
export const LeaderboardContext = createContext<LeaderboardContextValue | null>(
  null,
);

/** Access the leaderboard/auth seam. Must be used under a provider. */
export function useLeaderboard(): LeaderboardContextValue {
  const ctx = useContext(LeaderboardContext);
  if (!ctx) {
    throw new Error("useLeaderboard must be used within a LeaderboardProvider");
  }
  return ctx;
}
