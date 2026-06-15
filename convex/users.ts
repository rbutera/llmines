import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import {
  baseSuggestion,
  normalizeUsername,
  numberedCandidate,
  suggestUsernameFor,
  usernameKey,
  validateUsername,
} from "./usernames";

/**
 * Identity functions for the auth/username layer.
 *
 * Privacy: we persist ONLY {email, username}. The Google display name arrives
 * in the JWT (`identity.name`) and is used solely to SUGGEST a username at
 * sign-in; it is never stored. The chosen username is what shows on the
 * leaderboard.
 *
 * Security: every write derives the player from `ctx.auth.getUserIdentity()`
 * server-side. There is no client-passed user id or email to spoof.
 */

/**
 * The current user's identity record (or null when signed out / not yet
 * created). `needsUsername` is true when the user is authenticated but has not
 * chosen a username yet — the client shows the username-select screen.
 */
export const me = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const row = await ctx.db
      .query("users")
      .withIndex("by_subject", (q) => q.eq("subject", identity.subject))
      .unique();
    return {
      subject: identity.subject,
      email: row?.email ?? identity.email ?? null,
      username: row?.username ?? null,
      needsUsername: row == null,
    };
  },
});

/**
 * Suggest a username for the CURRENT user, derived from their Google display
 * name (`identity.name`) with collision numbering against existing usernames.
 * If the user already has a username, that is returned. Signed out -> null.
 */
export const suggestUsername = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const existing = await ctx.db
      .query("users")
      .withIndex("by_subject", (q) => q.eq("subject", identity.subject))
      .unique();
    if (existing) return existing.username;

    // `suggestUsernameFor` wants a SYNC taken-key predicate, but uniqueness
    // lives behind an async index. Pre-warm a cache by probing the EXACT
    // candidates the algorithm forms (root, then numberedCandidate(root, 2..),
    // which share `numberedCandidate` with suggestAvailableUsername so the keys
    // can never drift), stopping at the FIRST free one — which is precisely what
    // the sync pass returns. A safety bound caps a pathological run.
    const root = baseSuggestion(identity.name ?? null);
    const cache = new Map<string, boolean>();
    const probe = async (candidate: string): Promise<boolean> => {
      const key = usernameKey(candidate);
      const hit = await ctx.db
        .query("users")
        .withIndex("by_username_key", (q) => q.eq("usernameKey", key))
        .unique();
      const taken = hit != null;
      cache.set(key, taken);
      return taken;
    };
    if (await probe(root)) {
      for (let n = 2; n <= 1000; n++) {
        if (!(await probe(numberedCandidate(root, n)))) break;
      }
    }

    return suggestUsernameFor(
      identity.name ?? null,
      (key) => cache.get(key) === true,
    );
  },
});

/** Is `username` available (format-valid AND not taken by another user)? */
export const isUsernameAvailable = query({
  args: { username: v.string() },
  handler: async (ctx, { username }) => {
    const reason = validateUsername(username);
    if (reason) return { available: false, reason };
    const identity = await ctx.auth.getUserIdentity();
    const key = usernameKey(username);
    const hit = await ctx.db
      .query("users")
      .withIndex("by_username_key", (q) => q.eq("usernameKey", key))
      .unique();
    // Taken — unless it's the current user's own existing username.
    if (hit && (!identity || hit.subject !== identity.subject)) {
      return { available: false, reason: "That username is taken." };
    }
    return { available: true, reason: null as string | null };
  },
});

/**
 * Choose (or change) the current user's username. Validates format + enforces
 * uniqueness, then upserts the users row with ONLY {email, username, key}. The
 * email comes from the authenticated identity (never a client arg). Returns the
 * stored username on success; throws on validation/uniqueness failure.
 */
export const chooseUsername = mutation({
  args: { username: v.string() },
  handler: async (ctx, { username }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not signed in.");

    const normalized = normalizeUsername(username);
    const reason = validateUsername(normalized);
    if (reason) throw new Error(reason);

    const key = usernameKey(normalized);
    const clash = await ctx.db
      .query("users")
      .withIndex("by_username_key", (q) => q.eq("usernameKey", key))
      .unique();
    if (clash && clash.subject !== identity.subject) {
      throw new Error("That username is taken.");
    }

    const email = identity.email ?? "";
    const existing = await ctx.db
      .query("users")
      .withIndex("by_subject", (q) => q.eq("subject", identity.subject))
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        username: normalized,
        usernameKey: key,
      });
    } else {
      await ctx.db.insert("users", {
        subject: identity.subject,
        email,
        username: normalized,
        usernameKey: key,
      });
    }
    return normalized;
  },
});
