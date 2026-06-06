"use client";

import {
  ConvexProvider,
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
import { api } from "../../../convex/_generated/api";
import { AuthContext, ScoresContext } from "./context";
import type { AuthApi, Identity, ScoresApi } from "./types";

// Constructed at most once; null when no deployment is configured (e.g. an
// offline build). Lazy so TEST_MODE / no-env paths never touch a live backend.
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
  return (
    <ConvexProvider client={convexClient}>
      <SessionProvider>
        <RealInner>{children}</RealInner>
      </SessionProvider>
    </ConvexProvider>
  );
}

function RealInner({ children }: { children: React.ReactNode }) {
  const { data: session } = useSession();
  const personalBest = useQuery(api.scores.personalBest) ?? null;
  const leaderboardRaw = useQuery(api.scores.topN);
  const submit = useMutation(api.scores.submitScore);

  const user = useMemo<Identity | null>(() => {
    const u = session?.user;
    if (!u) return null;
    const subject =
      (u as { id?: string }).id ?? u.email ?? u.name ?? "unknown";
    return { subject, name: u.name ?? "Player", image: u.image ?? null };
  }, [session]);

  const auth = useMemo<AuthApi>(
    () => ({
      user,
      signIn: () => void nextSignIn("google"),
      signOut: () => void nextSignOut(),
    }),
    [user],
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
      signIn: () => void nextSignIn("google"),
      signOut: () => void nextSignOut(),
    }),
    [],
  );
  const scores = useMemo<ScoresApi>(
    () => ({ personalBest: null, leaderboard: [], submitScore: () => undefined }),
    [],
  );
  return (
    <AuthContext.Provider value={auth}>
      <ScoresContext.Provider value={scores}>{children}</ScoresContext.Provider>
    </AuthContext.Provider>
  );
}
