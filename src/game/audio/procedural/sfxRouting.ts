/**
 * Per-action SFX routing — heat/tone model (design D6).
 *
 * The pure action→SFX one-shot map for SAMPLE mode (the recorded per-segment path).
 * In TONE mode the engine plays synthesised in-key tones instead and this map is not
 * used for the audible hit; it is kept as the recorded routing the `"sample"` selector
 * falls back to. Routing is mode-aware via {@link routeEvent}:
 *  - SAMPLE mode:
 *     - match → `stage` (forming a 2x2 square — the clear-stage sound)
 *     - chain → `stage` + a layered `drop` impact (D4a, audibly distinct)
 *     - lock → `drop` for EVERY settle (gravity / soft / hard); velocity scaled by
 *       cause at the call site (engine.play), not here
 *     - rotate → `rotate`, softDrop → `softdrop`
 *     - lineClear (sweep CLEAR) → SILENT (clearing makes no noise; only forming a
 *       match dings)
 *     - move → SILENT (a per-column blip on every step is noise against a music mix)
 *  - TONE mode: only `match`, `rotate`, `softDrop`, `lock` route (to tones); `move`,
 *    `lineClear` (sweep clear) and `chain` are SILENT (a chain is a clear — only
 *    forming a match dings). The engine builds the actual tone in-key; this returns a
 *    non-empty routing for the events that SOUND so the engine knows to play a tone.
 *
 * The `SfxName` set matches the manifest keys 1:1 (`move`, `rotate`, `softdrop`,
 * `drop`, `stage`).
 *
 * Pure data + pure helpers (no Tone import) so the routing stays unit-testable and
 * importable in any environment.
 */

import type { AudioEvent, SfxMode } from "./engine";

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
   * Undefined for every other event. Sample mode only.
   */
  layer?: SfxName;
}

/**
 * The SAMPLE-mode action→SFX map. `match`/`chain` route to the clear `stage`
 * (chain also layers a `drop` impact). `lock` routes to `drop` (universal settle).
 * `move` and the sweep `lineClear` are intentionally absent (silent — clearing makes
 * no noise, only forming a match dings).
 */
const SAMPLE_SFX: Partial<Record<AudioEvent["type"], VoiceRouting>> = {
  match: { sfx: "stage" },
  chain: { sfx: "stage", layer: "drop" },
  lock: { sfx: "drop" },
  rotate: { sfx: "rotate" },
  softDrop: { sfx: "softdrop" },
};

/**
 * The TONE-mode routing: which events SOUND a synthesised tone. `match`, `rotate`,
 * `softDrop` and `lock` sound; `move`, the sweep `lineClear` AND `chain` are silent
 * (a chain is a clear — only forming a match dings). The `sfx` value is a stable
 * non-empty marker (the recorded name) so callers can test "does this event sound in
 * tone mode" purely; the engine picks the actual in-key note from the event type.
 */
const TONE_SFX: Partial<Record<AudioEvent["type"], VoiceRouting>> = {
  match: { sfx: "stage" },
  lock: { sfx: "drop" },
  rotate: { sfx: "rotate" },
  softDrop: { sfx: "softdrop" },
};

/**
 * The voice routing for one event under the active mode (empty object = silence).
 * Defaults to `"tone"` when no mode is passed (the engine default). `move`, the sweep
 * `lineClear` and (in tone mode) `chain` return `{}` (silent by decision); every other
 * mapped event returns its one-shot(s).
 */
export function routeEvent(ev: AudioEvent, mode: SfxMode = "tone"): VoiceRouting {
  const map = mode === "sample" ? SAMPLE_SFX : TONE_SFX;
  return map[ev.type] ?? {};
}
