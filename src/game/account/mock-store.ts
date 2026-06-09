import {
  normalizeUsername,
  suggestUsernameFor,
  usernameKey,
  validateUsername,
} from "../../../convex/usernames";
import type { Identity, LeaderboardEntry, UsernameCheck } from "./types";

/** Raw Google sign-in payload (display name + email), pre-username. */
export interface SignInPayload {
  subject: string;
  email: string;
  /** Google display name — used to suggest a username, never persisted. */
  displayName: string;
}

interface ScoreRow {
  subject: string;
  best: number;
}

interface UserRow {
  subject: string;
  email: string;
  username: string;
  usernameKey: string;
}

/**
 * In-memory, subscribable store that mirrors `convex/users.ts` + `scores.ts`
 * EXACTLY, so the mock (dev/eval seam) and the real Convex backend enforce
 * identical rules:
 *  - identity persists ONLY {email, username} (the Google display name is used
 *    to suggest a username, then discarded),
 *  - username is unique (case-insensitive) + format-validated,
 *  - a new sign-in has no username yet (`needsUsername`), driving the select
 *    screen,
 *  - at most one score row per subject, `best` only rises,
 *  - `submitScore` derives the player from the signed-in identity (never an
 *    argument); signed-out submits are a no-op,
 *  - the leaderboard shows the player's CURRENT username.
 *
 * Used by `MockAccountProvider` and the TEST_MODE `window.__lumines` hooks.
 */
class MockStore {
  private scores = new Map<string, ScoreRow>();
  private users = new Map<string, UserRow>(); // by subject
  private session: {
    subject: string;
    email: string;
    displayName: string;
  } | null = null;
  private version = 0;
  private listeners = new Set<() => void>();

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  /** Monotonic snapshot token for `useSyncExternalStore`. */
  getVersion = (): number => this.version;

  private bump(): void {
    this.version++;
    for (const fn of this.listeners) fn();
  }

  private isKeyTaken = (key: string): boolean => {
    for (const u of this.users.values()) if (u.usernameKey === key) return true;
    return false;
  };

  /** Sign in with a Google payload. No username yet -> select screen. */
  signIn(payload: SignInPayload): void {
    this.session = {
      subject: payload.subject,
      email: payload.email,
      displayName: payload.displayName,
    };
    this.bump();
  }

  signOut(): void {
    this.session = null;
    this.bump();
  }

  /** The current identity as the UI sees it (null when signed out). */
  getIdentity(): Identity | null {
    const s = this.session;
    if (!s) return null;
    const row = this.users.get(s.subject);
    return {
      subject: s.subject,
      email: row?.email ?? s.email,
      displayName: s.displayName,
      username: row?.username ?? null,
    };
  }

  /** Authenticated but no username chosen yet. */
  needsUsername(): boolean {
    const s = this.session;
    if (!s) return false;
    return !this.users.has(s.subject);
  }

  /** Collision-numbered suggestion from the Google display name (or current). */
  suggestedUsername(): string | null {
    const s = this.session;
    if (!s) return null;
    const existing = this.users.get(s.subject);
    if (existing) return existing.username;
    return suggestUsernameFor(s.displayName, this.isKeyTaken);
  }

  /** Format-validate + uniqueness-check a candidate username. */
  checkUsername(username: string): UsernameCheck {
    const reason = validateUsername(username);
    if (reason) return { available: false, reason };
    const key = usernameKey(username);
    const hit = [...this.users.values()].find((u) => u.usernameKey === key);
    if (hit && hit.subject !== this.session?.subject) {
      return { available: false, reason: "That username is taken." };
    }
    return { available: true, reason: null };
  }

  /** Choose/change the username (validated + unique). Throws on failure. */
  chooseUsername(username: string): string {
    const s = this.session;
    if (!s) throw new Error("Not signed in.");
    const normalized = normalizeUsername(username);
    const reason = validateUsername(normalized);
    if (reason) throw new Error(reason);
    const key = usernameKey(normalized);
    const clash = [...this.users.values()].find((u) => u.usernameKey === key);
    if (clash && clash.subject !== s.subject) {
      throw new Error("That username is taken.");
    }
    this.users.set(s.subject, {
      subject: s.subject,
      email: s.email,
      username: normalized,
      usernameKey: key,
    });
    this.bump();
    return normalized;
  }

  /** Mirrors `submitScore`: uses the signed-in identity, best-only-rises. */
  submitScore(score: number): void {
    const s = this.session;
    if (!s) return; // unauthenticated: no write
    const existing = this.scores.get(s.subject);
    if (!existing) {
      this.scores.set(s.subject, { subject: s.subject, best: score });
    } else if (score > existing.best) {
      existing.best = score;
    }
    this.bump();
  }

  personalBest(): number | null {
    const s = this.session;
    if (!s) return null;
    return this.scores.get(s.subject)?.best ?? null;
  }

  /** Display name for the leaderboard: the player's current username, else "—". */
  private displayFor(subject: string): string {
    return this.users.get(subject)?.username ?? "—";
  }

  topN(n = 10): LeaderboardEntry[] {
    return [...this.scores.values()]
      .sort((a, b) => b.best - a.best)
      .slice(0, n)
      .map((r) => ({
        subject: r.subject,
        name: this.displayFor(r.subject),
        best: r.best,
      }));
  }

  /** Test helper: wipe everything (scores + users + session). */
  reset(): void {
    this.scores.clear();
    this.users.clear();
    this.session = null;
    this.bump();
  }
}

/** Shared singleton — the provider and the test hooks drive the same store. */
export const mockStore = new MockStore();
export type { MockStore };
