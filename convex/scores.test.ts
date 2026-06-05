import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

describe("convex/scores", () => {
  it("submitScore is a no-op when unauthenticated", async () => {
    const t = convexTest(schema, modules);
    expect(await t.mutation(api.scores.submitScore, { score: 100 })).toBe(null);
    expect(await t.query(api.scores.topN, {})).toEqual([]);
  });

  it("derives the player from identity; personal best only rises", async () => {
    const t = convexTest(schema, modules);
    const alice = t.withIdentity({ subject: "alice", name: "Alice" });
    expect(await alice.mutation(api.scores.submitScore, { score: 100 })).toBe(
      100,
    );
    expect(await alice.mutation(api.scores.submitScore, { score: 40 })).toBe(
      100,
    );
    expect(await alice.mutation(api.scores.submitScore, { score: 250 })).toBe(
      250,
    );
    expect(await alice.query(api.scores.personalBest, {})).toBe(250);
  });

  it("keeps identities isolated (server-derived subject)", async () => {
    const t = convexTest(schema, modules);
    await t
      .withIdentity({ subject: "a", name: "A" })
      .mutation(api.scores.submitScore, { score: 10 });
    await t
      .withIdentity({ subject: "b", name: "B" })
      .mutation(api.scores.submitScore, { score: 20 });
    expect(
      await t
        .withIdentity({ subject: "a", name: "A" })
        .query(api.scores.personalBest, {}),
    ).toBe(10);
    expect(
      await t
        .withIdentity({ subject: "b", name: "B" })
        .query(api.scores.personalBest, {}),
    ).toBe(20);
  });

  it("topN returns entries by best descending", async () => {
    const t = convexTest(schema, modules);
    const rows: [string, number][] = [
      ["a", 10],
      ["b", 30],
      ["c", 20],
    ];
    for (const [s, n] of rows) {
      await t
        .withIdentity({ subject: s, name: s })
        .mutation(api.scores.submitScore, { score: n });
    }
    const top = await t.query(api.scores.topN, { n: 2 });
    expect(top.map((r) => r.best)).toEqual([30, 20]);
    expect(top[0]!.name).toBe("b");
  });
});
