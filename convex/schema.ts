import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * Persistence for high scores + the global leaderboard.
 *
 * One row per authenticated user, keyed by the server-derived `subject`
 * (`ctx.auth.getUserIdentity().subject`). `best` is that user's personal best,
 * updated only when beaten. The leaderboard is the top-N of `best` across rows.
 */
export default defineSchema({
  scores: defineTable({
    /** Stable, server-derived user id (never a client-trusted value). */
    subject: v.string(),
    /** Display name captured from the authenticated identity. */
    name: v.string(),
    /** The user's personal best. */
    best: v.number(),
  })
    .index("by_subject", ["subject"])
    .index("by_best", ["best"]),
});
