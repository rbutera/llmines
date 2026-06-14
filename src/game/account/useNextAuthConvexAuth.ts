"use client";

import { useSession } from "next-auth/react";
import { useCallback, useMemo } from "react";

/**
 * `useAuth` adapter for `ConvexProviderWithAuth`, backed by the NextAuth (v5)
 * session. Reports the session's loading/authenticated state and fetches the
 * Convex-validatable RS256 token from `/api/convex-token` (server-minted from
 * the session — see that route).
 *
 * `fetchAccessToken({ forceRefreshToken })` always POSTs to the token endpoint
 * (which is `Cache-Control: no-store`); when Convex force-refreshes we also set
 * `cache: "no-store"` on the fetch so no HTTP cache can hand back a stale token.
 */
export function useNextAuthConvexAuth() {
  const { status } = useSession();

  const fetchAccessToken = useCallback(
    async ({
      forceRefreshToken,
    }: {
      forceRefreshToken: boolean;
    }): Promise<string | null> => {
      try {
        const res = await fetch("/api/convex-token", {
          method: "POST",
          cache: forceRefreshToken ? "no-store" : "default",
        });
        if (!res.ok) return null;
        const data = (await res.json()) as { token?: string };
        return data.token ?? null;
      } catch {
        return null;
      }
    },
    [],
  );

  return useMemo(
    () => ({
      isLoading: status === "loading",
      isAuthenticated: status === "authenticated",
      fetchAccessToken,
    }),
    [status, fetchAccessToken],
  );
}
