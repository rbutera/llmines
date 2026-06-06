"use client";

import {
  ConvexProvider,
  ConvexReactClient,
  useMutation,
  useQuery,
} from "convex/react";
import { SessionProvider, signIn, signOut, useSession } from "next-auth/react";
import { useMemo, useState } from "react";
import { api } from "../../../convex/_generated/api";
import {
  AuthProviderCtx,
  ScoresProviderCtx,
  type AuthApi,
  type ScoresApi,
} from "./context";

/**
 * Real account provider (normal/production build). Wires NextAuth (Google SSO)
 * and a real Convex client, then exposes the SAME `useAuth`/`useScores`
 * contexts the mock provider does — so every consuming component is identical
 * across mock (eval) and real (final pass). This is the ConvexProvider seam:
 * only the injected client differs between modes, never the components or the
 * `convex/scores.ts` functions.
 */
export function RealAccountProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [client] = useState(() => {
    const url = process.env.NEXT_PUBLIC_CONVEX_URL;
    if (!url) {
      throw new Error(
        "NEXT_PUBLIC_CONVEX_URL is required for the real Convex backend.",
      );
    }
    return new ConvexReactClient(url);
  });

  // TODO(real pass): forward the NextAuth identity to Convex via
  // ConvexProviderWithAuth so `ctx.auth.getUserIdentity()` is populated on the
  // deployed backend. The server-derived-user security rule is unchanged and is
  // covered by convex-test (see convex/scores.test.ts).
  return (
    <SessionProvider>
      <ConvexProvider client={client}>
        <RealAuthBridge>
          <RealScoresBridge>{children}</RealScoresBridge>
        </RealAuthBridge>
      </ConvexProvider>
    </SessionProvider>
  );
}

function RealAuthBridge({ children }: { children: React.ReactNode }) {
  const { data: session } = useSession();
  const name = session?.user?.name ?? null;
  const image = session?.user?.image ?? null;

  const auth = useMemo<AuthApi>(
    () => ({
      user: name ? { name, image } : null,
      signIn: () => void signIn("google"),
      signOut: () => void signOut(),
    }),
    [name, image],
  );

  return <AuthProviderCtx value={auth}>{children}</AuthProviderCtx>;
}

function RealScoresBridge({ children }: { children: React.ReactNode }) {
  const leaderboard = useQuery(api.scores.topN, {});
  const personalBest = useQuery(api.scores.personalBest, {});
  const submit = useMutation(api.scores.submitScore);

  const scores = useMemo<ScoresApi>(
    () => ({
      leaderboard: leaderboard ?? [],
      personalBest: personalBest ?? null,
      submitScore: (score: number) => submit({ score }),
    }),
    [leaderboard, personalBest, submit],
  );

  return <ScoresProviderCtx value={scores}>{children}</ScoresProviderCtx>;
}
