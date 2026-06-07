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
