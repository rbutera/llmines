"use client";

import { useAuth, useScores } from "./context";

/**
 * Signed-in identity + personal best, or a sign-in affordance. Rendered in the
 * header across all phases. Testids: `signin`, `signout`, `user-name`,
 * `personal-best`.
 */
export function AccountBar() {
  const { user, signIn, signOut } = useAuth();
  const { personalBest } = useScores();

  if (!user) {
    return (
      <div className="flex items-center gap-3">
        <span className="hidden text-xs text-white/50 sm:inline">
          Sign in to save your score
        </span>
        <button
          data-testid="signin"
          onClick={signIn}
          className="rounded-lg bg-white/10 px-3 py-1.5 text-sm font-semibold text-white ring-1 ring-white/15 transition hover:bg-white/15 focus:ring-2 focus:ring-[#37e0c9]/50 focus:outline-none"
        >
          Sign in with Google
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3">
      <div className="text-right">
        <div
          data-testid="user-name"
          className="text-sm font-semibold text-white"
        >
          {user.name}
        </div>
        <div className="text-[11px] text-white/50">
          Best:{" "}
          <span data-testid="personal-best" className="tabular-nums">
            {personalBest ? personalBest.best : 0}
          </span>
        </div>
      </div>
      {user.image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={user.image}
          alt=""
          aria-hidden
          className="h-8 w-8 rounded-full ring-1 ring-white/20"
        />
      ) : (
        <div
          aria-hidden
          className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-[#37e0c9] to-[#ff5fb0] text-sm font-black text-[#04140f]"
        >
          {user.name.charAt(0).toUpperCase()}
        </div>
      )}
      <button
        data-testid="signout"
        onClick={signOut}
        className="rounded-lg bg-white/5 px-3 py-1.5 text-xs font-semibold text-white/70 ring-1 ring-white/10 transition hover:bg-white/10 focus:ring-2 focus:ring-[#ff5fb0]/40 focus:outline-none"
      >
        Sign out
      </button>
    </div>
  );
}
