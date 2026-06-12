/**
 * Per-action SFX routing — FINE5 Wave 2 (preset-free).
 *
 * Extracted from the removed A/B/C preset system: keeps ONLY the action→SFX
 * one-shot routing. There is a SINGLE fixed map (no mix selector). Each gameplay
 * ACTION fires its recorded ad-lib one-shot; CLEARS (lineClear / chain) have NO
 * routing — a clear is SILENT by design (it only raises the gameplay intensity).
 *
 * Pure data + pure helper (no Tone import) so the routing stays unit-testable and
 * importable in any environment.
 */

import type { AudioEvent } from "./engine";

/**
 * The action SFX slices (public/audio/sfx-*.mp3). ACTIONS ONLY — there is
 * deliberately NO clear/match/gem/chain SFX (a clear is silent). song1 supplies
 * recorded ad-libs for these; song2 (sfxMode "procedural") uses in-key blips.
 */
export type SfxName = "move" | "rotate" | "softdrop" | "harddrop" | "stage";

/** Which voice an ACTION triggers — a recorded ad-lib one-shot (key into the SFX pool), if any. */
export interface VoiceRouting {
  /** Recorded ad-lib one-shot to play (key into the SFX pool), if any. */
  sfx?: SfxName;
}

/**
 * The single fixed action→SFX map. Replaces `routeEvent(preset, ev)`. Clears are
 * absent (silent by design). `move` is intentionally unmapped (movement stays quiet;
 * the prior "blip" was a procedural voice that no longer exists).
 */
const ACTION_SFX: Partial<Record<AudioEvent["type"], VoiceRouting>> = {
  rotate: { sfx: "rotate" },
  softDrop: { sfx: "softdrop" },
  lock: { sfx: "harddrop" },
};

/**
 * The voice routing for one event (empty object = silence). Clears always route to
 * silence (no entry in the map).
 */
export function routeEvent(ev: AudioEvent): VoiceRouting {
  return ACTION_SFX[ev.type] ?? {};
}
