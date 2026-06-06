import type { Identity, LeaderboardEntry } from "./types";

interface Row {
  subject: string;
  name: string;
  best: number;
}

/**
 * In-memory, subscribable store that mirrors `convex/scores.ts` EXACTLY so the
 * mock (eval) and the real Convex backend enforce identical rules:
 *  - at most one row per subject,
 *  - `best` only rises (updates when beaten),
 *  - `submitScore` derives the player from the signed-in identity (never an
 *    argument), so signed-out submits are a no-op — the same security rule the
 *    server enforces via `ctx.auth.getUserIdentity()`.
 * Used by `MockAccountProvider` and the TEST_MODE `window.__lumines` hooks.
 */
class MockStore {
  private rows = new Map<string, Row>();
  private identity: Identity | null = null;
  private version = 0;
  private listeners = new Set<() => void>();

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  /** Monotonic snapshot token for `useSyncExternalStore`. */
  getVersion = (): number => this.version;

  getIdentity = (): Identity | null => this.identity;

  private bump(): void {
    this.version++;
    for (const fn of this.listeners) fn();
  }

  signIn(identity: Identity): void {
    this.identity = identity;
    this.bump();
  }

  signOut(): void {
    this.identity = null;
    this.bump();
  }

  /** Mirrors `submitScore`: uses the signed-in identity, best-only-rises. */
  submitScore(score: number): void {
    const id = this.identity;
    if (!id) return; // unauthenticated: no write
    const existing = this.rows.get(id.subject);
    if (!existing) {
      this.rows.set(id.subject, {
        subject: id.subject,
        name: id.name,
        best: score,
      });
    } else if (score > existing.best) {
      existing.best = score;
      existing.name = id.name;
    }
    this.bump();
  }

  personalBest(): number | null {
    const id = this.identity;
    if (!id) return null;
    return this.rows.get(id.subject)?.best ?? null;
  }

  topN(n = 10): LeaderboardEntry[] {
    return [...this.rows.values()]
      .sort((a, b) => b.best - a.best)
      .slice(0, n)
      .map((r) => ({ subject: r.subject, name: r.name, best: r.best }));
  }

  /** Test helper: wipe everything (rows + identity). */
  reset(): void {
    this.rows.clear();
    this.identity = null;
    this.bump();
  }
}

/** Shared singleton — the provider and the test hooks drive the same store. */
export const mockStore = new MockStore();
export type { MockStore };
