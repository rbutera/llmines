"use client";

import { useAuth, useScores } from "../account/context";

/** Signed-in user's personal best, or a sign-in prompt. Testid: personal-best. */
export function PersonalBest() {
  const { user } = useAuth();
  const { personalBest } = useScores();
  if (!user) {
    return (
      <p data-testid="personal-best" className="text-sm text-white/50">
        Sign in to save your score
      </p>
    );
  }
  return (
    <p data-testid="personal-best" className="text-sm text-white/70">
      Personal best:{" "}
      <span className="font-mono font-bold text-white">{personalBest ?? 0}</span>
    </p>
  );
}
