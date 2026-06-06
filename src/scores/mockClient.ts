import type {
  LeaderboardEntry,
  ScoreClient,
  ScoreIdentity,
  SubmitScoreResult,
} from "./types";

export class MockScoreClient implements ScoreClient {
  private identity: ScoreIdentity | null = null;
  private readonly rows = new Map<string, LeaderboardEntry>();

  setIdentity(identity: ScoreIdentity | null): void {
    this.identity = identity;
  }

  async topN(): Promise<LeaderboardEntry[]> {
    return [...this.rows.values()]
      .sort((a, b) => b.score - a.score || b.updatedAt - a.updatedAt)
      .slice(0, 10);
  }

  async personalBest(): Promise<number | null> {
    if (!this.identity) return null;
    return this.rows.get(this.identity.subject)?.score ?? null;
  }

  async submitScore(score: number): Promise<SubmitScoreResult | null> {
    if (!this.identity) return null;

    const existing = this.rows.get(this.identity.subject);
    const updatedAt = Date.now();

    if (!existing || score > existing.score) {
      this.rows.set(this.identity.subject, {
        subject: this.identity.subject,
        name: this.identity.name,
        image: this.identity.image,
        score,
        updatedAt,
      });
      return { personalBest: score, improved: true };
    }

    this.rows.set(this.identity.subject, {
      ...existing,
      name: this.identity.name,
      image: this.identity.image,
      updatedAt,
    });
    return { personalBest: existing.score, improved: false };
  }
}
