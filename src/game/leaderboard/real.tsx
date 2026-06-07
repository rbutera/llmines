"use client";

import {
  ConvexProvider,
  ConvexReactClient,
  useMutation,
  useQuery,
} from "convex/react";
import {
  SessionProvider,
  signIn as nextAuthSignIn,
  signOut as nextAuthSignOut,
  useSession,
} from "next-auth/react";
import { type ReactNode, useCallback, useMemo } from "react";

import { api } from "../../../convex/_generated/api";
import { env } from "~/env";
import { LeaderboardContext } from "./context-shared";
import type { AuthUser, LeaderboardContextValue } from "./types";

/**
 * Module-scope Convex client (browser). Created only when a deployment URL is
 * configured; otherwise the app runs without persistence. Created at module
 * scope (not per-render) so SSR and client agree.
 */
const convexClient = env.NEXT_PUBLIC_CONVEX_URL
  ? new ConvexReactClient(env.NEXT_PUBLIC_CONVEX_URL)
  : null;

function sessionUser(
  session: ReturnType<typeof useSession>["data"],
): AuthUser | null {
  if (!session?.user) return null;
  return {
    subject: session.user.id,
    name: session.user.name ?? session.user.email ?? "Player",
    image: session.user.image,
  };
}

const signInWithGoogle = () => void nextAuthSignIn("google");
const doSignOut = () => void nextAuthSignOut();

/** Real provider backed by Convex queries/mutations. */
function ConvexBacked({ children }: { children: ReactNode }) {
  const { data: session } = useSession();
  const user = sessionUser(session);

  const topN = useQuery(api.scores.topN, { n: 10 });
  const best = useQuery(api.scores.personalBest, {});
  const submit = useMutation(api.scores.submitScore);

  const submitScore = useCallback(
    (score: number) => {
      if (!user) return; // signed out: server ignores it anyway
      void submit({ score });
    },
    [submit, user],
  );

  const value = useMemo<LeaderboardContextValue>(
    () => ({
      user,
      signIn: signInWithGoogle,
      signOut: doSignOut,
      entries: topN ?? [],
      personalBest: best ?? null,
      submitScore,
    }),
    [user, topN, best, submitScore],
  );

  return (
    <LeaderboardContext.Provider value={value}>
      {children}
    </LeaderboardContext.Provider>
  );
}

/** Auth-only fallback when no Convex URL is configured (no persistence). */
function AuthOnly({ children }: { children: ReactNode }) {
  const { data: session } = useSession();
  const user = sessionUser(session);
  const value = useMemo<LeaderboardContextValue>(
    () => ({
      user,
      signIn: signInWithGoogle,
      signOut: doSignOut,
      entries: [],
      personalBest: user ? 0 : null,
      submitScore: () => undefined,
    }),
    [user],
  );
  return (
    <LeaderboardContext.Provider value={value}>
      {children}
    </LeaderboardContext.Provider>
  );
}

export function RealProvider({ children }: { children: ReactNode }) {
  if (!convexClient) {
    return (
      <SessionProvider>
        <AuthOnly>{children}</AuthOnly>
      </SessionProvider>
    );
  }
  return (
    <SessionProvider>
      <ConvexProvider client={convexClient}>
        <ConvexBacked>{children}</ConvexBacked>
      </ConvexProvider>
    </SessionProvider>
  );
}
