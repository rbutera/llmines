import { describe, expect, it } from "vitest";
import {
  dropVelocityForCause,
  stageVelocityForSquares,
} from "./engine";
import { routeEvent } from "./sfxRouting";

/**
 * Mode-aware action SFX routing + velocity contract (heat/tone model, design D6).
 * `routeEvent(ev, mode)` is pure: TONE mode (default) routes only the events that
 * SOUND a synthesised tone (match / rotate / softDrop / lock); SAMPLE mode keeps the
 * recorded per-segment path (match → stage, chain → stage + layered drop, lock → drop,
 * rotate/softDrop → their one-shots). The sweep clear and move are silent in BOTH
 * modes; the chain is silent in TONE mode only. Velocity helpers are pure too.
 */

describe("action SFX routing (D6) — TONE mode (default)", () => {
  it("a MATCH sounds (routes non-empty); the sweep CLEAR is silent", () => {
    expect(routeEvent({ type: "match", squares: 2 }).sfx).toBeDefined();
    // the sweep clear makes no noise — only forming a match dings.
    expect(routeEvent({ type: "lineClear", squares: 2, combo: 0 }).sfx).toBeUndefined();
  });

  it("a CHAIN is SILENT in tone mode (it is a clear)", () => {
    expect(routeEvent({ type: "chain", size: 6 }).sfx).toBeUndefined();
    expect(routeEvent({ type: "chain", size: 6 }).layer).toBeUndefined();
  });

  it("rotate / softDrop / lock sound; move is silent (tone mode)", () => {
    expect(routeEvent({ type: "rotate" }).sfx).toBeDefined();
    expect(routeEvent({ type: "softDrop" }).sfx).toBeDefined();
    expect(routeEvent({ type: "lock", cause: "hard" }).sfx).toBeDefined();
    expect(routeEvent({ type: "move" }).sfx).toBeUndefined();
  });

  it("the default mode (no arg) is tone — the sweep clear + chain are silent", () => {
    expect(routeEvent({ type: "lineClear", squares: 2, combo: 0 }).sfx).toBeUndefined();
    expect(routeEvent({ type: "chain", size: 4 }).sfx).toBeUndefined();
  });
});

describe("action SFX routing (D6) — SAMPLE mode (recorded path)", () => {
  it("a MATCH routes to the clear `stage` one-shot", () => {
    expect(routeEvent({ type: "match", squares: 2 }, "sample").sfx).toBe("stage");
  });

  it("the sweep CLEAR is silent in sample mode too (clearing makes no noise)", () => {
    expect(
      routeEvent({ type: "lineClear", squares: 2, combo: 0 }, "sample").sfx,
    ).toBeUndefined();
  });

  it("a CHAIN keeps its distinct recorded routing (hot stage + layered drop)", () => {
    const chain = routeEvent({ type: "chain", size: 6 }, "sample");
    expect(chain.sfx).toBe("stage");
    expect(chain.layer).toBe("drop"); // the extra impact
    // a plain match has no layered impact.
    expect(routeEvent({ type: "match", squares: 2 }, "sample").layer).toBeUndefined();
  });

  it("every settle routes to `drop`; rotate/softDrop keep their one-shots; move silent", () => {
    expect(routeEvent({ type: "lock", cause: "gravity" }, "sample").sfx).toBe("drop");
    expect(routeEvent({ type: "lock", cause: "hard" }, "sample").sfx).toBe("drop");
    expect(routeEvent({ type: "rotate" }, "sample").sfx).toBe("rotate");
    expect(routeEvent({ type: "softDrop" }, "sample").sfx).toBe("softdrop");
    expect(routeEvent({ type: "move" }, "sample").sfx).toBeUndefined();
  });

  it("the SfxName set matches the manifest keys 1:1 (no harddrop quirk)", () => {
    const names = [
      routeEvent({ type: "match", squares: 1 }, "sample").sfx,
      routeEvent({ type: "chain", size: 4 }, "sample").sfx,
      routeEvent({ type: "chain", size: 4 }, "sample").layer,
      routeEvent({ type: "lock", cause: "hard" }, "sample").sfx,
      routeEvent({ type: "rotate" }, "sample").sfx,
      routeEvent({ type: "softDrop" }, "sample").sfx,
    ];
    for (const n of names) {
      expect(["move", "rotate", "softdrop", "drop", "stage"]).toContain(n);
    }
  });
});

describe("velocity helpers (pure)", () => {
  it("a bigger match/clear plays `stage` at a higher velocity than a single-square one", () => {
    const small = stageVelocityForSquares(1);
    const big = stageVelocityForSquares(4);
    expect(big).toBeGreaterThan(small);
    expect(small).toBeCloseTo(0.7, 6);
    expect(big).toBeCloseTo(1.0, 6); // clamps at the ceiling
    expect(stageVelocityForSquares(50)).toBe(1.0);
    expect(stageVelocityForSquares(0)).toBe(0.6); // floor for a degenerate count
  });

  it("a settle's drop velocity scales by cause (hard > soft > gravity), absent → floor", () => {
    expect(dropVelocityForCause("hard")).toBe(1.0);
    expect(dropVelocityForCause("soft")).toBe(0.7);
    expect(dropVelocityForCause("gravity")).toBe(0.6);
    expect(dropVelocityForCause("hard")).toBeGreaterThan(
      dropVelocityForCause("gravity"),
    );
    expect(dropVelocityForCause(undefined)).toBe(0.6);
  });
});
