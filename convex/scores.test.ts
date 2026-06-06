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

// Must be a literal call (Vite statically transforms it). Registers the real
// schema + function modules with the in-memory backend.
const modules = import.meta.glob("./**/*.ts");

describe("convex scores (real functions, in-memory)", () => {
  test("first submit creates a record; best only rises", async () => {
    const t = convexTest(schema, modules);
    const alice = t.withIdentity({ subject: "alice", name: "Alice" });

    expect(await alice.mutation(api.scores.submitScore, { score: 10 })).toBe(10);
    expect(await alice.query(api.scores.personalBest, {})).toBe(10);

    // Lower score does NOT lower the best.
    await alice.mutation(api.scores.submitScore, { score: 5 });
    expect(await alice.query(api.scores.personalBest, {})).toBe(10);

    // Higher score raises it.
    await alice.mutation(api.scores.submitScore, { score: 25 });
    expect(await alice.query(api.scores.personalBest, {})).toBe(25);
  });

  test("write is attributed to the authenticated subject (server-derived)", async () => {
    const t = convexTest(schema, modules);
    await t
      .withIdentity({ subject: "bob", name: "Bob" })
      .mutation(api.scores.submitScore, { score: 7 });

    // A different identity has its own (empty) record.
    expect(
      await t
        .withIdentity({ subject: "carol", name: "Carol" })
        .query(api.scores.personalBest, {}),
    ).toBe(null);

    // The leaderboard shows exactly Bob's row.
    expect(await t.query(api.scores.topN, {})).toEqual([
      { subject: "bob", name: "Bob", best: 7 },
    ]);
  });

  test("unauthenticated submit is a no-op", async () => {
    const t = convexTest(schema, modules);
    expect(await t.mutation(api.scores.submitScore, { score: 99 })).toBe(null);
    expect(await t.query(api.scores.topN, {})).toEqual([]);
  });

  test("topN returns up to 10 ordered by best descending", async () => {
    const t = convexTest(schema, modules);
    for (let i = 0; i < 12; i++) {
      await t
        .withIdentity({ subject: `u${i}`, name: `U${i}` })
        .mutation(api.scores.submitScore, { score: i });
    }
    const top = (await t.query(api.scores.topN, {})) as { best: number }[];
    expect(top.length).toBe(10);
    expect(top.map((r) => r.best)).toEqual([11, 10, 9, 8, 7, 6, 5, 4, 3, 2]);
  });
});
