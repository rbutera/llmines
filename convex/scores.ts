import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

function displayName(identity: {
  name?: string;
  preferredUsername?: string;
  nickname?: string;
  email?: string;
}): string {
  return (
    identity.name ??
    identity.preferredUsername ??
    identity.nickname ??
    identity.email ??
    "Player"
  );
}

export const submitScore = mutation({
  args: { score: v.number() },
  returns: v.object({
    personalBest: v.number(),
    improved: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (identity === null) throw new Error("Authentication required");

    const existing = await ctx.db
      .query("scores")
      .withIndex("by_subject", (q) => q.eq("subject", identity.subject))
      .unique();

    const name = displayName(identity);
    const image = identity.pictureUrl;
    const now = Date.now();

    if (existing === null) {
      await ctx.db.insert("scores", {
        subject: identity.subject,
        name,
        image,
        bestScore: args.score,
        updatedAt: now,
      });
      return { personalBest: args.score, improved: true };
    }

    if (args.score > existing.bestScore) {
      await ctx.db.patch(existing._id, {
        name,
        image,
        bestScore: args.score,
        updatedAt: now,
      });
      return { personalBest: args.score, improved: true };
    }

    await ctx.db.patch(existing._id, { name, image, updatedAt: now });
    return { personalBest: existing.bestScore, improved: false };
  },
});

export const personalBest = query({
  args: {},
  returns: v.union(v.number(), v.null()),
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (identity === null) return null;

    const existing = await ctx.db
      .query("scores")
      .withIndex("by_subject", (q) => q.eq("subject", identity.subject))
      .unique();

    return existing?.bestScore ?? null;
  },
});

export const topN = query({
  args: { limit: v.optional(v.number()) },
  returns: v.array(
    v.object({
      subject: v.string(),
      name: v.string(),
      image: v.optional(v.string()),
      score: v.number(),
      updatedAt: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    const limit = Math.max(1, Math.min(args.limit ?? 10, 10));
    const rows = await ctx.db
      .query("scores")
      .withIndex("by_bestScore")
      .order("desc")
      .take(limit);

    return rows.map((row) => ({
      subject: row.subject,
      name: row.name,
      image: row.image,
      score: row.bestScore,
      updatedAt: row.updatedAt,
    }));
  },
});
