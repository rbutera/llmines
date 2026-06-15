import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

// `import.meta.glob` is provided by Vite at test time; declare it locally so it
// typechecks under pnpm without depending on `vite/client` resolving.
declare global {
  interface ImportMeta {
    glob: (pattern: string) => Record<string, () => Promise<unknown>>;
  }
}

const modules = import.meta.glob("./**/*.ts");

describe("convex users (real functions, in-memory)", () => {
  test("me: signed out is null; new user needs a username", async () => {
    const t = convexTest(schema, modules);
    expect(await t.query(api.users.me, {})).toBe(null);

    const mark = t.withIdentity({
      subject: "g|mark",
      name: "Mark Jacobs",
      email: "mark@example.com",
    });
    const me = await mark.query(api.users.me, {});
    expect(me).toMatchObject({
      subject: "g|mark",
      email: "mark@example.com",
      username: null,
      needsUsername: true,
    });
  });

  test("suggestUsername derives from the Google display name", async () => {
    const t = convexTest(schema, modules);
    const mark = t.withIdentity({
      subject: "g|mark",
      name: "Mark Jacobs",
      email: "mark@example.com",
    });
    expect(await mark.query(api.users.suggestUsername, {})).toBe("MarkJacobs");
  });

  test("suggestUsername numbers a collision", async () => {
    const t = convexTest(schema, modules);
    // First Mark claims the firstName+lastName callsign.
    await t
      .withIdentity({ subject: "g|m1", name: "Mark Jacobs", email: "m1@x.com" })
      .mutation(api.users.chooseUsername, { username: "MarkJacobs" });

    // A second, different Mark gets a numbered suggestion.
    const mark2 = t.withIdentity({
      subject: "g|m2",
      name: "Mark Jacobs",
      email: "m2@x.com",
    });
    expect(await mark2.query(api.users.suggestUsername, {})).toBe(
      "MarkJacobs2",
    );
  });

  test("suggestUsername numbers a collision for a MAX-LENGTH name (root trimmed for the suffix)", async () => {
    const t = convexTest(schema, modules);
    // "Alexandraaaa Konstantinop" -> joined "AlexandraaaaKonstantinop" = 24 chars
    // (USERNAME_MAX). The base itself + its trimmed "...2" candidate must both be
    // probed by the pre-warm so the second user is NOT handed an already-taken
    // name (the bug that arises when the cache probes the untrimmed key).
    const name = "Alexandraaaa Konstantinop";
    const base = "AlexandraaaaKonstantinop"; // 24 chars
    const numbered = "AlexandraaaaKonstantino2"; // root trimmed to 23 + "2"

    await t
      .withIdentity({ subject: "g|a1", name, email: "a1@x.com" })
      .mutation(api.users.chooseUsername, { username: base });

    const second = t.withIdentity({ subject: "g|a2", name, email: "a2@x.com" });
    const suggestion = await second.query(api.users.suggestUsername, {});
    expect(suggestion).toBe(numbered);
    // And it must actually be available (the whole point of the pre-warm fix).
    expect(
      await second.query(api.users.isUsernameAvailable, {
        username: suggestion!,
      }),
    ).toMatchObject({ available: true });
  });

  test("chooseUsername persists ONLY email + username (no extra PII)", async () => {
    const t = convexTest(schema, modules);
    const mark = t.withIdentity({
      subject: "g|mark",
      name: "Mark Jacobs",
      email: "mark@example.com",
      // Extra PII Google might send — must NOT be persisted.
      givenName: "Mark",
      familyName: "Jacobs",
      pictureUrl: "https://example.com/avatar.png",
    });
    await mark.mutation(api.users.chooseUsername, { username: "MarkJ" });

    const me = await mark.query(api.users.me, {});
    expect(me).toMatchObject({
      email: "mark@example.com",
      username: "MarkJ",
      needsUsername: false,
    });

    // Inspect the raw stored row: exactly the privacy-safe fields.
    await t.run(async (ctx) => {
      const row = await ctx.db
        .query("users")
        .withIndex("by_subject", (q) => q.eq("subject", "g|mark"))
        .unique();
      expect(row).not.toBeNull();
      const { _id, _creationTime, ...rest } = row!;
      expect(rest).toEqual({
        subject: "g|mark",
        email: "mark@example.com",
        username: "MarkJ",
        usernameKey: "markj",
      });
    });
  });

  test("chooseUsername rejects a duplicate (case-insensitive)", async () => {
    const t = convexTest(schema, modules);
    await t
      .withIdentity({ subject: "g|a", name: "A", email: "a@x.com" })
      .mutation(api.users.chooseUsername, { username: "Champion" });

    const b = t.withIdentity({ subject: "g|b", name: "B", email: "b@x.com" });
    await expect(
      b.mutation(api.users.chooseUsername, { username: "champion" }),
    ).rejects.toThrow(/taken/i);
  });

  test("chooseUsername rejects an invalid username", async () => {
    const t = convexTest(schema, modules);
    const a = t.withIdentity({ subject: "g|a", name: "A", email: "a@x.com" });
    await expect(
      a.mutation(api.users.chooseUsername, { username: "x" }),
    ).rejects.toThrow();
    await expect(
      a.mutation(api.users.chooseUsername, { username: "bad@name" }),
    ).rejects.toThrow();
  });

  test("chooseUsername lets a user change to a free name (and re-keep their own)", async () => {
    const t = convexTest(schema, modules);
    const a = t.withIdentity({ subject: "g|a", name: "A", email: "a@x.com" });
    await a.mutation(api.users.chooseUsername, { username: "First" });
    // Re-choosing the same name (their own) is allowed.
    await a.mutation(api.users.chooseUsername, { username: "First" });
    // Changing to a new free name works.
    await a.mutation(api.users.chooseUsername, { username: "Second" });
    expect((await a.query(api.users.me, {}))?.username).toBe("Second");

    // The old name is now free for someone else.
    const b = t.withIdentity({ subject: "g|b", name: "B", email: "b@x.com" });
    await b.mutation(api.users.chooseUsername, { username: "First" });
    expect((await b.query(api.users.me, {}))?.username).toBe("First");
  });

  test("isUsernameAvailable reflects taken / free / invalid", async () => {
    const t = convexTest(schema, modules);
    await t
      .withIdentity({ subject: "g|a", name: "A", email: "a@x.com" })
      .mutation(api.users.chooseUsername, { username: "Taken" });

    const b = t.withIdentity({ subject: "g|b", name: "B", email: "b@x.com" });
    expect(
      await b.query(api.users.isUsernameAvailable, { username: "Taken" }),
    ).toMatchObject({ available: false });
    expect(
      await b.query(api.users.isUsernameAvailable, { username: "Free" }),
    ).toMatchObject({ available: true });
    expect(
      await b.query(api.users.isUsernameAvailable, { username: "x" }),
    ).toMatchObject({ available: false });
  });

  test("leaderboard shows the chosen username, not the Google name", async () => {
    const t = convexTest(schema, modules);
    const mark = t.withIdentity({
      subject: "g|mark",
      name: "Mark Jacobs",
      email: "mark@example.com",
    });
    await mark.mutation(api.users.chooseUsername, { username: "GemLord" });
    await mark.mutation(api.scores.submitScore, { score: 42 });

    const top = await t.query(api.scores.topN, {});
    expect(top).toEqual([{ subject: "g|mark", name: "GemLord", best: 42 }]);
  });

  test("leaderboard reflects a username CHANGE retroactively", async () => {
    const t = convexTest(schema, modules);
    const mark = t.withIdentity({
      subject: "g|mark",
      name: "Mark Jacobs",
      email: "mark@example.com",
    });
    await mark.mutation(api.users.chooseUsername, { username: "OldName" });
    await mark.mutation(api.scores.submitScore, { score: 10 });
    await mark.mutation(api.users.chooseUsername, { username: "NewName" });

    const top = await t.query(api.scores.topN, {});
    expect(top[0]).toMatchObject({ name: "NewName", best: 10 });
  });
});
