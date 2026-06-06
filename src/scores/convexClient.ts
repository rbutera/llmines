"use client";

import { ConvexReactClient } from "convex/react";
import { api } from "../../convex/_generated/api";
import type {
  LeaderboardEntry,
  ScoreClient,
  ScoreIdentity,
  SubmitScoreResult,
} from "./types";

export class ConvexScoreClient implements ScoreClient {
  private readonly client: ConvexReactClient | null;

  constructor() {
    this.client = process.env.NEXT_PUBLIC_CONVEX_URL
      ? new ConvexReactClient(process.env.NEXT_PUBLIC_CONVEX_URL)
      : null;
  }

  setIdentity(identity: ScoreIdentity | null): void {
    if (!this.client) return;
    if (!identity?.convexToken) {
      this.client.clearAuth();
      return;
    }
    this.client.setAuth(async () => identity.convexToken ?? null);
  }

  async topN(): Promise<LeaderboardEntry[]> {
    if (!this.client) return [];
    return await this.client.query(api.scores.topN, { limit: 10 });
  }

  async personalBest(): Promise<number | null> {
    if (!this.client) return null;
    return await this.client.query(api.scores.personalBest, {});
  }

  async submitScore(score: number): Promise<SubmitScoreResult | null> {
    if (!this.client) return null;
    return await this.client.mutation(api.scores.submitScore, { score });
  }
}
