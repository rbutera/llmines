"use client";

import { useAuth, useScores } from "./context";

/**
 * Global top-10 leaderboard, read from Convex (or the mock in test mode).
 * Testids: `leaderboard` (container), `leaderboard-row` (one per entry).
 */
export function Leaderboard() {
  const { leaderboard } = useScores();
  const { user } = useAuth();

  return (
    <div
      data-testid="leaderboard"
      className="rounded-xl border border-white/10 bg-white/5 p-4 backdrop-blur"
    >
      <h2 className="mb-3 flex items-center gap-2 text-xs font-semibold tracking-widest text-white/60 uppercase">
        <span className="text-base">🏆</span> Global leaderboard
      </h2>
      {leaderboard.length === 0 ? (
        <p className="py-2 text-sm text-white/40">
          No scores yet — be the first.
        </p>
      ) : (
        <ol className="space-y-1">
          {leaderboard.map((entry, i) => {
            const isMe = user?.name === entry.name;
            return (
              <li
                key={entry.subject}
                data-testid="leaderboard-row"
                className={`flex items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-sm ${
                  isMe ? "bg-[#37e0c9]/10 ring-1 ring-[#37e0c9]/30" : ""
                }`}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span className="w-5 text-right font-mono text-xs text-white/40 tabular-nums">
                    {i + 1}
                  </span>
                  <span className="truncate font-medium text-white/90">
                    {entry.name}
                  </span>
                </span>
                <span className="font-mono font-bold text-[#37e0c9] tabular-nums">
                  {entry.best}
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
