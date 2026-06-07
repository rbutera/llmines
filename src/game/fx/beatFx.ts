/**
 * Pure, presentation-only models for the Phase-2 "Arise VFX" layer. Kept free of
 * React / Three / DOM (exactly like `scoreFx.ts`) so the maths is deterministically
 * unit-testable in node. NONE of this reads or writes game state — it only turns
 * render-only signals (sweep position, fall velocity) into cosmetic scalars.
 */

import { COLS, COLS_PER_BEAT } from "../core";

/**
 * Beat phase in [0, 1) derived PURELY from the sweep position. `sweepX` runs over
 * [0, COLS] and the sweep advances `COLS_PER_BEAT` columns per beat, so the beat
 * count is `sweepX / COLS_PER_BEAT` and the phase is its fractional part. No clock
 * read, no core change: the sweep is already a pure function of musical time, so
 * this rides it for free. Phase 0 == on the beat.
 */
export function beatPhase(sweepX: number): number {
  const beats = sweepX / COLS_PER_BEAT;
  const frac = beats - Math.floor(beats);
  // Guard against tiny negative float from a wrap; clamp into [0,1).
  return frac < 0 ? frac + 1 : frac;
}

/**
 * A GENTLE, slow beat "breathe" multiplier centred on 1.0. Returns a value in
 * `[1 - strength, 1 + strength]` following a cosine so it eases through the beat
 * rather than snapping — explicitly NOT a strobe (Rai flagged a literal seizure
 * risk). The amplitude is the caller's `strength`; callers keep it small (the
 * default `beatStrength` is low) and the curve is smooth, so even at the slider
 * max there is no hard flash, just a swell. `enabled=false` returns a flat 1.
 *
 * The pulse peaks just AFTER the beat (phase 0) and troughs at the half-beat, a
 * single smooth swell per beat.
 */
export function beatBreathe(
  phase: number,
  strength: number,
  enabled = true,
): number {
  if (!enabled) return 1;
  const s = Math.max(0, strength);
  // cos(2*pi*phase): +1 at phase 0 (on the beat), -1 at the half-beat.
  return 1 + s * Math.cos(phase * Math.PI * 2);
}

/**
 * Soft-drop "heat" scalar in [0, 1] from the frame-to-frame fall velocity.
 * `fallVelocity` is rows-per-second of descent (render-only, measured from
 * successive `fallProgress` samples by the renderer). Normal gravity is ~1.4
 * rows/s (700ms/row); a soft drop is ~16 rows/s (60ms/row). We map everything
 * below `idleRps` to 0 heat and saturate at `maxRps`, so only a genuine fast
 * descent lights the piece up. Smoothstep so the ramp eases in.
 */
export function dropHeat(
  fallVelocity: number,
  idleRps = 3,
  maxRps = 14,
): number {
  if (!Number.isFinite(fallVelocity) || fallVelocity <= idleRps) return 0;
  const t = Math.min(1, (fallVelocity - idleRps) / (maxRps - idleRps));
  // smoothstep(0,1,t)
  return t * t * (3 - 2 * t);
}

/**
 * Particle count for a clear burst, scaled by how many cells cleared and hard
 * capped. Mirrors `burstParticleCount` in `scoreFx` but keyed on cleared CELLS
 * (the gate the Phase-2 layer uses) rather than the score delta. A single 2x2
 * square clears 4 cells; a big chain clears many. `perCell` particles each, with
 * a small floor so even a 1-cell clear sparks, capped at `cap`.
 */
export function clearBurstCount(
  clearedCells: number,
  perCell = 6,
  cap = 60,
  floor = 8,
): number {
  if (clearedCells <= 0) return 0;
  return Math.min(cap, Math.max(floor, Math.round(clearedCells * perCell)));
}

/** Convenience: total columns of the well, re-exported so fx callers need one import. */
export const WELL_COLS = COLS;
