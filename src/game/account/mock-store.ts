import type { LeaderboardEntry } from "./types";

export interface MockIdentity {
  subject: string;
  name: string;
}

/**
 * In-memory mirror of `convex/scores.ts` for TEST_MODE. One row per subject;
 * unauthenticated submit is a no-op; personal best only rises. Pure + sync.
 */
export class MockStore {
  private readonly rows = new Map<string, LeaderboardEntry>();

  submit(identity: MockIdentity | null, score: number): number | null {
    if (!identity) return null;
    const existing = this.rows.get(identity.subject);
    if (!existing) {
      this.rows.set(identity.subject, {
        subject: identity.subject,
        name: identity.name,
        best: score,
      });
      return score;
    }
    if (score > existing.best) {
      existing.best = score;
      existing.name = identity.name;
    }
    return existing.best;
  }

  personalBest(subject: string | null): number | null {
    if (!subject) return null;
    return this.rows.get(subject)?.best ?? null;
  }

  topN(n = 10): LeaderboardEntry[] {
    return [...this.rows.values()]
      .sort((a, b) => b.best - a.best)
      .slice(0, n)
      .map((r) => ({ ...r }));
  }
}
