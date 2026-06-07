/**
 * Skin bundles — a SKIN ties a cohesive colour scheme (board + chrome) to the
 * game. In v2.5 a skin is a purely VISUAL bundle:
 *   - `board`   — the Three.js viewport palette (dark-cell emissive, edges,
 *                 canvas background, gem accent). The renderer reads these so the
 *                 3D board recolours when the skin changes.
 *   - `chrome`  — the DOM frame palette, exposed as CSS custom properties on the
 *                 page root. The chrome's accents reference these vars, so the
 *                 frame crossfades with the board.
 *
 * Two skins ship:
 *   1. NEON     — the round-2 neon-purple scheme (matches the baked-in palette).
 *   2. PIPELINE — a cohesive lime/emerald "pipeline" scheme.
 *
 * NOTE (v2.5): the skin switch is COLOUR-ONLY. The earlier per-skin soundtrack
 * (TrackBundle / switchTrack) is held: the live audio is the song1 segment-
 * advance engine, which has no per-segment assets for a second song, so song2
 * audio crossfade is deferred rather than shipped broken. The visual crossfade
 * (Neon <-> Pipeline) is fully live.
 *
 * Pure data, so this module imports nothing and is trivially unit-testable. The
 * crossfade itself (interpolating between two skins' colours) lives in
 * `crossfade.ts`.
 */

/**
 * The Three.js board palette for a skin. Hex strings consumed directly by
 * `<meshStandardMaterial>` / `<color>` / `<Edges>` props (which accept CSS hex).
 */
export interface BoardPalette {
  /** Canvas clear colour (the well's background). */
  background: string;
  /** Dark-cell side-face base colour. */
  darkFace: string;
  /** Dark-cell emissive (the dominant board glow). */
  darkEmissive: string;
  /** Dark-cell inner-X core base colour. */
  darkCore: string;
  /** Dark-cell inner-X emissive. */
  darkCoreEmissive: string;
  /** Dark-cell deep-back colour. */
  darkBack: string;
  /** Dark-cell edge-frame colour (bright cells always frame white). */
  darkEdge: string;
  /** Gem accent on a dark block (the chain-special marker). */
  gem: string;
}

/** The DOM chrome palette, mirrored into CSS custom properties on the page. */
export interface ChromePalette {
  /** Page background near-black. */
  base: string;
  /** Primary accent (buttons, links, focus). */
  accent: string;
  /** Brighter accent (gradients, gem text). */
  accentBright: string;
  /** Deepest accent (gradient ends, glow). */
  accentDeep: string;
}

export interface Skin {
  /** Stable id (also the on-screen skin label key + data-skin attribute). */
  id: string;
  /** Human-readable label shown in the HUD + the switch control. */
  label: string;
  board: BoardPalette;
  chrome: ChromePalette;
}

/** Skin 1 — neon purple. Mirrors the round-2 baked-in palette exactly. */
export const SKIN_NEON: Skin = {
  id: "neon",
  label: "Neon",
  board: {
    background: "#0a0a12",
    darkFace: "#1a0e33",
    darkEmissive: "#3b1d6e",
    darkCore: "#2a1147",
    darkCoreEmissive: "#7c3aed",
    darkBack: "#150a2e",
    darkEdge: "#6b4a9e",
    gem: "#c45cff",
  },
  chrome: {
    base: "#08060f",
    accent: "#a855f7",
    accentBright: "#c45cff",
    accentDeep: "#7c3aed",
  },
};

/**
 * Skin 2 — "Pipeline": a cohesive lime/emerald scheme. The palette is built the
 * same way the neon one is (dark cells glow the accent, the canvas is a near-
 * black tuned slightly toward the accent's hue, the gem is the brightest accent)
 * so it reads as cohesive — a different WORLD, not a clash.
 */
export const SKIN_PIPELINE: Skin = {
  id: "pipeline",
  label: "Pipeline",
  board: {
    background: "#06120c",
    darkFace: "#0c2a1a",
    darkEmissive: "#1d6e45",
    darkCore: "#11472a",
    darkCoreEmissive: "#22c55e",
    darkBack: "#082414",
    darkEdge: "#4a9e6b",
    gem: "#a3ff5c",
  },
  chrome: {
    base: "#060f09",
    accent: "#22c55e",
    accentBright: "#a3ff5c",
    accentDeep: "#15803d",
  },
};

/** All skins in switch order. The "Next skin" control cycles this list. */
export const SKINS: readonly Skin[] = [SKIN_NEON, SKIN_PIPELINE] as const;

/** The skin shown on first load. */
export const DEFAULT_SKIN = SKIN_NEON;

/** The skin after `current` in cycle order (wraps). */
export function nextSkin(currentId: string): Skin {
  const idx = SKINS.findIndex((s) => s.id === currentId);
  return SKINS[(idx + 1) % SKINS.length] ?? DEFAULT_SKIN;
}

/** Look a skin up by id, defaulting to the neon skin. */
export function skinById(id: string | null | undefined): Skin {
  return SKINS.find((s) => s.id === id) ?? DEFAULT_SKIN;
}
