import { describe, expect, it } from "vitest";
import { dropShellSize } from "./DropShell";
import { CELL } from "./layout";

describe("dropShellSize (drop-FX hull geometry)", () => {
  it("wraps a 2x2 piece a touch larger than its footprint", () => {
    const [w, h] = dropShellSize(2, 2);
    // larger than the 2x2 footprint (a cage AROUND the piece, not flush)
    expect(w).toBeGreaterThan(2 * CELL);
    expect(h).toBeGreaterThan(2 * CELL);
  });

  it("has genuine depth (a 3D hull, never a flat plane)", () => {
    const [, , d] = dropShellSize(2, 2);
    // depth is on the order of a cell — the whole point is it is volumetric, so a
    // flat (z=0) decal can never satisfy this.
    expect(d).toBeGreaterThan(CELL * 0.5);
  });

  it("scales with the spanned footprint", () => {
    const [w1] = dropShellSize(1, 2);
    const [w2] = dropShellSize(3, 2);
    expect(w2).toBeGreaterThan(w1);
  });
});
