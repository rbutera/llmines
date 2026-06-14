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
 * SINGLE-COLOUR bonus surge: a saturated COLOUR-WASH pulse. Warm gold/amber
 * core with an orange corona and a gold shock ring, distinct from the cyan/
 * magenta gem cascade so the player reads "single-colour bonus" at a glance.
 */
export const SINGLE_COLOUR_SURGE: SurgeStyle = {
  // hot gold-white core
  core: [3.2, 2.7, 1.2],
  // saturated amber corona
  corona: [3.0, 1.8, 0.4],
  // deeper orange alternate
  coronaAlt: [3.0, 1.1, 0.2],
  // gold shock ring
  shock: [2.8, 2.2, 0.8],
};

/**
 * ALL-CLEAR bonus surge: the biggest, most celebratory look — a full-board WHITE
 * BLOOM. Pure over-driven white core + corona so the whole field flares, with a
 * white shock ring (the shockwave is forced on + sized for the all-clear).
 */
export const ALL_CLEAR_SURGE: SurgeStyle = {
  // pure blinding white core
  core: [4.0, 4.0, 4.0],
  // white corona (the bloom)
  corona: [3.6, 3.6, 3.8],
  // faint icy-blue alternate for a touch of depth in the bloom
  coronaAlt: [3.0, 3.4, 4.0],
  // white shock ring
  shock: [3.4, 3.4, 3.6],
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
