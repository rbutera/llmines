import { describe, expect, it } from "vitest";
import { shearFactor } from "./Cube";
import { COLS } from "../core";

/**
 * The next-piece preview must render FLAT (no per-column shear), distinct from
 * the board, which shears off-centre columns. `shearFactor` is the single source
 * of truth for the geometry's shear, so asserting it here guarantees the preview
 * dock (which passes `flat`) never applies a shear transform.
 */
describe("preview is flat (no shear)", () => {
  const SHEAR = 0.4;

  it("flat mode applies zero shear for any column", () => {
    for (let col = 0; col < COLS; col++) {
      expect(shearFactor(SHEAR, col, COLS, true), `col ${col}`).toBe(0);
    }
    // The preview dock renders 2-wide clusters (cols=2) — both flat.
    expect(shearFactor(SHEAR, 0, 2, true)).toBe(0);
    expect(shearFactor(SHEAR, 1, 2, true)).toBe(0);
  });

  it("the board path DOES shear off-centre columns (contrast)", () => {
    // A non-flat off-centre column must shear (so the preview's flatness is a
    // real difference, not a no-op everywhere).
    expect(shearFactor(SHEAR, 0, COLS, false)).not.toBe(0);
    expect(shearFactor(SHEAR, COLS - 1, COLS, false)).not.toBe(0);
  });

  it("non-flat is symmetric around the centre and zero with a single column", () => {
    expect(shearFactor(SHEAR, 0, COLS, false)).toBeCloseTo(
      -shearFactor(SHEAR, COLS - 1, COLS, false),
    );
    expect(shearFactor(SHEAR, 0, 1, false)).toBe(0);
  });
});
