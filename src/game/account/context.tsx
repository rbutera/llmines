"use client";

import { createContext, useContext } from "react";
import type { AuthApi, ScoresApi } from "./types";

/** The single seam: components consume auth/scores through these contexts,
 * which `AccountProvider` fills from either the mock or the real backend. */
export const AuthContext = createContext<AuthApi | null>(null);
export const ScoresContext = createContext<ScoresApi | null>(null);

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
