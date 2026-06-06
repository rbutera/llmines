/**
 * Pure helpers for the cosmetic score effects. No React / DOM / time — fully
 * unit-testable. Maps a scoring delta to an effect tier and a count-up duration.
 * The authoritative score is never touched here; this only drives presentation.
 */

/** Celebration intensity for a scoring event. */
export type FxTier = "none" | "modest" | "big";

/**
 * Points at/above which a clear is "big" (extra particles/flash). A single 2x2
 * square scores 4 (modest); multi-square passes score 8+ (big).
 */
export const BIG_THRESHOLD = 8;

/** Map a score delta to its effect tier. Non-positive deltas celebrate nothing. */
export function fxTier(delta: number): FxTier {
  if (delta <= 0) return "none";
  if (delta >= BIG_THRESHOLD) return "big";
  return "modest";
}

const COUNT_UP_MIN_MS = 250;
const COUNT_UP_MAX_MS = 900;
const COUNT_UP_MS_PER_POINT = 30;

/**
 * How long the cosmetic count-up should run for a given delta: scales with the
 * gain but is clamped so it always feels snappy (and never absurdly long).
 */
export function countUpDurationMs(delta: number): number {
  if (delta <= 0) return 0;
  const raw = COUNT_UP_MIN_MS + delta * COUNT_UP_MS_PER_POINT;
  return Math.min(COUNT_UP_MAX_MS, Math.max(COUNT_UP_MIN_MS, raw));
}
