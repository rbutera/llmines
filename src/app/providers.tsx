"use client";

import { SessionProvider } from "next-auth/react";
import { type ReactNode } from "react";
import { AuthProvider } from "~/auth/AuthProvider";
import { ScoreProvider } from "~/scores/ScoreProvider";
import { TRPCReactProvider } from "~/trpc/react";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <SessionProvider>
      <AuthProvider>
        <ScoreProvider>
          <TRPCReactProvider>{children}</TRPCReactProvider>
        </ScoreProvider>
      </AuthProvider>
    </SessionProvider>
  );
}
