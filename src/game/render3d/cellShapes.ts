/**
 * Per-skin CELL SHAPE motif. A skin is not just a recolour — each skin renders
 * its two block colours with a DISTINCT pair of inner shapes so the two skins
 * read as different worlds at a glance, not just a palette swap.
 *
 *   - SKIN 1 ("neon"):   bright = glowing ORB (sphere), dark = inner X (crossed
 *                        bars). The original, validated look — unchanged.
 *   - SKIN 2 ("pipeline"): bright = a faceted DIAMOND (rotating octahedron),
 *                        dark = a hollow RING (torus). Completely different
 *                        silhouettes from skin 1, so a glance tells the skins
 *                        apart even before the colour registers.
 *
 * Pure data + a lookup, keyed by the stable skin id (never the index, so
 * reordering skins can't silently repaint a board). Any skin without an explicit
 * entry inherits the skin-1 motif via the fallback, so adding a skin is additive.
 *
 * No Three/React imports — Cube.tsx reads this to choose which inner mesh to
 * render. a11y: every shape is static or gently rotating; never a strobe.
 */

/** Which inner shape a BRIGHT (colour A / index 0) cell renders. */
export type BrightShape = "orb" | "diamond";
/** Which inner shape a DARK (colour B / index 1) cell renders. */
export type DarkShape = "x" | "ring";

export interface CellShapeMotif {
  bright: BrightShape;
  dark: DarkShape;
}

/** Skin-1 motif: the original glowing-orb / inner-X look. */
export const MOTIF_ORB_X: CellShapeMotif = { bright: "orb", dark: "x" };

/** Skin-2 motif: faceted diamond (bright) + hollow ring (dark). */
export const MOTIF_DIAMOND_RING: CellShapeMotif = {
  bright: "diamond",
  dark: "ring",
};

const MOTIF_BY_SKIN_ID: Record<string, CellShapeMotif> = {
  neon: MOTIF_ORB_X,
  pipeline: MOTIF_DIAMOND_RING,
};

/** The cell-shape motif for a skin id; falls back to the skin-1 orb/X motif. */
export function cellShapeForSkin(skinId: string | null | undefined): CellShapeMotif {
  if (!skinId) return MOTIF_ORB_X;
  return MOTIF_BY_SKIN_ID[skinId] ?? MOTIF_ORB_X;
}
