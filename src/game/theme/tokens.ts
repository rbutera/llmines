/**
 * Chrome theme tokens — the SINGLE source of truth for the DOM chrome palette.
 *
 * The game VIEWPORT (the Three.js board) is neon-purple-on-near-black: dark cells
 * are violet (`#3b1d6e` / `#7c3aed` emissive, `#6b4a9e` edges), bright cells are
 * near-white, the canvas background is `#0a0a12`, and the gem accent is bright
 * purple `#c45cff`. The surrounding chrome used to be teal (`#37e0c9`) + pink
 * (`#ff5fb0`), which made the frame look like a different product from the board.
 *
 * These tokens pull the chrome into the SAME world as the board: a near-black
 * base, violet / magenta accents derived from the board's own colours, white
 * text, and a subtle neon-purple glow. The legacy teal/pink are retired.
 *
 * Pure data (string tokens), so it imports nowhere and is trivially unit-testable.
 * The Tailwind classNames across the chrome reference these hexes as arbitrary
 * values; `globals.css` mirrors the glow colours into CSS custom properties for
 * the keyframe-driven score-pop.
 */

export const THEME = {
  /** Page background — deepest near-black, a touch violet-cool. */
  base: "#08060f",
  /** A slightly lifted near-black, for large surfaces sitting on the base. */
  baseLifted: "#0d0a18",
  /** Primary violet accent (buttons, links, focus, active text). */
  accent: "#a855f7",
  /** Brighter magenta-violet accent — matches the board's dark-cell gem colour. */
  accentBright: "#c45cff",
  /** Deep violet — matches the board dark-cell emissive; for gradient ends. */
  accentDeep: "#7c3aed",
  /** Soft lilac for secondary numeric accents (personal best / leaderboard). */
  accentSoft: "#d8b4fe",
  /** Primary text (kept white; most chrome text was already white). */
  text: "#f5f3ff",
} as const;

export type ThemeTokens = typeof THEME;

/**
 * Legacy chrome accents that this change retires. Exported so a unit test can
 * assert they never leak back into {@link THEME}.
 */
export const LEGACY_CHROME_ACCENTS = ["#37e0c9", "#ff5fb0"] as const;

/* ============================================================
 * Cockpit-HUD skin -> hue system (v2.8 HUD redesign).
 *
 * The in-world cockpit HUD is MONOCHROME-by-skin: a single OKLCH hue angle (plus
 * a chroma) drives the ENTIRE chrome via `oklch()` token expressions declared on
 * the HUD root element. Switching skin re-tints the whole UI by changing only
 * `--hue` / `--chroma`. This maps each skin id to its hue tuning; the values
 * mirror the design spec (PRISM/purple 312 @ 0.20, VERDANT/green 158 @ 0.19) and
 * are anchored to each skin's board gem colour so chrome + board read as one
 * world.
 *
 * CRITICAL (cost a bug): the derived `oklch(... var(--hue))` token block MUST be
 * declared on the same element that carries `--hue` (the `.screen` HUD root) and
 * NOT on `:root` — `var()` substitution resolves at the scope where the property
 * is declared, so declaring derived tokens on `:root` bakes in the default hue
 * and they never recompute for a descendant override. The token block lives on
 * `.screen` in `hud.css`; this module only provides the per-skin hue inputs.
 * ============================================================ */

/** A skin's monochrome HUD hue tuning. */
export interface HudHue {
  /** OKLCH hue angle (degrees) that re-tints the whole HUD. */
  hue: number;
  /** OKLCH chroma for the primary accent token. */
  chroma: number;
}

/**
 * Skin id -> HUD hue. Keyed by the `Skin.id` values in `skins.ts`
 * (`neon` purple, `pipeline` green). Defaults to the neon/purple tuning for any
 * unknown id so a missing mapping can never blank the chrome.
 */
export const HUD_HUE_BY_SKIN: Record<string, HudHue> = {
  neon: { hue: 312, chroma: 0.2 },
  pipeline: { hue: 158, chroma: 0.19 },
};

/** The HUD hue for the default skin (purple). */
export const DEFAULT_HUD_HUE: HudHue = HUD_HUE_BY_SKIN.neon!;

/** Look up a skin's HUD hue, defaulting to the neon/purple tuning. */
export function hudHueForSkin(skinId: string | null | undefined): HudHue {
  if (!skinId) return DEFAULT_HUD_HUE;
  return HUD_HUE_BY_SKIN[skinId] ?? DEFAULT_HUD_HUE;
}
