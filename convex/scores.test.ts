import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

/**
 * Server-side function + security tests for the leaderboard backend, run against
 * the in-memory `convex-test` backend with mocked identity (`t.withIdentity`).
 * This is the proof for the review gate: writes are attributed to the
 * server-derived identity, never a client argument.
 */

// convex-test discovers function modules (must include the `_generated` dir).
// `import.meta.glob` is injected by Vite/Vitest; type it locally since the repo
// uses Bundler resolution without vite/client ambient types.
const modules = (
  import.meta as unknown as {
    glob: (pattern: string) => Record<string, () => Promise<unknown>>;
  }
).glob("./**/*.*s");

const ALICE = { subject: "u-alice", name: "Alice" };
const BOB = { subject: "u-bob", name: "Bob" };

describe("convex scores backend", () => {
  it("attributes submitScore to the authenticated identity and isolates users (INV-A/INV-D)", async () => {
    const t = convexTest(schema, modules);
    const asAlice = t.withIdentity(ALICE);

    await asAlice.mutation(api.scores.submitScore, { score: 100 });
    expect(await asAlice.query(api.scores.personalBest, {})).toBe(100);

    // A different identity has its own row and cannot see/alter Alice's best.
    const asBob = t.withIdentity(BOB);
    expect(await asBob.query(api.scores.personalBest, {})).toBe(null);
    await asBob.mutation(api.scores.submitScore, { score: 5 });
    expect(await asBob.query(api.scores.personalBest, {})).toBe(5);
    expect(await asAlice.query(api.scores.personalBest, {})).toBe(100);
  });

  it("updates personal best only when strictly beaten (INV-B)", async () => {
    const t = convexTest(schema, modules);
    const a = t.withIdentity(ALICE);
    await a.mutation(api.scores.submitScore, { score: 100 });
    await a.mutation(api.scores.submitScore, { score: 100 }); // equal — no change
    await a.mutation(api.scores.submitScore, { score: 50 }); //  lower — no change
    expect(await a.query(api.scores.personalBest, {})).toBe(100);
    await a.mutation(api.scores.submitScore, { score: 150 }); // higher — updates
    expect(await a.query(api.scores.personalBest, {})).toBe(150);
  });

  it("does not write when unauthenticated (FR-007)", async () => {
    const t = convexTest(schema, modules);
    const res = await t.mutation(api.scores.submitScore, { score: 999 });
    expect(res).toBeNull();
    expect(await t.query(api.scores.topN, {})).toEqual([]);
  });

  it("topN returns top-10 by best, one row per user, high to low (INV-C)", async () => {
    const t = convexTest(schema, modules);
    for (let i = 1; i <= 12; i++) {
      await t
        .withIdentity({ subject: `u-${i}`, name: `P${i}` })
        .mutation(api.scores.submitScore, { score: i * 10 });
    }
    const top = await t.query(api.scores.topN, {});
    expect(top.length).toBe(10);
    expect(top[0]).toEqual({ name: "P12", best: 120 });
    const bests = top.map((r) => r.best);
    expect(bests).toEqual([...bests].sort((x, y) => y - x));
    expect(bests).not.toContain(10); // the two lowest are excluded
  });
});
