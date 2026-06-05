import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  scores: defineTable({
    // `subject` is the stable identity id derived server-side from
    // ctx.auth.getUserIdentity(); never a client argument.
    subject: v.string(),
    name: v.string(),
    best: v.number(),
  })
    .index("by_subject", ["subject"])
    .index("by_best", ["best"]),
});
