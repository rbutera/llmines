import type { LeaderboardEntry } from "./context";

/**
 * Deterministic in-memory mock of the Convex scores backend + auth identity,
 * used ONLY in NEXT_PUBLIC_TEST_MODE (the eval harness). It mirrors the real
 * `convex/scores.ts` logic exactly:
 *  - one row per identity `subject` holding the personal best,
 *  - the personal best only rises,
 *  - the player is derived from the (mock) signed-in identity, never a caller
 *    argument, so an unauthenticated `submitScore` is a no-op.
 *
 * It is a plain external store (subscribe + getSnapshot) so React can read it
 * via useSyncExternalStore, and the `window.__lumines.auth.*` / `endGame`
 * hooks can drive it. The real path uses Convex instead and never touches this.
 */

export interface MockIdentity {
  subject: string;
  name: string;
}

export interface MockSnapshot {
  identity: MockIdentity | null;
  personalBest: { name: string; best: number } | null;
  leaderboard: LeaderboardEntry[];
}

const TOP_N = 10;

const rows = new Map<string, LeaderboardEntry>();
let identity: MockIdentity | null = null;
const listeners = new Set<() => void>();
let snapshot: MockSnapshot = recompute();

function recompute(): MockSnapshot {
  const leaderboard = [...rows.values()]
    .sort((a, b) => b.best - a.best)
    .slice(0, TOP_N);
  const personalBest = identity
    ? (() => {
        const row = rows.get(identity.subject);
        return row ? { name: row.name, best: row.best } : null;
      })()
    : null;
  return { identity, personalBest, leaderboard };
}

function emit(): void {
  snapshot = recompute();
  for (const fn of listeners) fn();
}

// Arrow-function properties so they can be passed by reference (e.g. to
// useSyncExternalStore) without `this` binding concerns.
export const mockStore = {
  subscribe: (fn: () => void): (() => void) => {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },

  getSnapshot: (): MockSnapshot => snapshot,

  /** Mock-authenticate as this identity (the test seam for Google sign-in). */
  signIn: (id: MockIdentity): void => {
    identity = id;
    emit();
  },

  signOut: (): void => {
    identity = null;
    emit();
  },

  /**
   * Submit a finished run's score. Derives the player from the signed-in mock
   * identity; unauthenticated => not written. Personal best only rises.
   */
  submitScore: (score: number): { written: boolean; best: number | null } => {
    if (!identity) return { written: false, best: null };
    const { subject, name } = identity;
    const existing = rows.get(subject);
    const best = existing ? Math.max(existing.best, score) : score;
    rows.set(subject, { subject, name, best });
    emit();
    return { written: true, best };
  },

  /** Test-only reset between runs (not used by the app). */
  __reset: (): void => {
    rows.clear();
    identity = null;
    emit();
  },
};
