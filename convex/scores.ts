import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

/** Default leaderboard size. */
const DEFAULT_TOP_N = 10;

/** A leaderboard entry as returned to the client. */
export interface ScoreEntry {
  subject: string;
  name: string;
  score: number;
}

/**
 * Submit a finished run's score for the CURRENT authenticated user.
 *
 * Security (review gate): the user is derived server-side from
 * `ctx.auth.getUserIdentity()`. The client never passes a user id, so a client
 * cannot write to another user's row. Unauthenticated callers are a no-op (the
 * "scores are not saved when signed out" rule). The personal best updates only
 * when the new score is strictly greater.
 */
export const submitScore = mutation({
  args: { score: v.number() },
  handler: async (ctx, { score }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      // Signed out: never written.
      return { written: false, best: 0 };
    }
    const subject = identity.subject;
    const name = identity.name ?? identity.email ?? "Player";

    const existing = await ctx.db
      .query("scores")
      .withIndex("by_subject", (q) => q.eq("subject", subject))
      .unique();

    if (!existing) {
      await ctx.db.insert("scores", { subject, name, best: score });
      return { written: true, best: score };
    }
    if (score > existing.best) {
      await ctx.db.patch(existing._id, { best: score, name });
      return { written: true, best: score };
    }
    // Not beaten: keep the existing personal best.
    return { written: false, best: existing.best };
  },
});

/** Global leaderboard: top-N personal bests across all users, highest first. */
export const topN = query({
  args: { n: v.optional(v.number()) },
  handler: async (ctx, { n }): Promise<ScoreEntry[]> => {
    const limit = n ?? DEFAULT_TOP_N;
    const rows = await ctx.db
      .query("scores")
      .withIndex("by_best")
      .order("desc")
      .take(limit);
    return rows.map((r) => ({ subject: r.subject, name: r.name, score: r.best }));
  },
});

/** The current authenticated user's personal best (or null when signed out). */
export const personalBest = query({
  args: {},
  handler: async (ctx): Promise<number | null> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const existing = await ctx.db
      .query("scores")
      .withIndex("by_subject", (q) => q.eq("subject", identity.subject))
      .unique();
    return existing ? existing.best : 0;
  },
});
