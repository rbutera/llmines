"use client";

import { useAuth } from "./providers/AuthProvider";
import { useScores } from "./providers/ScoresProvider";

/**
 * Personal best + global top-10 leaderboard, read from the scores seam. Stable
 * testids: `personal-best`, `leaderboard`, `leaderboard-row` (one per entry).
 */
export function LeaderboardPanel() {
  const auth = useAuth();
  const { personalBest, leaderboard } = useScores();

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-white/10 bg-white/5 p-4 backdrop-blur">
      {auth.status === "authenticated" && (
        <div>
          <div className="text-xs tracking-widest text-white/50 uppercase">
            Personal best
          </div>
          <div
            data-testid="personal-best"
            className="mt-1 font-mono text-2xl font-black tabular-nums text-[#37e0c9]"
          >
            {personalBest ?? 0}
          </div>
        </div>
      )}

      <div>
        <div className="text-xs tracking-widest text-white/50 uppercase">
          Leaderboard
        </div>
        <ol data-testid="leaderboard" className="mt-2 flex flex-col gap-1">
          {leaderboard.length === 0 ? (
            <li className="text-sm text-white/40">No scores yet</li>
          ) : (
            leaderboard.map((row, i) => (
              <li
                key={`${row.name}-${i}`}
                data-testid="leaderboard-row"
                className="flex items-center justify-between font-mono text-sm tabular-nums"
              >
                <span className="text-white/80">
                  {i + 1}. {row.name}
                </span>
                <span className="font-bold text-white">{row.best}</span>
              </li>
            ))
          )}
        </ol>
      </div>
    </div>
  );
}
