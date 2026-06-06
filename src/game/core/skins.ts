/**
 * Skin / progression data. Progression is modelled as an ordered list of skins,
 * each carrying a BPM (which drives the sweep speed via the controller's
 * time->columns conversion) plus the render-only palette / visual theme. The
 * audio half of a skin bundle (track stems + SFX) is added by a later change.
 *
 * Pure data: no time / DOM / audio imports, so this lives in the pure core.
 */

/** A pair of cell colours for the two block colours (A = index 0, B = index 1). */
export type BlockPalette = readonly [string, string];

export interface Skin {
  id: string;
  /** CSS colours for the two block colours; render-only. */
  blockPalette: BlockPalette;
  /** A render-only theme key (background glow, sweep colour, etc.). */
  visualTheme: string;
  /** Tempo in beats per minute; drives sweep speed via the timeline conversion. */
  bpm: number;
  /** Time signature, e.g. [4, 4]; carried for the audio change. */
  timeSignature: readonly [number, number];
}

/**
 * Ordered skin list. Each successive skin raises the BPM so the sweep visibly
 * speeds up as the player progresses. At least 2-3 skins ship to demonstrate the
 * transition.
 */
export const SKINS: readonly Skin[] = [
  {
    id: "neon-dawn",
    blockPalette: ["#37e0c9", "#ff5fb0"],
    visualTheme: "dawn",
    bpm: 120,
    timeSignature: [4, 4],
  },
  {
    id: "midnight-drive",
    blockPalette: ["#7c5cff", "#ffd166"],
    visualTheme: "drive",
    bpm: 144,
    timeSignature: [4, 4],
  },
  {
    id: "solar-flare",
    blockPalette: ["#ff7a45", "#36cfff"],
    visualTheme: "flare",
    bpm: 168,
    timeSignature: [4, 4],
  },
] as const;

/** The skin at `index`, clamped to the last skin once progression maxes out. */
export function skinAt(index: number): Skin {
  const clamped = Math.max(0, Math.min(index, SKINS.length - 1));
  return SKINS[clamped]!;
}

/** BPM of the skin at `index` (clamped). */
export function skinBpm(index: number): number {
  return skinAt(index).bpm;
}
