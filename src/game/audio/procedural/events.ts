/**
 * Derive {@link AudioEvent}s by DIFFING successive RenderStates.
 *
 * The audio layer is a pure event-SUBSCRIBER: it reads the RenderState the
 * controller already emits and never touches game logic, the deterministic core,
 * RNG, or the `window.__lumines` seam. This keeps the spike strictly additive.
 *
 * What each event is inferred from (all render-only fields already present):
 *  - move      : active piece column changed (no rotation) between emits
 *  - rotate    : active piece `cells` matrix changed (rotation) between emits
 *  - softDrop  : `softDropPulses` counter advanced
 *  - lock      : the active piece IDENTITY changed via a spawn (a new piece
 *                appeared at the top) OR a hard-drop slam id advanced — both mean
 *                "a piece just settled". Deduped so we fire once per settle.
 *  - lineClear : `score` increased (the sweep cleared squares); `squares` is a
 *                rough estimate from the score delta, `combo` is unknown from the
 *                projection so passed as 0 here (kept simple for the spike).
 *  - chain     : `lastChainClear.id` advanced (a chain flood happened); `size`
 *                from the cleared component length.
 *
 * Pure: construct one Deriver per game, feed it each RenderState, get back the
 * list of events to fire. No Tone import.
 */

import type { RenderState } from "../../engine/controller";
import type { AudioEvent } from "./engine";

interface Snapshot {
  col: number | null;
  cellsKey: string | null;
  softDropPulses: number;
  hardDropId: number;
  chainId: number;
  score: number;
  hasActive: boolean;
}

/** Serialise the active piece's 2x2 colour matrix to detect a rotation. */
function cellsKey(active: NonNullable<RenderState["active"]>): string {
  return active.cells.map((r) => r.join("")).join("|");
}

export class AudioEventDeriver {
  private prev: Snapshot | null = null;

  /** Diff `rs` against the previous snapshot, returning events to fire. */
  derive(rs: RenderState): AudioEvent[] {
    const cur: Snapshot = {
      col: rs.active?.pos.col ?? null,
      cellsKey: rs.active ? cellsKey(rs.active) : null,
      softDropPulses: rs.softDropPulses ?? 0,
      hardDropId: rs.lastHardDrop?.id ?? 0,
      chainId: rs.lastChainClear?.id ?? 0,
      score: rs.score,
      hasActive: rs.active != null,
    };

    const events: AudioEvent[] = [];
    const prev = this.prev;

    if (prev) {
      // --- line clear (score went up) ---
      if (cur.score > prev.score) {
        const delta = cur.score - prev.score;
        // Rough: each cleared square is worth ~40 base; estimate the count so the
        // run length scales. Floor at 1 so any positive delta sings.
        const squares = Math.max(1, Math.round(delta / 40));
        events.push({ type: "lineClear", squares, combo: 0 });
      }

      // --- chain cascade (new chain-clear id) ---
      if (cur.chainId > prev.chainId) {
        const size = rs.lastChainClear?.cells.length ?? 4;
        events.push({ type: "chain", size });
      }

      // --- lock / settle (hard-drop slam OR a fresh piece replaced the old) ---
      const hardDropped = cur.hardDropId > prev.hardDropId;
      // A "new piece" settle: there was an active piece, and now there's an
      // active piece whose shape+col differ in the way a spawn does (back at the
      // top). We approximate a settle as "hardDrop id advanced" (the clean
      // signal) — soft/gravity locks are harder to disambiguate from the
      // projection alone, so we keep the lock thud tied to the unambiguous slam
      // to avoid false thuds on every move. (Documented spike trade-off.)
      if (hardDropped) {
        events.push({ type: "lock" });
      }

      // --- soft drop step ---
      if (cur.softDropPulses > prev.softDropPulses) {
        events.push({ type: "softDrop" });
      }

      // --- move / rotate (only when the same piece persists, no settle) ---
      if (cur.hasActive && prev.hasActive && !hardDropped) {
        const rotated = cur.cellsKey !== prev.cellsKey && cur.cellsKey !== null;
        const moved = cur.col !== prev.col && cur.col !== null;
        if (rotated) {
          events.push({ type: "rotate" });
        } else if (moved) {
          events.push({ type: "move" });
        }
      }
    }

    this.prev = cur;
    return events;
  }

  reset(): void {
    this.prev = null;
  }
}
