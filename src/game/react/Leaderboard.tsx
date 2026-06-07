"use client";

import { useLeaderboard } from "../leaderboard/context";

/**
 * Global top-10 leaderboard plus the signed-in player's personal best. Reads
 * everything from the seam (`entries`, `personalBest`, `user`), so the same
 * component renders against the mock (TEST_MODE) and real Convex backend.
 * Stable testids: `leaderboard`, `leaderboard-row`, `personal-best`.
 */
export function Leaderboard() {
  const { entries, personalBest, user } = useLeaderboard();

  return (
    <div
      data-testid="leaderboard"
      className="rounded-2xl border border-white/10 bg-white/5 p-5 backdrop-blur"
    >
      <div className="mb-3 flex items-baseline justify-between">
        <h3 className="text-sm font-bold tracking-widest text-white/70 uppercase">
          Top 10
        </h3>
        {user ? (
          <span className="text-xs text-white/50">
            Your best:{" "}
            <span data-testid="personal-best" className="font-mono font-bold text-[#37e0c9]">
              {personalBest ?? 0}
            </span>
          </span>
        ) : null}
      </div>

      {entries.length === 0 ? (
        <p className="text-sm text-white/40">No scores yet — be the first.</p>
      ) : (
        <ol className="flex flex-col gap-1">
          {entries.map((entry, i) => (
            <li
              key={entry.subject}
              data-testid="leaderboard-row"
              className="flex items-center justify-between gap-3 rounded-lg px-2 py-1 text-sm odd:bg-white/5"
            >
              <span className="flex items-center gap-2">
                <span className="w-5 text-right font-mono text-white/40">
                  {i + 1}
                </span>
                <span className="font-medium">{entry.name}</span>
              </span>
              <span className="font-mono font-bold tabular-nums">
                {entry.score}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
