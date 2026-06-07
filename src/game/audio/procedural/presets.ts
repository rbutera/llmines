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
  /** progression added per cleared square. */
  perSquare: number;
  /** progression added per combo step on a clear. */
  perCombo: number;
  /** progression added by a chain cascade (per cell, capped by the engine). */
  perChain: number;
  /** progression removed each beat when idle (pulls the mix back to the bed). */
  decayPerBeat: number;
  /**
   * [start, end] progression band over which each layer fades 0 -> full.
   * melody reveals lowest, then guitar, then vocals (the hot-streak payoff).
   */
  bands: {
    melody: [number, number];
    guitar: [number, number];
    vocal: [number, number];
  };
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
    perSquare: 0.05,
    perCombo: 0.04,
    perChain: 0.1,
    decayPerBeat: 0.012,
    bands: { melody: [0.12, 0.4], guitar: [0.45, 0.75], vocal: [0.8, 1.0] },
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
    perSquare: 0.08,
    perCombo: 0.07,
    perChain: 0.18,
    decayPerBeat: 0.022,
    bands: { melody: [0.06, 0.3], guitar: [0.32, 0.6], vocal: [0.62, 0.92] },
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
    perSquare: 0.12,
    perCombo: 0.1,
    perChain: 0.28,
    decayPerBeat: 0.018,
    bands: { melody: [0.04, 0.22], guitar: [0.22, 0.45], vocal: [0.45, 0.8] },
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
