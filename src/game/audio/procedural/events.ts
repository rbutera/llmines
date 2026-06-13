/**
 * Derive {@link AudioEvent}s by DIFFING successive RenderStates.
 *
 * The audio layer is a pure event-SUBSCRIBER: it reads the RenderState the
 * controller already emits and never touches game logic, the deterministic core,
 * RNG, or the `window.__lumines` seam. This keeps the layer strictly additive.
 *
 * TRUTHFUL clear/lock telemetry (audio-truth, D1): clears and locks are derived
 * from the controller's MONOTONIC-ID telemetry records, NEVER from a score delta.
 * The previous `round(scoreDelta/40)` estimate is gone — a proxy that lies in both
 * directions (soft-drop bonuses faked clears; multiplied passes inflated squares)
 * silently corrupted the clear-gated progression (README B1). There is no
 * score-based fallback: an absent telemetry field degrades to SILENCE (no event),
 * never to inference.
 *
 * What each event is derived from (all render-only or monotonic-id fields):
 *  - move      : active piece column changed (no rotation) between emits
 *  - rotate    : active piece `cells` matrix changed (rotation) between emits
 *  - softDrop  : `softDropPulses` counter advanced
 *  - lock      : `lastLock.id` advanced (one per settle — gravity / soft / hard),
 *                carrying the settle `cause` so routing can scale the thud (B4)
 *  - lineClear : `lastPassComplete.id` advanced AND its real `squares >= 1`
 *                (a zero-square pass-id bump emits nothing); `combo` carries
 *                `comboMultiplier - 1` (the streak offset, 0 = no streak) so the
 *                engine's heat gain (squares + combo) is fed truthfully (B1)
 *  - chain     : `lastChainClear.id` advanced (a chain flood happened); `size`
 *                from the cleared component length (already render-truthful)
 *  - match     : the render-only `markedSquares` count (= distinct staged 2x2
 *                squares on the settled grid) ROSE versus the previous frame, on
 *                ANY frame; `squares` carries the positive delta. NOT gated on
 *                `lastLock.id` (which a post-clear gravity cascade does not bump),
 *                so a cascade-formed square dings too. A DECREASE (the sweep erasing
 *                a square) emits nothing — the clear stays silent (design D6)
 *
 * Pure: construct one Deriver per game, feed it each RenderState, get back the
 * list of events to fire. No Tone import.
 */

import type { RenderState } from "../../engine/controller";
import type { AudioEvent } from "./engine";

/**
 * STRUCTURAL VIEW of the truthful clear/lock telemetry the sibling
 * `core-lumines-fidelity` change adds to RenderState. This worktree's RenderState
 * does NOT yet carry these fields (they land with the sibling), so the adapter
 * reads them through this `Partial` intersection — it compiles now and needs zero
 * change after merge (the field names are the sibling's final, design.md D1).
 *
 * `groupErases` is carried for completeness (the deriver does not weight by it
 * today) — the contract shape is `{ cells: number[]; hadChain: boolean }[]`.
 */
type TelemetryCarrier = Partial<{
  /** One record per completed sweep pass that erased ≥1 square (monotonic id). */
  lastPassComplete: {
    id: number;
    /** REAL squares erased this pass (group geometry, NOT score/40). */
    squares: number;
    /** Cross-pass streak multiplier in effect (1 = no streak). */
    comboMultiplier: number;
    /** Contiguous marked groups erased this pass (record-only). */
    groupErases: { cells: number[]; hadChain: boolean }[];
  };
  /** One record per piece settle (gravity / soft / hard) — monotonic id + cause. */
  lastLock: { id: number; cause: "gravity" | "soft" | "hard" };
}>;

/** A render state viewed as ALSO (maybe) carrying the new telemetry fields. */
type TelemetryRenderState = RenderState & TelemetryCarrier;

/** Normalized pass-completion telemetry for one frame. */
interface PassTelemetry {
  id: number;
  squares: number;
  comboMultiplier: number;
  /** Number of contiguous marked groups erased this pass. */
  groupErases: number;
}
/** Normalized lock telemetry for one frame. */
interface LockTelemetry {
  id: number;
  cause: "gravity" | "soft" | "hard";
}

/**
 * The SINGLE adapter for the new pass/lock telemetry (D7). All access to the
 * sibling's field names lives here, so a rename is a one-line change and the
 * events tests assert against THIS output, not raw RenderState fields.
 *
 * When a field is ABSENT (the sibling not yet merged) the corresponding entry is
 * `undefined` — "no pass / no lock this frame". The deriver then emits no
 * `lineClear`/`lock`, remaining SILENT rather than reintroducing any lying
 * score-based path (B1). The `groupErases` array length is the design's
 * `groupErases: number` view.
 *
 * TODO(core-lumines-fidelity): once the telemetry fields are guaranteed present
 * on RenderState, drop the absence shim (the `?.` / `undefined` returns) and read
 * the fields directly.
 */
