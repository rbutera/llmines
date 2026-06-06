export interface LeaderboardEntry {
  subject: string;
  name: string;
  image?: string;
  score: number;
  updatedAt: number;
}

export interface SubmitScoreResult {
  personalBest: number;
  improved: boolean;
}

export interface ScoreIdentity {
  subject: string;
  name: string;
  image?: string;
  convexToken?: string;
}

export interface ScoreClient {
  setIdentity(identity: ScoreIdentity | null): void;
  topN(): Promise<LeaderboardEntry[]>;
  personalBest(): Promise<number | null>;
  submitScore(score: number): Promise<SubmitScoreResult | null>;
}
