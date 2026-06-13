/**
 * Per-action SFX routing — audio-truth (D4).
 *
 * The pure action→SFX one-shot map. There is a SINGLE fixed routing (no mix
 * selector). Each gameplay event fires its mapped recorded one-shot:
 *  - lineClear / chain → `stage` (the clear-stage sound, B3 fix — clears are no
 *    longer silent). `chain` is the bigger, rarer event and is routed audibly
 *    DISTINCT (a hot `stage` plus an optional layered `drop` impact — D4a, a
 *    single decision point so the ear-gate can A/B it).
 *  - lock → `drop` for EVERY settle (gravity / soft / hard), so a settle always
 *    thuds (B4 fix — not only on hard drops). Velocity is scaled by cause at the
 *    call site (engine.play), not here.
 *  - rotate → `rotate`, softDrop → `softdrop` (unchanged).
 *  - move → SILENT by explicit decision (a per-column blip on every step is noise
 *    against a music-led mix; the felt actions are rotate / soft-drop / lock /
 *    clear).
 *
 * The `SfxName` set matches the manifest keys 1:1 (`move`, `rotate`, `softdrop`,
 * `drop`, `stage`) — the prior `harddrop`→`drop` name quirk is gone.
 *
 * Pure data + pure helpers (no Tone import) so the routing stays unit-testable and
 * importable in any environment.
 */

import type { AudioEvent } from "./engine";

/**
 * The action SFX slices. Matches the manifest `sfx` keys ONE-TO-ONE: `move`,
 * `rotate`, `softdrop`, `drop`, `stage`.
 */
export type SfxName = "move" | "rotate" | "softdrop" | "drop" | "stage";

/** Which voice(s) an event triggers. */
export interface VoiceRouting {
  /** Primary one-shot to play (key into the SFX pool), if any. */
  sfx?: SfxName;
  /**
   * An optional SECOND one-shot layered under `sfx` (D4a — a `chain` layers a
   * `drop` impact under the hot `stage` so it sounds fatter than a plain clear).
   * Undefined for every other event.
   */
  layer?: SfxName;
}

/**
 * The single fixed action→SFX map. `lineClear`/`chain` route to the clear `stage`
 * (chain also layers a `drop` impact). `lock` routes to `drop` (universal settle).
 * `move` is intentionally absent (silent).
 */
const ACTION_SFX: Partial<Record<AudioEvent["type"], VoiceRouting>> = {
  lineClear: { sfx: "stage" },
  chain: { sfx: "stage", layer: "drop" },
  lock: { sfx: "drop" },
  rotate: { sfx: "rotate" },
  softDrop: { sfx: "softdrop" },
};

/**
 * The voice routing for one event (empty object = silence). `move` returns `{}`
 * (silent by decision); every other mapped event returns its one-shot(s).
 */
export function routeEvent(ev: AudioEvent): VoiceRouting {
  return ACTION_SFX[ev.type] ?? {};
}
