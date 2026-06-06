import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = {
  "./_generated/api.ts": () => import("./_generated/api"),
  "./_generated/dataModel.ts": () => import("./_generated/dataModel"),
  "./_generated/server.ts": () => import("./_generated/server"),
  "./scores.ts": () => import("./scores"),
};

function testBackend() {
  return convexTest(schema, modules);
}

describe("scores Convex functions", () => {
  it("rejects score submission without an authenticated identity", async () => {
    const t = testBackend();

    await expect(
      t.mutation(api.scores.submitScore, { score: 10 }),
    ).rejects.toThrow("Authentication required");
  });

  it("derives the player from ctx.auth identity and only improves best score", async () => {
    const t = testBackend();
    const alice = t.withIdentity({
      subject: "google-oauth2|alice",
      name: "Alice",
      pictureUrl: "https://example.com/alice.png",
    });

    await expect(alice.query(api.scores.personalBest, {})).resolves.toBe(null);

    await expect(
      alice.mutation(api.scores.submitScore, { score: 40 }),
    ).resolves.toEqual({
      personalBest: 40,
      improved: true,
    });

    await expect(
      alice.mutation(api.scores.submitScore, { score: 25 }),
    ).resolves.toEqual({
      personalBest: 40,
      improved: false,
    });

    await expect(alice.query(api.scores.personalBest, {})).resolves.toBe(40);
  });

  it("returns the global top 10 from stored personal bests", async () => {
    const t = testBackend();

    for (let i = 0; i < 12; i++) {
      await t
        .withIdentity({ subject: `player-${i}`, name: `Player ${i}` })
        .mutation(api.scores.submitScore, {
          score: i * 10,
        });
    }

    const rows = await t.query(api.scores.topN, { limit: 10 });
    expect(rows).toHaveLength(10);
    expect(rows[0]).toMatchObject({
      subject: "player-11",
      name: "Player 11",
      score: 110,
    });
    expect(rows.at(-1)?.score).toBe(20);
  });
});
