import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

function displayName(identity: { name?: string; subject: string }): string {
  return identity.name?.trim() || "Anonymous player";
}

export const submitScore = mutation({
  args: { score: v.number() },
  handler: async (ctx, { score }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Authentication required to submit score");

    const safeScore = Math.max(0, Math.floor(score));
    const now = Date.now();
    const existing = await ctx.db
      .query("highScores")
      .withIndex("by_subject", (q) => q.eq("subject", identity.subject))
      .unique();

    if (!existing) {
      const id = await ctx.db.insert("highScores", {
        subject: identity.subject,
        name: displayName(identity),
        avatarUrl: identity.pictureUrl,
        bestScore: safeScore,
        updatedAt: now,
      });
      return { id, bestScore: safeScore, improved: true };
    }

    if (safeScore > existing.bestScore) {
      await ctx.db.patch(existing._id, {
        name: displayName(identity),
        avatarUrl: identity.pictureUrl,
        bestScore: safeScore,
        updatedAt: now,
      });
      return { id: existing._id, bestScore: safeScore, improved: true };
    }

    await ctx.db.patch(existing._id, {
      name: displayName(identity),
      avatarUrl: identity.pictureUrl,
      updatedAt: now,
    });
    return { id: existing._id, bestScore: existing.bestScore, improved: false };
  },
});

export const personalBest = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;

    const existing = await ctx.db
      .query("highScores")
      .withIndex("by_subject", (q) => q.eq("subject", identity.subject))
      .unique();

    return existing
      ? {
          subject: existing.subject,
          name: existing.name,
          avatarUrl: existing.avatarUrl,
          bestScore: existing.bestScore,
          updatedAt: existing.updatedAt,
        }
      : null;
  },
});

export const topN = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    const cappedLimit = Math.max(1, Math.min(10, Math.floor(limit ?? 10)));
    const rows = await ctx.db
      .query("highScores")
      .withIndex("by_best_score")
      .order("desc")
      .take(cappedLimit);

    return rows.map((row) => ({
      subject: row.subject,
      name: row.name,
      avatarUrl: row.avatarUrl,
      bestScore: row.bestScore,
      updatedAt: row.updatedAt,
    }));
  },
});
