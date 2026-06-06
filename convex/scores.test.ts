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

function authed(subject: string, name: string) {
  return convexTest({ schema, modules }).withIdentity({
    subject,
    name,
    issuer: "https://mock-auth.local",
  });
}

describe("score functions", () => {
  it("rejects unauthenticated submissions", async () => {
    const t = convexTest({ schema, modules });

    await expect(
      t.mutation(api.scores.submitScore, { score: 10 }),
    ).rejects.toThrow("Authentication required");
    await expect(t.query(api.scores.topN, { limit: 10 })).resolves.toEqual([]);
  });

  it("derives the player from auth identity and only improves personal best", async () => {
    const t = authed("player-1", "Ada");

    await expect(
      t.mutation(api.scores.submitScore, { score: 25 }),
    ).resolves.toMatchObject({ bestScore: 25, improved: true });
    await expect(
      t.mutation(api.scores.submitScore, { score: 12 }),
    ).resolves.toMatchObject({ bestScore: 25, improved: false });
    await expect(t.query(api.scores.personalBest)).resolves.toMatchObject({
      subject: "player-1",
      name: "Ada",
      bestScore: 25,
    });
  });

  it("returns top 10 scores ordered descending", async () => {
    const t = convexTest({ schema, modules });

    for (let i = 0; i < 12; i++) {
      await t
        .withIdentity({
          subject: `player-${i}`,
          name: `Player ${i}`,
          issuer: "https://mock-auth.local",
        })
        .mutation(api.scores.submitScore, { score: i * 10 });
    }

    const rows = await t.query(api.scores.topN, { limit: 10 });
    expect(rows).toHaveLength(10);
    expect(rows.map((row: { bestScore: number }) => row.bestScore)).toEqual([
      110, 100, 90, 80, 70, 60, 50, 40, 30, 20,
    ]);
    expect(rows[0]?.subject).toBe("player-11");
  });
});
