"use client";

import { createContext, useContext } from "react";
import type { AuthApi, ScoresApi } from "./types";

export const AuthContext = createContext<AuthApi | null>(null);
export const ScoresContext = createContext<ScoresApi | null>(null);

export function useAuth(): AuthApi {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used within an AccountProvider");
  return value;
}

export function useScores(): ScoresApi {
  const value = useContext(ScoresContext);
  if (!value)
    throw new Error("useScores must be used within an AccountProvider");
  return value;
}
