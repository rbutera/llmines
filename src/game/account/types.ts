/** The signed-in identity. `subject` is the stable id the SERVER derives the
 * player from (`ctx.auth.getUserIdentity().subject`) — never a client arg. */
export interface Identity {
  subject: string;
  name: string;
  image?: string | null;
}

/** A leaderboard row. */
export interface LeaderboardEntry {
  subject: string;
  name: string;
  best: number;
}

/** Auth surface consumed by the UI (same shape for mock and real). */
export interface AuthApi {
  user: Identity | null;
  /** Begin sign-in (NextAuth Google in real mode; a default identity in mock). */
  signIn: () => void;
  signOut: () => void;
}

/** Scores surface consumed by the UI (same shape for mock and real). */
export interface ScoresApi {
  personalBest: number | null;
  leaderboard: LeaderboardEntry[];
  /** Submit a finished run. The player is derived from the signed-in identity;
   * signed out is a no-op. Returns when the write (if any) is applied. */
  submitScore: (score: number) => Promise<void> | void;
}
