import { describe, expect, it } from "vitest";
import {
  dropVelocityForCause,
  stageVelocityForSquares,
} from "./engine";
import { routeEvent } from "./sfxRouting";

/**
 * Action SFX routing + velocity contract (audio-truth D4 / action-sfx spec). The
 * pure `routeEvent` map is asserted here; the velocity is computed by the engine's
 * exported helpers (also pure). The "feeds clear-progress" half of the clear-stage
 * requirement is asserted in the engine integration test (it needs the engine
 * state), so this file owns the routing + velocity scaling.
 */

describe("action SFX routing (D4)", () => {
  it("a lineClear routes to the clear `stage` one-shot (no longer silent)", () => {
    expect(routeEvent({ type: "lineClear", squares: 2, combo: 0 }).sfx).toBe(
      "stage",
    );
  });

  it("a bigger clear plays `stage` at a higher velocity than a single-square clear", () => {
    const small = stageVelocityForSquares(1);
    const big = stageVelocityForSquares(4);
    expect(big).toBeGreaterThan(small);
    expect(small).toBeCloseTo(0.7, 6);
    expect(big).toBeCloseTo(1.0, 6); // clamps at the ceiling
    // and a huge clear never exceeds the ceiling.
    expect(stageVelocityForSquares(50)).toBe(1.0);
    // the floor holds for a zero/degenerate count.
    expect(stageVelocityForSquares(0)).toBe(0.6);
  });

  it("a chain is audibly DISTINCT from a plain clear (hot stage + layered drop)", () => {
    const chain = routeEvent({ type: "chain", size: 6 });
    const clear = routeEvent({ type: "lineClear", squares: 2, combo: 0 });
    expect(chain.sfx).toBe("stage");
    expect(chain.layer).toBe("drop"); // the extra impact
    expect(clear.layer).toBeUndefined(); // a plain clear has no layer
  });

  it("every settle routes to `drop`, with velocity scaled by cause", () => {
    expect(routeEvent({ type: "lock", cause: "gravity" }).sfx).toBe("drop");
    expect(routeEvent({ type: "lock", cause: "hard" }).sfx).toBe("drop");
    // hard hits hardest; gravity/soft are softer.
    expect(dropVelocityForCause("hard")).toBe(1.0);
    expect(dropVelocityForCause("soft")).toBe(0.7);
    expect(dropVelocityForCause("gravity")).toBe(0.6);
    expect(dropVelocityForCause("hard")).toBeGreaterThan(
      dropVelocityForCause("gravity"),
    );
    // an absent cause (neutral lock) degrades to the gravity floor, not silence.
    expect(dropVelocityForCause(undefined)).toBe(0.6);
  });

  it("move is SILENT by decision (no routing)", () => {
    expect(routeEvent({ type: "move" }).sfx).toBeUndefined();
  });

  it("rotate and soft-drop keep their mapped one-shots", () => {
    expect(routeEvent({ type: "rotate" }).sfx).toBe("rotate");
    expect(routeEvent({ type: "softDrop" }).sfx).toBe("softdrop");
  });

  it("the SfxName set matches the manifest keys 1:1 (no harddrop quirk)", () => {
    const names = [
      routeEvent({ type: "lineClear", squares: 1, combo: 0 }).sfx,
      routeEvent({ type: "chain", size: 4 }).sfx,
      routeEvent({ type: "chain", size: 4 }).layer,
      routeEvent({ type: "lock", cause: "hard" }).sfx,
      routeEvent({ type: "rotate" }).sfx,
      routeEvent({ type: "softDrop" }).sfx,
    ];
    // none of the routed names is the old "harddrop" — they are all manifest keys.
    for (const n of names) {
      expect(["move", "rotate", "softdrop", "drop", "stage"]).toContain(n);
    }
  });
});
