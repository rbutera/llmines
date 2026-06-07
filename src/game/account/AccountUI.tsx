"use client";

import { useAuth, useScores } from "./context";

/** Header account control: `signin` when signed out; avatar + `user-name` +
 * `signout` when signed in. */
export function AccountBar() {
  const { user, signIn, signOut } = useAuth();

  if (!user) {
    return (
      <button
        data-testid="signin"
        onClick={signIn}
        className="flex items-center gap-2 rounded-lg border border-[#a855f7]/25 bg-[#a855f7]/[0.08] px-4 py-2 text-sm font-semibold text-white/90 transition hover:bg-[#a855f7]/15 focus:ring-2 focus:ring-[#c45cff]/40 focus:outline-none"
      >
        <GoogleGlyph />
        Sign in
      </button>
    );
  }

  return (
    <div className="flex items-center gap-3">
      {user.image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={user.image}
          alt=""
          className="h-8 w-8 rounded-full ring-1 ring-white/20"
        />
      ) : (
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-[#a855f7] to-[#c45cff] text-sm font-black text-white">
          {user.name.charAt(0).toUpperCase()}
        </div>
      )}
      <span data-testid="user-name" className="text-sm font-semibold text-white/90">
        {user.name}
      </span>
      <button
        data-testid="signout"
        onClick={signOut}
        className="rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-semibold text-white/70 transition hover:bg-white/10 focus:ring-2 focus:ring-[#c45cff]/40 focus:outline-none"
      >
        Sign out
      </button>
    </div>
  );
}

/** The signed-in player's personal best (or a prompt to sign in to save). */
export function PersonalBest() {
  const { user, signIn } = useAuth();
  const { personalBest } = useScores();

  if (!user) {
    return (
      <p className="text-sm text-white/50">
        <button
          onClick={signIn}
          className="font-semibold text-[#c45cff] underline-offset-2 hover:underline"
        >
          Sign in
        </button>{" "}
        to save your scores.
      </p>
    );
  }

  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-4">
      <div className="text-xs tracking-widest text-white/50 uppercase">
        Personal best
      </div>
      <div
        data-testid="personal-best"
        className="mt-1 font-mono text-3xl font-black tabular-nums text-[#d8b4fe]"
      >
        {personalBest ?? 0}
      </div>
    </div>
  );
}

/** Global top-10 leaderboard, one `leaderboard-row` per entry. */
export function Leaderboard() {
  const { leaderboard } = useScores();

  return (
    <div
      data-testid="leaderboard"
      className="rounded-xl border border-white/10 bg-white/5 p-4"
    >
      <div className="mb-3 text-xs tracking-widest text-white/50 uppercase">
        Global top 10
      </div>
      {leaderboard.length === 0 ? (
        <p className="text-sm text-white/40">No scores yet — be the first!</p>
      ) : (
        <ol className="flex flex-col gap-1">
          {leaderboard.map((entry, i) => (
            <li
              key={entry.subject}
              data-testid="leaderboard-row"
              className="flex items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-sm odd:bg-white/5"
            >
              <span className="flex items-center gap-2">
                <span className="w-5 text-right font-mono text-white/40">
                  {i + 1}
                </span>
                <span className="font-semibold text-white/90">{entry.name}</span>
              </span>
              <span className="font-mono font-black tabular-nums text-[#d8b4fe]">
                {entry.best}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function GoogleGlyph() {
  return (
    <span
      aria-hidden
      className="flex h-4 w-4 items-center justify-center rounded-full bg-white text-[10px] font-black text-[#4285F4]"
    >
      G
    </span>
  );
}
