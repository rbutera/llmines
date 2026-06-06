import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

/** Default leaderboard size. */
const TOP_N = 10;

/** A public leaderboard entry (no internal ids leaked). */
export type LeaderboardEntry = { subject: string; name: string; best: number };

/**
 * Persist a finished run's score for the SIGNED-IN player and keep their
 * personal best.
 *
 * SECURITY: the player is derived from the authenticated identity server-side
 * (`ctx.auth.getUserIdentity()`), never from a client-passed userId. An
 * unauthenticated caller is a no-op — their score is never written (the
 * "unauthenticated users are not on the leaderboard" rule).
 *
 * The personal best only rises: `best` is updated when the new score beats it;
 * the display name is always refreshed.
 */
export const submitScore = mutation({
  args: { score: v.number() },
  handler: async (ctx, { score }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return { written: false as const, best: null };
    }
    const subject = identity.subject;
    const name = identity.name ?? identity.email ?? "Player";

    const existing = await ctx.db
      .query("scores")
      .withIndex("by_subject", (q) => q.eq("subject", subject))
      .unique();

    if (!existing) {
      await ctx.db.insert("scores", {
        subject,
        name,
        best: score,
        updatedAt: Date.now(),
      });
      return { written: true as const, best: score };
    }

    const best = Math.max(existing.best, score);
    await ctx.db.patch(existing._id, { name, best, updatedAt: Date.now() });
    return { written: true as const, best };
  },
});

/** Global leaderboard: top-N players by personal best, highest first. */
export const topN = query({
  args: { n: v.optional(v.number()) },
  handler: async (ctx, { n }): Promise<LeaderboardEntry[]> => {
    const rows = await ctx.db
      .query("scores")
      .withIndex("by_best")
      .order("desc")
      .take(n ?? TOP_N);
    return rows.map((r) => ({ subject: r.subject, name: r.name, best: r.best }));
  },
});

/** The signed-in player's personal best, or null when unauthenticated/none. */
export const personalBest = query({
  args: {},
  handler: async (
    ctx,
  ): Promise<{ name: string; best: number } | null> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const row = await ctx.db
      .query("scores")
      .withIndex("by_subject", (q) => q.eq("subject", identity.subject))
      .unique();
    return row ? { name: row.name, best: row.best } : null;
  },
});
