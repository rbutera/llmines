import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

const DEFAULT_TOP_N = 10;

/**
 * Persist a finished run's score for the AUTHENTICATED user. The player is
 * derived from `ctx.auth.getUserIdentity()` server-side — never trusted from a
 * client argument. Unauthenticated calls are a no-op (returns null). The stored
 * row keeps the personal best, updated only when strictly beaten.
 */
export const submitScore = mutation({
  args: { score: v.number() },
  handler: async (ctx, { score }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const subject = identity.subject;
    const name = identity.name ?? "Player";
    const existing = await ctx.db
      .query("scores")
      .withIndex("by_subject", (q) => q.eq("subject", subject))
      .unique();
    if (existing === null) {
      await ctx.db.insert("scores", { subject, name, best: score });
      return score;
    }
    if (score > existing.best) {
      await ctx.db.patch(existing._id, { best: score, name });
      return score;
    }
    return existing.best;
  },
});

/** The signed-in user's personal best, or null if unauthenticated / no runs. */
export const personalBest = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const row = await ctx.db
      .query("scores")
      .withIndex("by_subject", (q) => q.eq("subject", identity.subject))
      .unique();
    return row?.best ?? null;
  },
});

/** Global leaderboard: top `n` (default 10) personal bests, descending. */
export const topN = query({
  args: { n: v.optional(v.number()) },
  handler: async (ctx, { n }) => {
    const rows = await ctx.db
      .query("scores")
      .withIndex("by_best")
      .order("desc")
      .take(n ?? DEFAULT_TOP_N);
    return rows.map((r) => ({
      subject: r.subject,
      name: r.name,
      best: r.best,
    }));
  },
});
