/**
 * Per-skin SURGE STYLE for the gem-clear cascade (PART 1). The cascade's visual
 * identity — the colour of the white-hot leading edge, the trailing corona, the
 * shatter spark tint, and the climax shockwave colour — is a property OF THE SKIN
 * so future skins can swap the look without touching the wavefront engine.
 *
 * This skin ("electric / plasma", cyan #22d3ee + magenta #e879f9 + bloom) is the
 * default. Adding a skin = add an entry keyed by the host skin id (see
 * skins/skins.ts) with its own surge palette; the renderer looks the style up by
 * the live host skin index and the engine renders it generically.
 *
 * Pure data + a lookup. No Three/React imports so it stays trivially importable.
 */

import { SKINS } from "../skins/skins";

/** RGB triple in 0..1 linear space (ready for THREE.Color.setRGB). */
export type Rgb = readonly [number, number, number];

export interface SurgeStyle {
  /**
   * The white-hot LEADING EDGE colour (the comet head racing along the graph).
   * Pushed bright so it blows past the bloom threshold and flares.
   */
  core: Rgb;
  /**
   * The TRAILING CORONA colour the front leaves behind on each cell (the comet
   * tail / arc look). This is the skin's signature hue.
   */
  corona: Rgb;
  /**
   * A SECONDARY corona used to alternate the trail per ring so the cascade reads
   * as two-tone plasma (this skin: cyan + magenta) rather than a flat colour.
   */
  coronaAlt: Rgb;
  /** The climax SHOCKWAVE ring colour. */
  shock: Rgb;
}

/**
 * The default electric/plasma surge: white-hot core, cyan corona, magenta
 * alternate, cyan-white shockwave. Tuned for the bloom skin.
 */
export const ELECTRIC_PLASMA: SurgeStyle = {
  // white-hot, over-driven so it flares through bloom
  core: [3.2, 3.2, 3.0],
  // cyan #22d3ee -> linear-ish, scaled up for emissive punch
  corona: [0.5, 2.6, 3.0],
  // magenta #e879f9
  coronaAlt: [2.8, 1.1, 3.0],
  // cyan-white shock ring
  shock: [1.4, 2.6, 3.0],
};

/**
 * Surge styles keyed by skin id. Skins without an explicit entry fall back to
 * {@link ELECTRIC_PLASMA}. Keeping this keyed by id (not index) means reordering
 * skins never silently repaints a cascade.
 */
const STYLES_BY_SKIN_ID: Record<string, SurgeStyle> = {
  neon: ELECTRIC_PLASMA,
  // Future skins can register their own surge palette here. Until they do they
  // inherit the electric/plasma look via the fallback below.
};

/** The surge style for a host skin index (clamped); falls back to electric/plasma. */
export function surgeStyleForSkin(skinIndex: number): SurgeStyle {
  const clamped = Math.max(0, Math.min(skinIndex, SKINS.length - 1));
  const id = SKINS[clamped]?.id ?? "";
  return STYLES_BY_SKIN_ID[id] ?? ELECTRIC_PLASMA;
}
