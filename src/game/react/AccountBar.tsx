"use client";

import { useAuth } from "../account/context";

/** Sign-in / signed-in identity strip. Testids: signin, user-name, signout. */
export function AccountBar() {
  const { user, signIn, signOut } = useAuth();

  if (!user) {
    return (
      <button
        data-testid="signin"
        onClick={signIn}
        className="rounded-lg border border-white/15 bg-white/5 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/10"
      >
        Sign in with Google
      </button>
    );
  }

  return (
    <div className="flex items-center gap-3">
      {user.image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={user.image} alt="" className="h-8 w-8 rounded-full" />
      ) : null}
      <span data-testid="user-name" className="text-sm font-semibold text-white">
        {user.name}
      </span>
      <button
        data-testid="signout"
        onClick={signOut}
        className="rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-semibold text-white/80 transition hover:bg-white/10"
      >
        Sign out
      </button>
    </div>
  );
}
