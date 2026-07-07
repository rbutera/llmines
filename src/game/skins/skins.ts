/**
 * Skin bundles — a SKIN ties a cohesive colour scheme AND a soundtrack to the
 * game:
 *   - `board`   — the Three.js viewport palette (dark-cell emissive, edges,
 *                 canvas background, gem accent). The renderer reads these so the
 *                 3D board recolours when the skin changes.
 *   - `chrome`  — the DOM frame palette, exposed as CSS custom properties on the
 *                 page root. The chrome's accents reference these vars, so the
 *                 frame crossfades with the board.
 *   - `track`   — the recorded soundtrack ({@link TrackBundle}): a full ordered
 *                 segment set (bed + vox) + ad-lib SFX. Switching skin crossfades
 *                 to this song via the engine's switchTrack, and the
 *                 segment-advance mechanic runs on it (clears step ITS segments).
 *
 * Two skins ship:
 *   1. NEON     — round-2 neon-purple scheme + song 1 (Especifico Primero).
 *   2. PIPELINE — a cohesive lime/emerald scheme + song 2 (Verde el Pipeline,
 *                 phonk, ~126 BPM), assets under /audio/song2.
 *
 * Imports only the (pure) TrackBundle factory from the engine, so it stays
 * trivially unit-testable. The colour crossfade lives in
 * `crossfade.ts`.
 */

import { makeTrack, type TrackBundle, TRACK_SONG1 } from "../audio/procedural/engine";

/**
 * The Three.js board palette for a skin. Hex strings consumed directly by
 * `<meshStandardMaterial>` / `<color>` / `<Edges>` props (which accept CSS hex).
 */
export interface BoardPalette {
  /** Canvas clear colour (the well's background). */
  background: string;
  /**
   * Bright-cell (block colour 0) side-face + glass tint. Skin 1 keeps this
   * near-white (the round-2 baked-in look); a skin can recolour the BRIGHT cell
   * (e.g. skin 2 = green) by setting these. The renderer reads them so the
   * bright cell is no longer hard-coded white. */
  brightFace: string;
  /** Bright-cell inner-shape (orb / diamond) base + emissive colour. */
  brightCore: string;
  /** Bright-cell glass-face tint (top/bottom/front/back translucent faces). */
  brightGlass: string;
  /** Bright-cell glowing edge-frame colour. */
  brightEdge: string;
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
  /**
   * The EMPTY-square grid line (the well lattice) + the current-column indicator.
   * DECOUPLED from `darkEdge`: the grid line and the dark-cell edge used to share
   * one token, which forced it to satisfy two opposing backgrounds at once (light
   * vs the dark backdrop AND dark vs a near-white piece). Splitting them lets the
   * grid keep its own quiet hue while the dark cell takes an unrelated block
   * colour. Skin 1 keeps this purple so the grid reads unchanged.
   */
  gridLine: string;
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
  /** Human-readable label shown in the HUD. */
  label: string;
  /** The recorded soundtrack for this skin (segment set + SFX asset dir). */
  track: TrackBundle;
  /**
   * The track's tempo in BPM, taken from the audio manifest (`songs[].tempo`).
   * This is the SINGLE source the sweep speed is driven from: the host pushes it
   * to the controller via `setTempo` so the timeline bar runs in time with the
   * playing song (one pass = 16 eighth-notes = two bars of the actual track). A
   * guard test (`skins.test.ts`) asserts each skin's `tempo` equals the manifest
   * tempo for its `track.id` so a re-cut that changes tempo can't silently desync.
   */
  tempo: number;
  board: BoardPalette;
  chrome: ChromePalette;
}

/** Skin 1 — neon purple + song 1 (flat /audio). Mirrors the round-2 palette. */
export const SKIN_NEON: Skin = {
  id: "neon",
  label: "Neon",
  track: TRACK_SONG1,
  // song1 "Especifico Primero" manifest tempo (public/audio/manifest.json).
  tempo: 109.957,
  board: {
    background: "#0a0a12",
    // Bright cell = the round-2 near-white crystal (unchanged from the baked-in
    // hard-coded values, now sourced from the palette).
    brightFace: "#eaf6ff",
    brightCore: "#f4fbff",
    brightGlass: "#cdeafe",
    brightEdge: "#ffffff",
    // Dark cell = AMBER / GOLD (2026-07-07). The round-2 purple dark cell was
    // purple-on-purple against the violet backdrop AND against the purple grid,
    // so it read as an outlined hole rather than a block. Rather than fight that
    // with lightness tweaks (the reverted contrast approach), the block takes a
    // complementary warm hue: gold pops hard against the neon violet, and it's
    // clear of skin 2's red/green and of blue. The grid stays purple (`gridLine`
    // below), so the well lattice is unchanged. Gem stays magenta-violet — a
    // high-contrast accent on the gold block.
    darkFace: "#8a5200",
    darkEmissive: "#ffb300",
    darkCore: "#a86400",
    darkCoreEmissive: "#ffcc33",
    darkBack: "#4a2c00",
    darkEdge: "#ffd766",
    // Grid line kept at the round-2 purple so the empty-square lattice reads
    // exactly as before — only the block hue changed.
    gridLine: "#6b4a9e",
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
 * Skin 2 — "Pipeline": a RED + GREEN scheme. The BRIGHT cell (block colour 0) is
 * a vivid GREEN crystal; the DARK cell (block colour 1) is a vivid RED. Both are
 * tuned to read clearly distinct on the dark video backdrop with strong contrast
 * (the red is kept bright/saturated rather than near-black so dark blocks don't
 * lose contrast). The canvas is a near-black nudged toward red, the edges/cores
 * carry the cell's own hue, and the gem stays a high-contrast accent.
 */
export const SKIN_PIPELINE: Skin = {
  id: "pipeline",
  label: "Pipeline",
  track: makeTrack("pipeline", "/audio/song2"),
  // song2 "Verde el Pipeline" manifest tempo (public/audio/manifest.json).
  tempo: 126.05,
  board: {
    background: "#120607",
    // BRIGHT cell = vivid green crystal (face / inner shape / glass / edge).
    brightFace: "#5dff8f",
    brightCore: "#a8ffc4",
    brightGlass: "#7dffaa",
    brightEdge: "#caffd9",
    // DARK cell = vivid red (kept bright + saturated so it holds contrast on the
    // dark backdrop, addressing the earlier "dark blocks lose contrast" flag).
    darkFace: "#7a1418",
    darkEmissive: "#e02430",
    darkCore: "#5e0f12",
    darkCoreEmissive: "#ff4d4d",
    darkBack: "#3d090b",
    darkEdge: "#ff6b6b",
    // Pipeline's grid line keeps the same red it always drew (the dark-cell edge
    // value pre-decouple), so this skin is visually unchanged by the split.
    gridLine: "#ff6b6b",
    gem: "#ffd24d",
  },
  chrome: {
    base: "#120607",
    accent: "#e02430",
    accentBright: "#5dff8f",
    accentDeep: "#9e1119",
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
