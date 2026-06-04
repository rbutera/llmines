/** Pure helpers behind the cosmetic score animation. No React / DOM. */

/** Magnitude tier for a single scoring event, by points gained. */
export type ScoreTier = "small" | "big" | "huge";

/** Lifetime of one score burst, in ms (count-up + particles + flash). */
export const BURST_MS = 1200;

/** Classify a gain: huge >= 24, big >= 12, else small. */
export function scoreTier(gain: number): ScoreTier {
  if (gain >= 24) return "huge";
  if (gain >= 12) return "big";
  return "small";
}

/** How many spark particles to emit for a tier. */
export function tierParticleCount(tier: ScoreTier): number {
  if (tier === "huge") return 20;
  if (tier === "big") return 12;
  return 6;
}

/** Ease-out cubic on a clamped t in [0, 1]. */
export function easeOutCubic(t: number): number {
  const c = Math.max(0, Math.min(1, t));
  return 1 - Math.pow(1 - c, 3);
}

/** Eased interpolation from `from` to `to` at progress `t` (clamped). */
export function tweenValue(from: number, to: number, t: number): number {
  return from + (to - from) * easeOutCubic(t);
}
