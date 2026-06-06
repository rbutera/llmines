/**
 * Pure, presentation-only model for the animated score feedback. Kept free of
 * React/DOM so the count-up / intensity logic is deterministically unit-testable
 * in node. The authoritative score value (the `data-testid="score"` text) never
 * flows through here — this only drives the cosmetic overlay + canvas burst.
 */

/**
 * Score gain at/above which the feedback is "maxed out" (a big multi-square
 * sweep). A single 2x2 square scores 4; a double scores ~12, so 12 reads as a
 * big clear. Tuning knob for how impactful gains feel.
 */
export const BIG_CLEAR_DELTA = 12;

/** Cosmetic count-up duration (ms). */
export const COUNT_UP_MS = 320;

/** Lifetime of a floating "+N" delta indicator (ms). */
export const FLOAT_MS = 950;

/** A positive score change deserves a burst/indicator; non-positive does not. */
export function shouldBurst(prev: number, next: number): boolean {
  return next > prev;
}

/** Normalised 0..1 intensity for a delta; 0 for non-positive deltas. */
export function scoreIntensity(delta: number, bigClear = BIG_CLEAR_DELTA): number {
  if (delta <= 0) return 0;
  return Math.min(1, delta / bigClear);
}

/** easeOutCubic in [0,1]. */
function easeOutCubic(t: number): number {
  const c = Math.max(0, Math.min(1, t));
  return 1 - Math.pow(1 - c, 3);
}

/**
 * Eased count-up value from `from` to `to` at progress `t` in [0,1], rounded to
 * an integer (the overlay shows whole points). `t<=0` => from, `t>=1` => to.
 */
export function countUpValue(from: number, to: number, t: number): number {
  return Math.round(from + (to - from) * easeOutCubic(t));
}

/** Number of burst particles for a delta, scaled by intensity and capped. */
export function burstParticleCount(
  delta: number,
  cap = 40,
  bigClear = BIG_CLEAR_DELTA,
): number {
  if (delta <= 0) return 0;
  const intensity = scoreIntensity(delta, bigClear);
  return Math.min(cap, Math.round(6 + intensity * (cap - 6)));
}
