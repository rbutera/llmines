import { describe, expect, it } from "vitest";
import {
  cellShapeForSkin,
  MOTIF_DIAMOND_RING,
  MOTIF_ORB_X,
} from "./cellShapes";
import { SKINS, SKIN_NEON, SKIN_PIPELINE } from "../skins/skins";

/**
 * FIX C: each skin renders its two block colours with a DISTINCT shape motif so
 * the two skins read as different worlds, not just a recolour. Skin 1 keeps the
 * orb/X look; skin 2 gets diamond/ring.
 */
describe("per-skin cell shape motif (FIX C)", () => {
  it("skin 1 (neon) keeps the orb / inner-X motif", () => {
    expect(cellShapeForSkin(SKIN_NEON.id)).toEqual(MOTIF_ORB_X);
    expect(cellShapeForSkin(SKIN_NEON.id).bright).toBe("orb");
    expect(cellShapeForSkin(SKIN_NEON.id).dark).toBe("x");
  });

  it("skin 2 (pipeline) uses a DISTINCT diamond / ring motif", () => {
    expect(cellShapeForSkin(SKIN_PIPELINE.id)).toEqual(MOTIF_DIAMOND_RING);
    expect(cellShapeForSkin(SKIN_PIPELINE.id).bright).toBe("diamond");
    expect(cellShapeForSkin(SKIN_PIPELINE.id).dark).toBe("ring");
  });

  it("the two shipped skins read as visually different (no shared shape)", () => {
    const a = cellShapeForSkin(SKINS[0]!.id);
    const b = cellShapeForSkin(SKINS[1]!.id);
    expect(a.bright).not.toBe(b.bright);
    expect(a.dark).not.toBe(b.dark);
  });

  it("an unknown / missing skin id falls back to the skin-1 motif (additive-safe)", () => {
    expect(cellShapeForSkin(undefined)).toEqual(MOTIF_ORB_X);
    expect(cellShapeForSkin(null)).toEqual(MOTIF_ORB_X);
    expect(cellShapeForSkin("does-not-exist")).toEqual(MOTIF_ORB_X);
  });
});
