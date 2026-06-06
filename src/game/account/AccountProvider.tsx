"use client";

import { TEST_MODE } from "../test-api/flag";
import { MockAccountProvider } from "./MockAccountProvider";
import { RealAccountProvider } from "./RealAccountProvider";

/**
 * The dual-mode seam. In `NEXT_PUBLIC_TEST_MODE` the in-memory mock backs
 * auth/scores (deterministic, no network); otherwise the real NextAuth +
 * Convex provider does. The SAME components consume `useAuth`/`useScores`
 * either way — only this wiring swaps.
 */
export function AccountProvider({ children }: { children: React.ReactNode }) {
  if (TEST_MODE) {
    return <MockAccountProvider>{children}</MockAccountProvider>;
  }
  return <RealAccountProvider>{children}</RealAccountProvider>;
}
