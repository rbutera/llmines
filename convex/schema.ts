import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * Single source of persistence for the leaderboard (Convex; no other DB).
 *
 * One row per player, keyed by the authenticated identity `subject` (the stable
 * id the server derives from `ctx.auth.getUserIdentity()` — never a value the
 * client passes). `best` holds the player's personal best; the global
 * leaderboard is the top-N rows by `best`.
 */
export default defineSchema({
  scores: defineTable({
    /** Server-derived auth identity id (NextAuth/Convex `identity.subject`). */
    subject: v.string(),
    /** Display name, refreshed from the identity on each submit. */
    name: v.string(),
    /** Personal best score. */
    best: v.number(),
    /** Last update time (ms). */
    updatedAt: v.number(),
  })
    .index("by_subject", ["subject"])
    .index("by_best", ["best"]),
});
