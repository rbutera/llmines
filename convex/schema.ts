import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * Persistence for identity + high scores + the global leaderboard.
 *
 * `users`: one row per authenticated identity. We persist ONLY the email and
 * the chosen username (NO other Google PII — the display name is used at
 * sign-in to suggest a username and then discarded). `usernameKey` is the
 * case-folded uniqueness key (see convex/usernames.ts). Rows are keyed/looked
 * up by the authenticated identity `subject` (NEVER a client-passed id).
 *
 * `scores`: one row per user, keyed by `subject`. `best` only ever rises. The
 * leaderboard joins the username from `users` so the displayed name is always
 * the user's CURRENT chosen username, not a copy frozen at submit time.
 */
export default defineSchema({
  users: defineTable({
    subject: v.string(),
    email: v.string(),
    username: v.string(),
    // Case-folded, whitespace-collapsed uniqueness key for `username`.
    usernameKey: v.string(),
  })
    // Identity lookup: "who is the current user / does this subject exist".
    .index("by_subject", ["subject"])
    // Email uniqueness ("has this Google account signed in before").
    .index("by_email", ["email"])
    // Username uniqueness / collision checks.
    .index("by_username_key", ["usernameKey"]),

  scores: defineTable({
    subject: v.string(),
    // Display name snapshot kept for backward compatibility + as a fallback when
    // a score predates the users table; the leaderboard prefers the live
    // username from `users`.
    name: v.string(),
    best: v.number(),
  })
    // Upsert / personal-best lookup by the authenticated identity.
    .index("by_subject", ["subject"])
    // Leaderboard ordering (top-N by best descending).
    .index("by_best", ["best"]),
});
