/**
 * Pure helpers for the BONUS TEXT overlay (the "SINGLE COLOUR!" / "ALL CLEAR!"
 * celebration banner). Kept free of React / DOM so the fire-once-per-id logic and
 * the per-kind presentation can be unit-tested in isolation.
 *
 * The board-state bonus already fires a render-only event
 * `RenderState.lastBonusClear: { id, kind, cells }` (monotonic id). The overlay
 * must show its text EXACTLY ONCE per event id, distinctly per kind, with the
 * bonus point value (a constant per kind — not carried on the event payload).
 */

import { ALL_CLEAR_BONUS, SINGLE_COLOUR_BONUS } from "../core";

export type BonusKind = "singleColour" | "allClear";

/** The fixed point award for each bonus kind (from the core scoring constants). */
export function bonusPoints(kind: BonusKind): number {
  return kind === "allClear" ? ALL_CLEAR_BONUS : SINGLE_COLOUR_BONUS;
}

/** The headline shown for each bonus kind. */
export function bonusLabel(kind: BonusKind): string {
  return kind === "allClear" ? "ALL CLEAR!" : "SINGLE COLOUR!";
}

/** The "+N" points string for each bonus kind, with thousands separators. */
export function bonusPointsLabel(kind: BonusKind): string {
  return `+${bonusPoints(kind).toLocaleString("en-US")}`;
}

/**
 * Decide whether a freshly-seen `lastBonusClear` event should FIRE the overlay,
 * given the last id we already fired for. Returns the new "last fired id" to
 * store. Pure: fires only when the event exists AND its id is strictly greater
 * than the last fired id (so a re-render with the same event never re-fires, and
 * a monotonic new event always fires). A reset (id goes backwards, e.g. a new
 * game) re-syncs WITHOUT firing.
 */
export function nextBonusFire(
  event: { id: number; kind: BonusKind } | undefined,
  lastFiredId: number,
): { fire: boolean; lastFiredId: number; kind?: BonusKind } {
  if (!event) return { fire: false, lastFiredId };
  if (event.id > lastFiredId) {
    return { fire: true, lastFiredId: event.id, kind: event.kind };
  }
  if (event.id < lastFiredId) {
    // Reset / restart: re-sync to the lower id but do not fire.
    return { fire: false, lastFiredId: event.id };
  }
  return { fire: false, lastFiredId };
}
