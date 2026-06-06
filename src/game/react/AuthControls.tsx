"use client";

import { useAuth } from "./providers/AuthProvider";

/**
 * Sign-in / sign-out + identity display. Consumes the auth seam only. Stable
 * testids: `signin`, `signout`, `user-name`.
 */
export function AuthControls() {
  const auth = useAuth();

  if (auth.status === "authenticated") {
    return (
      <div className="flex items-center gap-3">
        {auth.avatar ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={auth.avatar}
            alt=""
            className="h-7 w-7 rounded-full ring-1 ring-white/20"
          />
        ) : null}
        <span data-testid="user-name" className="text-sm font-semibold text-white/90">
          {auth.name ?? "Player"}
        </span>
        <button
          data-testid="signout"
          onClick={auth.signOut}
          className="rounded-lg border border-white/15 px-3 py-1 text-xs font-bold text-white/70 transition hover:bg-white/10"
        >
          Sign out
        </button>
      </div>
    );
  }

  return (
    <button
      data-testid="signin"
      onClick={auth.signIn}
      className="rounded-lg bg-white/10 px-3 py-1 text-xs font-bold text-white transition hover:bg-white/20"
    >
      Sign in with Google
    </button>
  );
}
