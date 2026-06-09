/**
 * The signed-in identity as the UI sees it.
 *
 * `subject` is the stable id the SERVER derives the player from
 * (`ctx.auth.getUserIdentity().subject`) — never a client arg.
 *
 * Privacy: we persist ONLY `email` + the chosen `username`. `displayName` is
 * the Google display name available AT sign-in; it is used solely to suggest a
 * username and is NEVER stored. `username` is null until the user has chosen one
 * (i.e. `needsUsername` is true) — that's the cue to show the select screen.
 */
export interface Identity {
  subject: string;
  email: string | null;
  /** Google display name (sign-in only; not persisted). */
  displayName: string | null;
  /** The chosen, leaderboard-visible username, or null if not yet chosen. */
  username: string | null;
}

/** A leaderboard row. `name` is the player's chosen username. */
export interface LeaderboardEntry {
  subject: string;
  name: string;
  best: number;
}

/** Result of a username availability/validity check. */
export interface UsernameCheck {
  available: boolean;
  /** A short user-facing reason when not available, else null. */
  reason: string | null;
}

/** Auth + identity surface consumed by the UI (same shape for mock and real). */
export interface AuthApi {
  user: Identity | null;
  /** Authenticated but no username chosen yet -> show the select screen. */
  needsUsername: boolean;
  /** Begin sign-in (NextAuth Google in real mode; a default identity in mock). */
  signIn: () => void;
  signOut: () => void;
  /** Suggested username for the current user (collision-numbered). Null = n/a. */
  suggestedUsername: string | null;
  /** Validate + check availability of a candidate username (format + uniqueness). */
  checkUsername: (username: string) => UsernameCheck;
  /** Persist the chosen username. Resolves with the stored name; rejects on
   * validation/uniqueness failure (with a user-facing message). */
  chooseUsername: (username: string) => Promise<string>;
}

/** Scores surface consumed by the UI (same shape for mock and real). */
export interface ScoresApi {
  personalBest: number | null;
  leaderboard: LeaderboardEntry[];
  /** Submit a finished run. The player is derived from the signed-in identity;
   * signed out is a no-op. Returns when the write (if any) is applied. */
  submitScore: (score: number) => Promise<void> | void;
}
