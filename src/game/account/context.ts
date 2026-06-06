"use client";

import { createContext, useContext } from "react";

/** A leaderboard entry (mirrors the Convex `topN` return shape). */
export interface LeaderboardEntry {
  subject: string;
  name: string;
  best: number;
}

/** The signed-in player, or null when unauthenticated. */
export interface AuthUser {
  name: string;
  image?: string | null;
}

export interface AuthApi {
  user: AuthUser | null;
  /** Begin sign-in (real: Google SSO; test: mock identity). */
  signIn: () => void;
  signOut: () => void;
}

export interface ScoresApi {
  /** The signed-in player's personal best, or null. */
  personalBest: { name: string; best: number } | null;
  /** Global top-10, highest first. */
  leaderboard: LeaderboardEntry[];
  /** Persist a finished run's score (no-op server-side when unauthenticated). */
  submitScore: (score: number) => void | Promise<unknown>;
}

const AuthContext = createContext<AuthApi | null>(null);
const ScoresContext = createContext<ScoresApi | null>(null);

export const AuthProviderCtx = AuthContext.Provider;
export const ScoresProviderCtx = ScoresContext.Provider;

export function useAuth(): AuthApi {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AccountProvider");
  return ctx;
}

export function useScores(): ScoresApi {
  const ctx = useContext(ScoresContext);
  if (!ctx) throw new Error("useScores must be used within an AccountProvider");
  return ctx;
}
