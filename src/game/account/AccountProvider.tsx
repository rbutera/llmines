"use client";

import { TEST_MODE } from "../test-api/flag";
import { MockAccountProvider } from "./MockAccountProvider";
import { RealAccountProvider } from "./RealAccountProvider";

/**
 * Account provider seam. In NEXT_PUBLIC_TEST_MODE the deterministic in-memory
 * mock backs auth + scores (no NextAuth, no Convex, no network); otherwise the
 * real NextAuth + Convex stack does. Consuming components (`useAuth`/`useScores`)
 * are identical across both — only the provider wiring swaps.
 */
export function AccountProvider({ children }: { children: React.ReactNode }) {
  if (TEST_MODE) {
    return <MockAccountProvider>{children}</MockAccountProvider>;
  }
  return <RealAccountProvider>{children}</RealAccountProvider>;
}
