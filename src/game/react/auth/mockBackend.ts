/**
 * Deterministic in-memory scores backend for TEST_MODE (eval). Mirrors the real
 * Convex functions' semantics (one row per user, max-best upsert, top-N) so the
 * same UI runs against it with no server. Never used in a normal build.
 */

export interface LeaderboardRow {
  name: string;
  best: number;
}

interface Row {
  subject: string;
  name: string;
  best: number;
  updatedAt: number;
}

let rows: Row[] = [];
let seq = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export const mockBackend = {
  /** Server-derived-identity upsert: best only improves. Null identity = no write. */
  submitScore(
    identity: { subject: string; name: string } | null,
    score: number,
  ): { best: number } | null {
    if (!identity) return null;
    const now = ++seq;
    const existing = rows.find((r) => r.subject === identity.subject);
    if (!existing) {
      rows = [
        ...rows,
        { subject: identity.subject, name: identity.name, best: score, updatedAt: now },
      ];
      emit();
      return { best: score };
    }
    if (score > existing.best) {
      rows = rows.map((r) =>
        r.subject === identity.subject
          ? { ...r, best: score, name: identity.name, updatedAt: now }
          : r,
      );
      emit();
      return { best: score };
    }
    return { best: existing.best };
  },

  /** Top-N by best desc (tie-break earliest update), one row per user. */
  topN(limit = 10): LeaderboardRow[] {
    return [...rows]
      .sort((a, b) => b.best - a.best || a.updatedAt - b.updatedAt)
      .slice(0, limit)
      .map((r) => ({ name: r.name, best: r.best }));
  },

  /** The given subject's personal best, or null. */
  personalBest(subject: string | null): number | null {
    if (!subject) return null;
    const r = rows.find((x) => x.subject === subject);
    return r ? r.best : null;
  },

  subscribe(cb: () => void): () => void {
    listeners.add(cb);
    return () => listeners.delete(cb);
  },

  /** Reset all state (used between independent test scenarios if needed). */
  reset(): void {
    rows = [];
    seq = 0;
    emit();
  },
};
