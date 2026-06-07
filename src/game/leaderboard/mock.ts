import type { AuthUser, ScoreEntry } from "./types";

type Listener = () => void;

class Emitter {
  private listeners = new Set<Listener>();
  /** Subscribe; returns an unsubscribe fn (shape for `useSyncExternalStore`). */
  subscribe = (fn: Listener): (() => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  protected emit(): void {
    for (const fn of this.listeners) fn();
  }
}

/**
 * In-memory mock auth. Mirrors the server's identity model: the `subject` is the
 * stable id the backend would derive from `ctx.auth.getUserIdentity()`. Driven
 * deterministically by `window.__lumines.auth` in tests.
 */
export class MockAuth extends Emitter {
  private current: AuthUser | null = null;
  getSnapshot = (): AuthUser | null => this.current;
  signIn = (name: string, subject: string, image?: string | null): void => {
    this.current = { name, subject, image: image ?? null };
    this.emit();
  };
  signOut = (): void => {
    this.current = null;
    this.emit();
  };
}

/**
 * In-memory mock leaderboard. One personal-best row per subject; updates only
 * when beaten — identical rules to the real Convex `submitScore`. A monotonic
 * `version` gives `useSyncExternalStore` a stable primitive snapshot.
 */
export class MockLeaderboard extends Emitter {
  private rows = new Map<string, ScoreEntry>();
  private version = 0;
  /** Cached, stable top-N snapshot (new reference only when data changes). */
  private cachedTop: ScoreEntry[] = [];
  getVersion = (): number => this.version;
  /** Stable snapshot for `useSyncExternalStore`. */
  getTop = (): ScoreEntry[] => this.cachedTop;

  private rebuild(): void {
    this.cachedTop = [...this.rows.values()]
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);
  }

  /** Upsert by subject, improving the personal best only when strictly beaten. */
  submit = (subject: string, name: string, score: number): void => {
    const existing = this.rows.get(subject);
    if (!existing || score > existing.score) {
      this.rows.set(subject, { subject, name, score });
      this.version += 1;
      this.rebuild();
      this.emit();
    }
  };

  top = (n: number): ScoreEntry[] =>
    [...this.rows.values()].sort((a, b) => b.score - a.score).slice(0, n);

  bestOf = (subject: string): number => this.rows.get(subject)?.score ?? 0;

  /** Test/maintenance helper: wipe all rows. */
  reset = (): void => {
    this.rows.clear();
    this.version += 1;
    this.rebuild();
    this.emit();
  };
}

/** Session-singletons so state persists across React re-mounts in TEST_MODE. */
export const mockAuth = new MockAuth();
export const mockLeaderboard = new MockLeaderboard();