function readTelemetry(rs: RenderState): {
  pass?: PassTelemetry;
  lock?: LockTelemetry;
} {
  const t = rs as TelemetryRenderState;
  const lp = t.lastPassComplete;
  const ll = t.lastLock;
  const pass: PassTelemetry | undefined =
    lp && typeof lp.id === "number"
      ? {
          id: lp.id,
          squares: lp.squares,
          comboMultiplier: lp.comboMultiplier,
          groupErases: Array.isArray(lp.groupErases) ? lp.groupErases.length : 0,
        }
      : undefined;
  const lock: LockTelemetry | undefined =
    ll && typeof ll.id === "number" ? { id: ll.id, cause: ll.cause } : undefined;
  return { pass, lock };
}

interface Snapshot {
  col: number | null;
  cellsKey: string | null;
  softDropPulses: number;
  /** Monotonic id of the last pass-completion (0 = none seen). */
  passId: number;
  /** Monotonic id of the last settle (0 = none seen). */
  lockId: number;
  chainId: number;
  hasActive: boolean;
  /** Distinct staged 2x2 squares on the settled grid this frame (the match signal). */
  markedSquares: number;
}

/** Serialise the active piece's 2x2 colour matrix to detect a rotation. */
function cellsKey(active: NonNullable<RenderState["active"]>): string {
  return active.cells.map((r) => r.join("")).join("|");
}

export class AudioEventDeriver {
  private prev: Snapshot | null = null;

  /** Diff `rs` against the previous snapshot, returning events to fire. */
  derive(rs: RenderState): AudioEvent[] {
    const { pass, lock } = readTelemetry(rs);
    const cur: Snapshot = {
      col: rs.active?.pos.col ?? null,
      cellsKey: rs.active ? cellsKey(rs.active) : null,
      softDropPulses: rs.softDropPulses ?? 0,
      passId: pass?.id ?? 0,
      lockId: lock?.id ?? 0,
      chainId: rs.lastChainClear?.id ?? 0,
      hasActive: rs.active != null,
      markedSquares: typeof rs.markedSquares === "number" ? rs.markedSquares : 0,
    };

    const events: AudioEvent[] = [];
    const prev = this.prev;

    if (prev) {
      // --- match (a 2x2 square newly STAGED — the distinct-square count ROSE) ---
      // Decoupled from `lastLock.id` (a post-clear gravity cascade forms a square
      // WITHOUT bumping the lock id, design D6): emit when the render-only
      // `markedSquares` count rises on ANY frame, carrying the positive delta. A
      // DECREASE (the sweep erasing a square) emits nothing — the clear stays silent.
      if (cur.markedSquares > prev.markedSquares) {
        events.push({
          type: "match",
          squares: cur.markedSquares - prev.markedSquares,
        });
      }

      // --- line clear (real pass-completion id advanced AND squares >= 1) ---
      // No score read. A zero-square pass-id bump emits nothing. `combo` =
      // comboMultiplier - 1 so the engine's heat gain (squares + combo) is fed
      // truthfully (1 = no streak → 0). The sweep clear is SILENT in tone mode; the
      // lineClear event still feeds HEAT.
      if (pass && cur.passId > prev.passId && pass.squares >= 1) {
        events.push({
          type: "lineClear",
          squares: pass.squares,
          combo: pass.comboMultiplier - 1,
        });
      }

      // --- chain cascade (new chain-clear id) ---
      if (cur.chainId > prev.chainId) {
        const size = rs.lastChainClear?.cells.length ?? 4;
        events.push({ type: "chain", size });
      }

      // --- lock / settle (one per settle, carrying the cause) ---
      // Every settle — gravity, soft, hard — fires exactly one lock from the
      // monotonic lock id. No separate hard-drop/spawn detection path, so there
      // is no duplicate thud (B4).
      if (lock && cur.lockId > prev.lockId) {
        events.push({ type: "lock", cause: lock.cause });
      }

      // --- soft drop step ---
      if (cur.softDropPulses > prev.softDropPulses) {
        events.push({ type: "softDrop" });
      }

      // --- move / rotate (only when the same piece persists, no fresh settle) ---
      const settled = lock != null && cur.lockId > prev.lockId;
      if (cur.hasActive && prev.hasActive && !settled) {
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
