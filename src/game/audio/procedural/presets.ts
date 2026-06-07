/**
 * Audio-mix presets. Each preset is two things:
 *
 *  1. A ROUTING table — per {@link AudioEvent} type, which voices fire on that
 *     action: a recorded ad-lib one-shot (`sfx`), a procedural synth blip
 *     (`blip`), both, or nothing; plus whether a chain fires a filter `riser`.
 *  2. An UNLOCK CURVE — how fast "clearing advances the song". Clears bump a
 *     `progression` scalar; it decays when idle; per-layer gain thresholds map
 *     progression onto how much of the recorded song is revealed.
 *
 * One engine reads the active preset, so switching mixes is instant (no
 * teardown). Pure data + pure helpers (no Tone import) so the routing + curve
 * are unit-testable in isolation.
 */

import type { AudioEvent } from "./engine";

export type AudioMix = "A" | "B" | "C";

/** Which voices an action triggers under a given preset. */
export interface VoiceRouting {
  /** Recorded ad-lib one-shot to play (key into the SFX pool), if any. */
  sfx?: SfxName;
  /** Whether the procedural synth blip/voice for this action also fires. */
  blip?: boolean;
  /** Whether a chain fires the filter riser (only meaningful for `chain`). */
  riser?: boolean;
}

/** The eight curated ad-lib slices (see public/audio/sfx-*.mp3). */
export type SfxName =
  | "move"
  | "rotate"
  | "lock"
  | "match"
  | "softdrop"
  | "harddrop"
  | "gem"
  | "chain";

/** How clearing reveals the recorded song layers (the "build" curve). */
export interface UnlockCurve {
  // --- VERTICAL: vocal reveal within the active segment ---
  /** Flat progression added by ANY clear (so even a 1-square clear steps audibly). */
  perClear: number;
  /** progression added per cleared square. */
  perSquare: number;
  /** progression added per combo step on a clear. */
  perCombo: number;
  /** progression added by a chain cascade (per cell, capped by the engine). */
  perChain: number;
  /**
   * progression removed each quarter-note ONCE the post-clear grace window has
   * elapsed (the engine holds progression after each clear). Small, so a normal
   * clear cadence net-builds the vocal instead of bleeding out between clears.
   */
  decayPerBeat: number;
  /** [start, end] progression band over which the VOX layer fades 0 -> full. */
  vocalBand: [number, number];

  // --- HORIZONTAL: stepping forward through song segments ---
  /**
   * Clearing-weight needed to advance ONE segment. Weight per clear is
   * `1 + squares + combo` (chains: `2 + size`). Lower = the song moves through
   * its sections faster. Tuned so a normal session crosses several segments in
   * the first minute.
   */
  clearsPerSegment: number;
}

export interface AudioPreset {
  mix: AudioMix;
  label: string;
  /** Routing per event type. Missing entry = silence for that action. */
  routing: Record<AudioEvent["type"], VoiceRouting>;
  curve: UnlockCurve;
  /** Whether the master filter tracks intensity (B/C feel more reactive). */
  intensityReactive: boolean;
}

/**
 * A — Subtle. Gentle, slow reveal; ad-libs only on the big musical moments;
 * movement stays light procedural blips. Rotate still makes a (blip) sound.
 */
const PRESET_A: AudioPreset = {
  mix: "A",
  label: "A · Subtle",
  routing: {
    move: { blip: true },
    rotate: { blip: true },
    softDrop: { blip: true },
    lock: { blip: true },
    lineClear: { sfx: "match" },
    chain: { sfx: "chain" },
  },
  curve: {
    perClear: 0.12,
    perSquare: 0.06,
    perCombo: 0.05,
    perChain: 0.12,
    decayPerBeat: 0.014,
    vocalBand: [0.1, 0.55],
    clearsPerSegment: 5, // gentler horizontal advance
  },
  intensityReactive: false,
};

/**
 * B — Reactive (default). Responsive reveal that tracks momentum; ad-libs on
 * matches + hard-drops + chains; rotate gets a soft ad-lib; intensity-reactive
 * filter. The most representative "this is the game's sound" mix.
 */
const PRESET_B: AudioPreset = {
  mix: "B",
  label: "B · Reactive",
  routing: {
    move: { blip: true },
    rotate: { sfx: "rotate" },
    softDrop: { blip: true },
    lock: { sfx: "harddrop" },
    lineClear: { sfx: "match", blip: true },
    chain: { sfx: "chain", riser: true },
  },
  curve: {
    perClear: 0.18,
    perSquare: 0.08,
    perCombo: 0.07,
    perChain: 0.18,
    decayPerBeat: 0.02,
    vocalBand: [0.05, 0.45], // vox audibly in after ~1 clear, full after ~2
    clearsPerSegment: 3, // a normal session crosses several segments in the first minute
  },
  intensityReactive: true,
};

/**
 * C — Maximal. Aggressive reveal (full mix on a hot streak); ad-libs on EVERY
 * action layered over procedural blips; chain risers on. Loudest, busiest mix.
 */
const PRESET_C: AudioPreset = {
  mix: "C",
  label: "C · Maximal",
  routing: {
    move: { sfx: "move", blip: true },
    rotate: { sfx: "rotate", blip: true },
    softDrop: { sfx: "softdrop", blip: true },
    lock: { sfx: "lock", blip: true },
    lineClear: { sfx: "match", blip: true },
    chain: { sfx: "chain", blip: true, riser: true },
  },
  curve: {
    perClear: 0.28,
    perSquare: 0.12,
    perCombo: 0.1,
    perChain: 0.28,
    decayPerBeat: 0.016,
    vocalBand: [0.03, 0.32], // vox slams in fast
    clearsPerSegment: 2, // aggressive horizontal advance
  },
  intensityReactive: true,
};

export const PRESETS: Record<AudioMix, AudioPreset> = {
  A: PRESET_A,
  B: PRESET_B,
  C: PRESET_C,
};

/** Default mix: B (Reactive) — the most representative of the game's sound. */
export const DEFAULT_MIX: AudioMix = "B";

/** Narrow an arbitrary string to a valid {@link AudioMix} (defaults to B). */
export function asAudioMix(v: unknown): AudioMix {
  return v === "A" || v === "B" || v === "C" ? v : DEFAULT_MIX;
}

/** The voice routing for one event under a preset (empty object = silence). */
export function routeEvent(preset: AudioPreset, ev: AudioEvent): VoiceRouting {
  return preset.routing[ev.type] ?? {};
}

/**
 * Map a progression value (0..1) onto a layer gain (0..1) given the layer's
 * [start, end] reveal band: silent below start, full above end, linear between.
 * Pure — drives the smooth layer ramps without any Tone dependency.
 */
export function layerGain(progression: number, [start, end]: [number, number]): number {
  if (progression <= start) return 0;
  if (progression >= end) return 1;
  return (progression - start) / (end - start);
}
