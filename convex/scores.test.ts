import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

// `import.meta.glob` is a Vite/Vitest macro — it MUST be called literally so it
// can be statically transformed. Type it here (rather than depend on
// `vite/client` resolving under pnpm) without breaking that static call.
declare global {
  interface ImportMeta {
    glob: (pattern: string) => Record<string, () => Promise<unknown>>;
  }
}

// convex-test runs the REAL schema + functions against an in-memory backend.
const modules = import.meta.glob("./**/*.ts");

describe("scores convex functions", () => {
  it("submitScore derives the user from the AUTH identity, not a client arg", async () => {
    const t = convexTest(schema, modules);
    const alice = t.withIdentity({ name: "Alice", subject: "google|alice" });

    const r = await alice.mutation(api.scores.submitScore, { score: 42 });
    expect(r).toEqual({ written: true, best: 42 });

    // personalBest is derived from the same identity (no userId passed in).
    const pb = await alice.query(api.scores.personalBest, {});
    expect(pb).toEqual({ name: "Alice", best: 42 });
  });

  it("an UNAUTHENTICATED submit is never written", async () => {
    const t = convexTest(schema, modules);
    const r = await t.mutation(api.scores.submitScore, { score: 99 });
    expect(r).toEqual({ written: false, best: null });

    expect(await t.query(api.scores.personalBest, {})).toBeNull();
    expect(await t.query(api.scores.topN, {})).toEqual([]);
  });

  it("personal best only rises (updates only when beaten)", async () => {
    const t = convexTest(schema, modules);
    const bob = t.withIdentity({ name: "Bob", subject: "google|bob" });

    expect((await bob.mutation(api.scores.submitScore, { score: 10 })).best).toBe(10);
    // lower score does not lower the best
    expect((await bob.mutation(api.scores.submitScore, { score: 5 })).best).toBe(10);
    // higher score raises it
    expect((await bob.mutation(api.scores.submitScore, { score: 25 })).best).toBe(25);

    expect(await bob.query(api.scores.personalBest, {})).toEqual({
      name: "Bob",
      best: 25,
    });
  });

  it("topN returns the global leaderboard, highest first, reflecting new scores", async () => {
    const t = convexTest(schema, modules);
    const players: [string, number][] = [
      ["a", 30],
      ["b", 50],
      ["c", 10],
      ["d", 40],
    ];
    for (const [id, score] of players) {
      await t
        .withIdentity({ name: id.toUpperCase(), subject: `google|${id}` })
        .mutation(api.scores.submitScore, { score });
    }

    const top = await t.query(api.scores.topN, { n: 3 });
    expect(top.map((r) => r.best)).toEqual([50, 40, 30]);
    expect(top.map((r) => r.name)).toEqual(["B", "D", "A"]);

    // A newly submitted high score is reflected.
    await t
      .withIdentity({ name: "C", subject: "google|c" })
      .mutation(api.scores.submitScore, { score: 100 });
    const top2 = await t.query(api.scores.topN, {});
    expect(top2[0]).toMatchObject({ name: "C", best: 100 });
  });

  it("one row per user: a user appears once on the leaderboard at their best", async () => {
    const t = convexTest(schema, modules);
    const carol = t.withIdentity({ name: "Carol", subject: "google|carol" });
    await carol.mutation(api.scores.submitScore, { score: 20 });
    await carol.mutation(api.scores.submitScore, { score: 60 });

    const top = await t.query(api.scores.topN, {});
    expect(top.filter((r) => r.subject === "google|carol")).toHaveLength(1);
    expect(top[0]).toMatchObject({ subject: "google|carol", best: 60 });
  });
});
