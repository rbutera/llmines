"use client";

import { useScores } from "../account/context";

/** Global top-10. Testids: leaderboard (container), leaderboard-row (per entry). */
export function Leaderboard() {
  const { leaderboard } = useScores();
  return (
    <div
      data-testid="leaderboard"
      className="rounded-xl border border-white/10 bg-white/5 p-4 backdrop-blur"
    >
      <div className="mb-2 text-xs tracking-widest text-white/50 uppercase">
        Global Top 10
      </div>
      {leaderboard.length === 0 ? (
        <p className="text-sm text-white/40">No scores yet — be the first!</p>
      ) : (
        <ol className="flex flex-col gap-1">
          {leaderboard.map((entry, i) => (
            <li
              key={entry.subject}
              data-testid="leaderboard-row"
              className="flex items-center justify-between gap-3 text-sm"
            >
              <span className="w-5 text-white/40 tabular-nums">{i + 1}</span>
              <span className="flex-1 truncate text-white/90">{entry.name}</span>
              <span className="font-mono font-bold text-[#37e0c9] tabular-nums">
                {entry.best}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
