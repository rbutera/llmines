"use client";

import type { ReactNode } from "react";
import { TEST_MODE } from "../test-api/flag";
import { MockAccountProvider } from "./MockAccountProvider";
import { RealAccountProvider } from "./RealAccountProvider";

/** Swaps the deterministic mock (TEST_MODE) for the real NextAuth+Convex stack. */
export function AccountProvider({ children }: { children: ReactNode }) {
  return TEST_MODE ? (
    <MockAccountProvider>{children}</MockAccountProvider>
  ) : (
    <RealAccountProvider>{children}</RealAccountProvider>
  );
}
