import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

/** How many entries the global leaderboard shows. */
const TOP_N = 10;

/**
 * Submit a finished run's score for the CURRENTLY AUTHENTICATED user.
 *
 * Security: the player is derived from `ctx.auth.getUserIdentity()` server-side
 * — there is no client-passed user id to spoof. With no identity (signed out)
 * this is a no-op, so unauthenticated runs are never persisted.
 *
 * Keeps at most one row per subject; `best` only rises (updates when beaten).
 */
export const submitScore = mutation({
  args: { score: v.number() },
  handler: async (ctx, { score }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null; // signed out: do not persist

    const subject = identity.subject;
    const name = identity.name ?? "Anonymous";
    const existing = await ctx.db
      .query("scores")
      .withIndex("by_subject", (q) => q.eq("subject", subject))
      .unique();

    if (!existing) {
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

/** The authenticated user's personal best, or null (no record / signed out). */
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

/** Global leaderboard: top-N users by best score, descending. */
export const topN = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("scores")
      .withIndex("by_best")
      .order("desc")
      .take(TOP_N);
    return rows.map((r) => ({ subject: r.subject, name: r.name, best: r.best }));
  },
});
