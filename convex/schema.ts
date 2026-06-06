import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  scores: defineTable({
    subject: v.string(),
    name: v.string(),
    image: v.optional(v.string()),
    bestScore: v.number(),
    updatedAt: v.number(),
  })
    .index("by_subject", ["subject"])
    .index("by_bestScore", ["bestScore"]),
});
