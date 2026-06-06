import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * Persistence for high scores + the global leaderboard. One row per user,
 * keyed by the authenticated identity `subject` (NEVER a client-passed id).
 * `best` is the user's all-time best and only ever rises.
 */
export default defineSchema({
  scores: defineTable({
    subject: v.string(),
    name: v.string(),
    best: v.number(),
  })
    // Upsert / personal-best lookup by the authenticated identity.
    .index("by_subject", ["subject"])
    // Leaderboard ordering (top-N by best descending).
    .index("by_best", ["best"]),
});
