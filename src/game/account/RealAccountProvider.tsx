"use client";

import {
  ConvexProviderWithAuth,
  ConvexReactClient,
  useMutation,
  useQuery,
} from "convex/react";
import {
  SessionProvider,
  signIn as nextSignIn,
  signOut as nextSignOut,
  useSession,
} from "next-auth/react";
import { useMemo } from "react";
import { validateUsername } from "../../../convex/usernames";
import { api } from "../../../convex/_generated/api";
import { AuthContext, ScoresContext } from "./context";
import type { AuthApi, Identity, ScoresApi, UsernameCheck } from "./types";
import { useNextAuthConvexAuth } from "./useNextAuthConvexAuth";

// Constructed at most once; null when no deployment is configured (e.g. an
// offline build). Lazy so TEST_MODE / no-env paths never touch a live backend.
//
// Google sign-in (nextauth-v5-migration): Auth.js v5's fetch-based core
// (oauth4webapi + jose) runs the Google handshake natively on the Cloudflare
// Workers runtime — fixing the v4 `OAuthSignin` defect. Convex is wired via
// `ConvexProviderWithAuth` + the `useNextAuthConvexAuth` adapter, which fetches
// a server-minted RS256 JWT from `/api/convex-token`; Convex validates it
// (Custom JWT mode, see convex/auth.config.ts) so `ctx.auth.getUserIdentity()`
// resolves and `submitScore`/`personalBest` are authenticated. Remaining steps
// are EXTERNAL (ops, not code): register the Google redirect URI and set the
// Worker/Convex env vars.
const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
const convexClient = convexUrl ? new ConvexReactClient(convexUrl) : null;

/** Real backend: NextAuth session + Convex queries/mutations behind the seam. */
export function RealAccountProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  if (!convexClient) {
    // No Convex configured: render a signed-out stub so the app still works
    // (sign-in + leaderboard require a real deployment / the real pass).
    return <DisabledAccountProvider>{children}</DisabledAccountProvider>;
  }
  // SessionProvider is OUTSIDE ConvexProviderWithAuth so the useAuth adapter
  // (useNextAuthConvexAuth -> useSession) can read the session.
  return (
    <SessionProvider>
      <ConvexAuthedProvider>
        <RealInner>{children}</RealInner>
      </ConvexAuthedProvider>
    </SessionProvider>
  );
}

/** Convex client wired to the NextAuth-backed token adapter. */
function ConvexAuthedProvider({ children }: { children: React.ReactNode }) {
  if (!convexClient) return <>{children}</>;
  return (
    <ConvexProviderWithAuth client={convexClient} useAuth={useNextAuthConvexAuth}>
      {children}
    </ConvexProviderWithAuth>
  );
}

function RealInner({ children }: { children: React.ReactNode }) {
  const { data: session } = useSession();
  const me = useQuery(api.users.me);
  const suggested = useQuery(api.users.suggestUsername) ?? null;
  const personalBest = useQuery(api.scores.personalBest) ?? null;
  const leaderboardRaw = useQuery(api.scores.topN);
  const choose = useMutation(api.users.chooseUsername);
  const submit = useMutation(api.scores.submitScore);

  const user = useMemo<Identity | null>(() => {
    const u = session?.user;
    if (!u) return null;
    const subject = u.id ?? u.email ?? u.name ?? "unknown";
    return {
      subject,
      email: me?.email ?? u.email ?? null,
      displayName: u.name ?? null,
      username: me?.username ?? null,
    };
  }, [session, me]);

  const auth = useMemo<AuthApi>(
    () => ({
      user,
      // Authenticated session but no users-row username yet.
      needsUsername: !!session?.user && (me == null || me.needsUsername),
      signIn: () => void nextSignIn("google"),
      signOut: () => void nextSignOut(),
      suggestedUsername: suggested,
      // Client-side FORMAT check (uniqueness is enforced authoritatively by the
      // chooseUsername mutation, which throws on a clash — the screen surfaces
      // that error). A live availability query is also exposed server-side via
      // api.users.isUsernameAvailable for callers that want eager feedback.
      checkUsername: (u: string): UsernameCheck => {
        const reason = validateUsername(u);
        return reason
          ? { available: false, reason }
          : { available: true, reason: null };
      },
      chooseUsername: async (u: string) => {
        return await choose({ username: u });
      },
    }),
    [user, session, me, suggested, choose],
  );

  const scores = useMemo<ScoresApi>(
    () => ({
      personalBest,
      leaderboard: leaderboardRaw ?? [],
      submitScore: async (s: number) => {
        await submit({ score: s });
      },
    }),
    [personalBest, leaderboardRaw, submit],
  );

  return (
    <AuthContext.Provider value={auth}>
      <ScoresContext.Provider value={scores}>{children}</ScoresContext.Provider>
    </AuthContext.Provider>
  );
}

/** Signed-out stub used when no Convex deployment is configured. */
function DisabledAccountProvider({ children }: { children: React.ReactNode }) {
  const auth = useMemo<AuthApi>(
    () => ({
      user: null,
      needsUsername: false,
      signIn: () => void nextSignIn("google"),
      signOut: () => void nextSignOut(),
      suggestedUsername: null,
      checkUsername: (u: string): UsernameCheck => {
        const reason = validateUsername(u);
        return reason
          ? { available: false, reason }
          : { available: true, reason: null };
      },
      chooseUsername: async () => {
        throw new Error("Sign-in is not configured.");
      },
    }),
    [],
  );
  const scores = useMemo<ScoresApi>(
    () => ({
      personalBest: null,
      leaderboard: [],
      submitScore: () => undefined,
    }),
    [],
  );
  return (
    <AuthContext.Provider value={auth}>
      <ScoresContext.Provider value={scores}>{children}</ScoresContext.Provider>
    </AuthContext.Provider>
  );
}
