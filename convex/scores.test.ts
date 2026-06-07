// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

// Register the Convex function modules for the in-memory backend.
const modules = import.meta.glob("./**/*.*s");

const ADA = { name: "Ada", subject: "user-ada" };
const GRACE = { name: "Grace", subject: "user-grace" };

describe("convex scores functions (in-memory via convex-test)", () => {
  it("submitScore writes for a signed-in user and personalBest reflects it", async () => {
    const t = convexTest(schema, modules);
    const ada = t.withIdentity(ADA);

    const r = await ada.mutation(api.scores.submitScore, { score: 10 });
    expect(r).toMatchObject({ written: true, best: 10 });
    expect(await ada.query(api.scores.personalBest, {})).toBe(10);
  });

  it("personal best updates ONLY when beaten", async () => {
    const t = convexTest(schema, modules);
    const ada = t.withIdentity(ADA);

    await ada.mutation(api.scores.submitScore, { score: 20 });
    // lower score does not lower the best
    const lower = await ada.mutation(api.scores.submitScore, { score: 5 });
    expect(lower).toMatchObject({ written: false, best: 20 });
    expect(await ada.query(api.scores.personalBest, {})).toBe(20);

    // higher score beats it
    const higher = await ada.mutation(api.scores.submitScore, { score: 33 });
    expect(higher).toMatchObject({ written: true, best: 33 });
    expect(await ada.query(api.scores.personalBest, {})).toBe(33);
  });

  it("topN returns the global top scores, highest first", async () => {
    const t = convexTest(schema, modules);
    await t.withIdentity(ADA).mutation(api.scores.submitScore, { score: 15 });
    await t
      .withIdentity(GRACE)
      .mutation(api.scores.submitScore, { score: 42 });

    const top = await t.query(api.scores.topN, { n: 10 });
    expect(top.map((e) => e.score)).toEqual([42, 15]);
    expect(top[0]).toMatchObject({ subject: GRACE.subject, name: "Grace" });
  });

  it("SECURITY: a signed-out caller cannot write, and has no personal best", async () => {
    const t = convexTest(schema, modules);

    const r = await t.mutation(api.scores.submitScore, { score: 99 });
    expect(r).toMatchObject({ written: false });
    // nothing persisted
    expect(await t.query(api.scores.topN, {})).toEqual([]);
    // personal best is null when unauthenticated
    expect(await t.query(api.scores.personalBest, {})).toBeNull();
  });

  it("SECURITY: the user is derived from identity.subject, not a client arg", async () => {
    const t = convexTest(schema, modules);
    // Two distinct identities write; each keeps its OWN row keyed by subject.
    await t.withIdentity(ADA).mutation(api.scores.submitScore, { score: 11 });
    await t.withIdentity(GRACE).mutation(api.scores.submitScore, { score: 22 });

    expect(await t.withIdentity(ADA).query(api.scores.personalBest, {})).toBe(11);
    expect(await t.withIdentity(GRACE).query(api.scores.personalBest, {})).toBe(
      22,
    );
    // exactly two rows — no cross-write
    expect((await t.query(api.scores.topN, {})).length).toBe(2);
  });
});
