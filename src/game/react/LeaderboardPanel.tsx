"use client";

import { useLeaderboard } from "../leaderboard/LeaderboardProvider";

export function LeaderboardPanel({
  compact = false,
  framed = true,
}: {
  compact?: boolean;
  framed?: boolean;
}) {
  const leaderboardState = useLeaderboard();
  const { user, personalBest, leaderboard } = leaderboardState;

  return (
    <div
      className={
        framed
          ? "rounded-xl border border-white/10 bg-white/5 p-4 backdrop-blur"
          : ""
      }
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-xs tracking-widest text-white/50 uppercase">
            Player
          </div>
          {user ? (
            <div className="mt-2 flex items-center gap-2">
              {user.avatarUrl && (
                <img
                  alt=""
                  src={user.avatarUrl}
                  className="h-7 w-7 rounded-full ring-1 ring-white/20"
                />
              )}
              <span
                data-testid="user-name"
                className="truncate text-sm font-bold text-white"
              >
                {user.name}
              </span>
            </div>
          ) : (
            <p className="mt-2 text-sm text-white/65">
              Sign in to save scores.
            </p>
          )}
        </div>
        {user ? (
          <button
            data-testid="signout"
            onClick={() => leaderboardState.signOut()}
            className="rounded-md border border-white/15 px-3 py-2 text-xs font-bold text-white/85 transition hover:border-[#ff5fb0]/70 hover:text-white"
          >
            Sign out
          </button>
        ) : (
          <button
            data-testid="signin"
            onClick={() => leaderboardState.signIn()}
            className="rounded-md bg-[#37e0c9] px-3 py-2 text-xs font-black text-[#04140f] transition hover:brightness-110"
          >
            Sign in
          </button>
        )}
      </div>

      <div className="mt-4">
        <div className="text-xs tracking-widest text-white/50 uppercase">
          Personal best
        </div>
        <div
          data-testid="personal-best"
          className="mt-1 font-mono text-2xl font-black text-[#fff2a8] tabular-nums"
        >
          {personalBest ?? 0}
        </div>
      </div>

      {!user && (
        <div className="mt-3 rounded-md border border-[#fff2a8]/20 bg-[#fff2a8]/10 px-3 py-2 text-xs text-[#fff2a8]">
          Scores from guest runs are not saved.
        </div>
      )}

      <div className={compact ? "mt-4" : "mt-5"}>
        <div className="text-xs tracking-widest text-white/50 uppercase">
          Global top 10
        </div>
        <ol data-testid="leaderboard" className="mt-2 space-y-1">
          {leaderboard.length === 0 ? (
            <li className="text-sm text-white/45">No saved scores yet.</li>
          ) : (
            leaderboard.map((entry, idx) => (
              <li
                key={entry.subject}
                data-testid="leaderboard-row"
                className="grid grid-cols-[1.5rem_1fr_auto] items-center gap-2 rounded-md bg-white/5 px-2 py-1.5 text-sm"
              >
                <span className="font-mono text-white/45">{idx + 1}</span>
                <span className="truncate text-white/80">{entry.name}</span>
                <span className="font-mono font-black text-white tabular-nums">
                  {entry.bestScore}
                </span>
              </li>
            ))
          )}
        </ol>
      </div>
    </div>
  );
}
