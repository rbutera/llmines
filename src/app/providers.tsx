"use client";

import { useMemo, type ReactNode } from "react";
import { ConvexProvider, ConvexReactClient } from "convex/react";
import { SessionProvider } from "next-auth/react";

import { TEST_MODE } from "~/game/test-api/flag";
import { LeaderboardProvider } from "~/game/leaderboard/LeaderboardProvider";
import { TRPCReactProvider } from "~/trpc/react";

function ConvexBoundary({ children }: { children: ReactNode }) {
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  const client = useMemo(
    () =>
      !TEST_MODE && convexUrl
        ? new ConvexReactClient(convexUrl, {
            skipConvexDeploymentUrlCheck: true,
          })
        : null,
    [convexUrl],
  );

  if (!client) return <>{children}</>;
  return <ConvexProvider client={client}>{children}</ConvexProvider>;
}

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <SessionProvider>
      <ConvexBoundary>
        <LeaderboardProvider>
          <TRPCReactProvider>{children}</TRPCReactProvider>
        </LeaderboardProvider>
      </ConvexBoundary>
    </SessionProvider>
  );
}
