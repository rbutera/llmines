"use client";

import { useLeaderboard } from "../leaderboard/context";

/**
 * Auth surface for the seam. Signed-out shows a `signin` control and a prompt
 * that scores aren't saved; signed-in shows the player's `user-name` (+ avatar)
 * and a `signout` control. Backed by the mock (TEST_MODE) or NextAuth (real) —
 * the component is identical across both.
 */
export function AuthPanel() {
  const { user, signIn, signOut } = useLeaderboard();

  if (!user) {
    return (
      <div
        data-testid="auth-panel"
        className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/5 px-4 py-3"
      >
        <span className="text-sm text-white/70">Sign in to save your score</span>
        <button
          data-testid="signin"
          onClick={signIn}
          className="rounded-lg bg-gradient-to-r from-[#37e0c9] to-[#16b89f] px-4 py-2 text-sm font-bold text-[#04140f] transition hover:brightness-110 focus:ring-2 focus:ring-[#37e0c9]/40 focus:outline-none"
        >
          Sign in
        </button>
      </div>
    );
  }

  return (
    <div
      data-testid="auth-panel"
      className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/5 px-4 py-3"
    >
      <div className="flex items-center gap-2">
        {user.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={user.image}
            alt=""
            className="h-7 w-7 rounded-full"
            referrerPolicy="no-referrer"
          />
        ) : null}
        <span data-testid="user-name" className="text-sm font-semibold">
          {user.name}
        </span>
      </div>
      <button
        data-testid="signout"
        onClick={signOut}
        className="rounded-lg border border-white/15 px-4 py-2 text-sm font-semibold text-white/80 transition hover:bg-white/10 focus:ring-2 focus:ring-white/30 focus:outline-none"
      >
        Sign out
      </button>
    </div>
  );
}
