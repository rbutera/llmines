import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  highScores: defineTable({
    subject: v.string(),
    name: v.string(),
    avatarUrl: v.optional(v.string()),
    bestScore: v.number(),
    updatedAt: v.number(),
  })
    .index("by_subject", ["subject"])
    .index("by_best_score", ["bestScore"]),
});
