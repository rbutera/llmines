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
import { useCallback, useMemo, useState, type ReactNode } from "react";
import { env } from "~/env";
import { api } from "../../../convex/_generated/api";
import { AuthContext, ScoresContext } from "./context";

/**
 * Production provider: NextAuth session + Convex queries/mutations behind the
 * same contexts as the mock. NOTE: the live NextAuth->Convex token bridge
 * (`ConvexProviderWithAuth`) is wired in the real production pass; here we use a
 * plain ConvexProvider so the module compiles offline. Not mounted in TEST_MODE.
 */
function AuthBridge({ children }: { children: ReactNode }) {
  const { data: session } = useSession();
  const sessionUser = session?.user;
  const authApi = useMemo(
    () => ({
      user: sessionUser
        ? {
            subject: sessionUser.email ?? sessionUser.name ?? "user",
            name: sessionUser.name ?? "Player",
            image: sessionUser.image,
          }
        : null,
      signIn: () => void nextSignIn("google"),
      signOut: () => void nextSignOut(),
    }),
    [sessionUser],
  );
  return <AuthContext.Provider value={authApi}>{children}</AuthContext.Provider>;
}

function ScoresBridge({ children }: { children: ReactNode }) {
  const leaderboardQuery = useQuery(api.scores.topN, {});
  const personalBestQuery = useQuery(api.scores.personalBest, {});
  const submit = useMutation(api.scores.submitScore);
  const submitScore = useCallback(
    (score: number) => void submit({ score }),
    [submit],
  );
  const scoresApi = useMemo(
    () => ({
      personalBest: personalBestQuery ?? null,
      leaderboard: leaderboardQuery ?? [],
      submitScore,
    }),
    [personalBestQuery, leaderboardQuery, submitScore],
  );
  return (
    <ScoresContext.Provider value={scoresApi}>
      {children}
    </ScoresContext.Provider>
  );
}

export function RealAccountProvider({ children }: { children: ReactNode }) {
  // Constructed lazily so importing this module in TEST_MODE touches no network.
  const [client] = useState(
    () =>
      new ConvexReactClient(
        env.NEXT_PUBLIC_CONVEX_URL ?? "https://example.convex.cloud",
      ),
  );
  return (
    <SessionProvider>
      <ConvexProvider client={client}>
        <AuthBridge>
          <ScoresBridge>{children}</ScoresBridge>
        </AuthBridge>
      </ConvexProvider>
    </SessionProvider>
  );
}
