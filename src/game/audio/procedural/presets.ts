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

/**
 * How clearing reveals + advances the recorded song. v2.6: the vocal reveal is
 * STICKY per segment (no decay), so only two knobs remain — how much in-segment
 * clearing unlocks the vocal, and how much accumulated clearing steps a segment.
 */
export interface UnlockCurve {
  // --- VERTICAL: sticky vocal unlock within the active segment ---
  /**
   * Clearing-weight (within the current segment) needed to unlock the vocal
   * layer. Weight per clear is `1 + squares + combo` (chains: `2 + size`). Once
   * unlocked the vocal STAYS for that section (no idle decay). Lower = the vocal
   * comes in sooner.
   */
  voxUnlockClears: number;

  // --- HORIZONTAL: stepping forward through song segments ---
  /**
   * Clearing-weight needed to advance ONE segment (threshold is
   * `(segmentIndex+1)*clearsPerSegment`). Lower = the song moves through its
   * sections faster. Advance is forward-only + single-step + in-flight-locked,
   * so this cannot be spammed to fast-forward.
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
    rotate: { sfx: "rotate" }, // rotate must make a (distinct) sound in every preset
    softDrop: { sfx: "softdrop" }, // small-drop SFX
    lock: { sfx: "harddrop" }, // fast-drop slam SFX
    lineClear: { sfx: "match" }, // clear-stage SFX
    chain: { sfx: "chain" },
  },
  curve: {
    voxUnlockClears: 3, // gentle: vocal unlocks after a few in-segment clears
    clearsPerSegment: 6, // gentler horizontal advance
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
    softDrop: { sfx: "softdrop" }, // small-drop SFX (distinct from rotate/harddrop)
    lock: { sfx: "harddrop" }, // fast-drop slam SFX
    lineClear: { sfx: "match", blip: true }, // clear-stage SFX
    chain: { sfx: "chain", riser: true },
  },
  curve: {
    voxUnlockClears: 2, // responsive: vocal in after a couple of in-segment clears
    clearsPerSegment: 4, // a normal session steps through sections over the run
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
    softDrop: { sfx: "softdrop", blip: true }, // small-drop
    lock: { sfx: "harddrop", blip: true }, // fast-drop slam (consistent across presets)
    lineClear: { sfx: "match", blip: true }, // clear-stage
    chain: { sfx: "chain", blip: true, riser: true },
  },
  curve: {
    voxUnlockClears: 1, // vocal slams in on the first in-segment clear
    clearsPerSegment: 3, // aggressive horizontal advance
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
