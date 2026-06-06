import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

/**
 * Persist a finished run's score for the AUTHENTICATED user and keep their
 * personal best (updates only when strictly beaten).
 *
 * SECURITY (review gate): the user is derived from `ctx.auth.getUserIdentity()`
 * server-side. The client NEVER passes a userId/subject — `args` is `{ score }`
 * only. Unauthenticated calls write nothing.
 */
export const submitScore = mutation({
  args: { score: v.number() },
  handler: async (ctx, { score }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null; // unauthenticated rule — no write
    const subject = identity.subject;
    const name = identity.name ?? "Player";
    const now = Date.now();

    const existing = await ctx.db
      .query("scores")
      .withIndex("by_subject", (q) => q.eq("subject", subject))
      .unique();

    if (existing === null) {
      await ctx.db.insert("scores", { subject, name, best: score, updatedAt: now });
      return { best: score };
    }
    if (score > existing.best) {
      await ctx.db.patch(existing._id, { best: score, name, updatedAt: now });
      return { best: score };
    }
    return { best: existing.best }; // not beaten — unchanged
  },
});

/** Global leaderboard: top-N users by best score, highest first. */
export const topN = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    const n = limit ?? 10;
    const rows = await ctx.db
      .query("scores")
      .withIndex("by_best")
      .order("desc")
      .take(n);
    return rows.map((r) => ({ name: r.name, best: r.best }));
  },
});

/** The authenticated caller's personal best, or null. */
export const personalBest = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const row = await ctx.db
      .query("scores")
      .withIndex("by_subject", (q) => q.eq("subject", identity.subject))
      .unique();
    return row ? row.best : null;
  },
});
