/** The authenticated player as surfaced to the UI. */
export interface AuthUser {
  /** Stable, server-derived id (NextAuth subject). Never a client-trusted arg. */
  subject: string;
  name: string;
  image?: string | null;
}

/** A leaderboard entry (one per user, their personal best). */
export interface ScoreEntry {
  subject: string;
  name: string;
  score: number;
}

/**
 * The seam consumed by all UI. Backed by either the in-memory mock (TEST_MODE)
 * or the real Convex + NextAuth layer — components never know which.
 */
export interface LeaderboardContextValue {
  /** Current user, or null when signed out. */
  user: AuthUser | null;
  /** Begin sign-in (real: Google OAuth; mock: a local identity). */
  signIn: () => void;
  /** Sign out. */
  signOut: () => void;
  /** Global top-N leaderboard (highest first). */
  entries: ScoreEntry[];
  /** The signed-in user's personal best, or null when signed out. */
  personalBest: number | null;
  /**
   * Submit a finished run's score. The user is taken from the current
   * authenticated identity (server-derived); signed-out submits are ignored.
   */
  submitScore: (score: number) => void;
}
