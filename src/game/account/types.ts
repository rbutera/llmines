/** Account + leaderboard contract shared by the mock (eval) and real providers. */

export interface AuthUser {
  /** Stable server-derived identity id. */
  subject: string;
  name: string;
  image?: string | null;
}

export interface AuthApi {
  user: AuthUser | null;
  signIn: () => void;
  signOut: () => void;
}

export interface LeaderboardEntry {
  subject: string;
  name: string;
  best: number;
}

export interface ScoresApi {
  personalBest: number | null;
  leaderboard: LeaderboardEntry[];
  submitScore: (score: number) => void;
}
