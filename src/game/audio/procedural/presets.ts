/**
 * Audio-mix presets — v2.7.
 *
 * Each preset is two things:
 *
 *  1. A ROUTING table — per ACTION {@link AudioEvent} type, which voices fire: a
 *     recorded ad-lib one-shot (`sfx`), a procedural in-key blip (`blip`), or both.
 *     CLEARS (lineClear / chain) have NO routing — a clear is SILENT by design (it
 *     only arms/reveals the vocal + advances the song; the engine adds a subtle
 *     non-match bed duck). Mapping a clear to a sound is the v2.6 bug.
 *  2. An UNLOCK CURVE — two knobs scaling the manifest's per-section gates: how
 *     much in-section clearing reveals the vocal (`voxUnlockClears`) and a
 *     `gateScale` multiplier on the advance gate (lower = the song moves faster).
 *
 * One engine reads the active preset, so switching mixes is instant. Pure data +
 * pure helpers (no Tone import) so the routing + curve are unit-testable.
 */

import type { AudioEvent } from "./engine";

export type AudioMix = "A" | "B" | "C";

/** Which voices an ACTION triggers under a given preset. */
export interface VoiceRouting {
  /** Recorded ad-lib one-shot to play (key into the SFX pool), if any. */
  sfx?: SfxName;
  /** Whether the procedural in-key blip for this action also fires. */
  blip?: boolean;
}

/**
 * The action SFX slices (public/audio/sfx-*.mp3). ACTIONS ONLY — there is
 * deliberately NO clear/match/gem/chain SFX (a clear is silent). song1 supplies
 * recorded ad-libs for these; song2 (sfxMode "procedural") uses in-key blips.
 */
export type SfxName = "move" | "rotate" | "softdrop" | "harddrop" | "stage";

/**
 * How clearing reveals + advances the song. v2.7: per-section gates live in the
 * MANIFEST; the preset only SCALES them, so all three mixes share one structural
 * model and differ in pace/feel.
 */
export interface UnlockCurve {
  /**
   * In-section clearing weight needed to reveal the active section's vocal
   * (loopLayer) or arm it (armedPhrase). Lower = the vocal comes in sooner.
   */
  voxUnlockClears: number;
  /**
   * Multiplier on each section's manifest `gate` (the clears to advance off that
   * section). <1 = faster through the song, >1 = slower / dwell longer.
   */
  gateScale: number;
}

export interface AudioPreset {
  mix: AudioMix;
  label: string;
  /** Routing per ACTION event type. Clears are absent (silent by design). */
  routing: Partial<Record<AudioEvent["type"], VoiceRouting>>;
  /** In-section vocal-reveal threshold. */
  voxUnlockClears: number;
  /** Multiplier on the manifest advance gates. */
  gateScale: number;
  /** Whether the master filter tracks intensity (B/C feel more reactive). */
  intensityReactive: boolean;
}

/** A — Subtle. Gentle, slow reveal; ad-libs only on rotate/drop; movement is light blips. */
const PRESET_A: AudioPreset = {
  mix: "A",
  label: "A · Subtle",
  routing: {
    move: { blip: true },
    rotate: { sfx: "rotate" },
    softDrop: { sfx: "softdrop" },
    lock: { sfx: "harddrop" },
  },
  voxUnlockClears: 3,
  gateScale: 1.3, // dwell longer in each section
  intensityReactive: false,
};

/** B — Reactive (default). Responsive reveal; ad-libs on the main actions; reactive filter. */
const PRESET_B: AudioPreset = {
  mix: "B",
  label: "B · Reactive",
  routing: {
    move: { blip: true },
    rotate: { sfx: "rotate" },
    softDrop: { sfx: "softdrop" },
    lock: { sfx: "harddrop" },
  },
  voxUnlockClears: 2,
  gateScale: 1.0,
  intensityReactive: true,
};

/** C — Maximal. Aggressive reveal; ad-libs on every action layered over blips; fastest advance. */
const PRESET_C: AudioPreset = {
  mix: "C",
  label: "C · Maximal",
  routing: {
    move: { sfx: "move", blip: true },
    rotate: { sfx: "rotate", blip: true },
    softDrop: { sfx: "softdrop", blip: true },
    lock: { sfx: "harddrop", blip: true },
  },
  voxUnlockClears: 1,
  gateScale: 0.7, // move through the song faster
  intensityReactive: true,
};

export const PRESETS: Record<AudioMix, AudioPreset> = {
  A: PRESET_A,
  B: PRESET_B,
  C: PRESET_C,
};

/** Default mix: B (Reactive). */
export const DEFAULT_MIX: AudioMix = "B";

/** Narrow an arbitrary string to a valid {@link AudioMix} (defaults to B). */
export function asAudioMix(v: unknown): AudioMix {
  return v === "A" || v === "B" || v === "C" ? v : DEFAULT_MIX;
}

/**
 * The voice routing for one event under a preset (empty object = silence). Clears
 * always route to silence (no entry in `routing`).
 */
export function routeEvent(preset: AudioPreset, ev: AudioEvent): VoiceRouting {
  return preset.routing[ev.type] ?? {};
}

/**
 * Map a value (0..1) onto a layer gain (0..1) given a [start, end] band: silent
 * below start, full above end, linear between. Pure.
 */
export function layerGain(
  value: number,
  [start, end]: [number, number],
): number {
  if (value <= start) return 0;
  if (value >= end) return 1;
  return (value - start) / (end - start);
}
