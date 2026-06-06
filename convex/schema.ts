import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * Sole persistence for high scores + leaderboard. One document per user (keyed
 * by the server-derived identity `subject`) holding their personal best.
 */
export default defineSchema({
  scores: defineTable({
    /** Server-derived stable identity id (ctx.auth.getUserIdentity().subject). */
    subject: v.string(),
    /** Display name from the identity (for leaderboard rows). */
    name: v.string(),
    /** The user's highest score so far. */
    best: v.number(),
    /** Timestamp of the last best update (ranking tie-break). */
    updatedAt: v.number(),
  })
    .index("by_subject", ["subject"])
    .index("by_best", ["best"]),
});
