# Phase 1 Data Model: New-Block Hold + Deliberate Re-Press

The feature adds one small value object (`HoldState`) and a freshness flag on drop inputs.
The pure core grid/piece/sweep model is unchanged.

## New type: `HoldState` (`src/game/core/types.ts`)

| Field | Type | Meaning |
|-------|------|---------|
| `active` | `boolean` | True while the just-spawned block is holding at the top. |
| `remainingMs` | `number` | Milliseconds left in the hold window; counts down to 0. `0` when inactive. |

Validation / invariants:
- `remainingMs ≥ 0`; clamped at 0.
- `active === true` ⇒ `remainingMs > 0` (the hold ends the moment it reaches 0).
- When no active piece exists (none spawned, or just locked), the hold is inactive
  (`{ active: false, remainingMs: 0 }`).

## Changed: `PublicState` (`src/game/core/index.ts`)

`PublicState` gains `hold: HoldState`. The pure `publicState(state)` cannot read a timer,
so it returns the inactive default `{ active: false, remainingMs: 0 }`. The controller's
`testState()` overrides `hold` with the live controller value. (Existing fields `grid`,
`score`, `gameOver`, `sweepX` are unchanged.)

## Controller state (`src/game/engine/controller.ts`, not core)

New private fields, alongside the existing `gravityAccumMs`:

| Field | Type | Meaning |
|-------|------|---------|
| `holdActive` | `boolean` | Whether the current block is holding. |
| `holdRemainingMs` | `number` | Countdown for the current hold. |

`RenderState` also gains `hold: HoldState` (for the HUD/renderer "ready to place" beat and
for `getRenderState()`-based unit tests).

## Changed input contract

`input(action, opts?: { fresh?: boolean })` — `fresh` defaults to `true` (so existing
internal callers/tests that omit it behave as deliberate presses). Only `softDrop` /
`hardDrop` consult `fresh`; `left` / `right` / `rotate` ignore it.

## State transitions

```
            spawn (any path)
                 │  beginHold(): active=true, remainingMs=HOLD_MS
                 ▼
          ┌──────────────┐  move/rotate (allowed; timer unchanged)
          │   HOLDING    │◄─────────────────────────────────────────
          └──────────────┘
            │      │      │
   timer→0  │      │      │ fresh soft/hard-drop press
 (FR-005)   │      │      │ (FR-004)
            │      │      └───────────────► end hold + perform that drop
            │      │
            │      └─ carried-over (non-fresh) drop  ─► IGNORED (FR-003/FR-006)
            │
            ▼
     ┌──────────────┐  normal gravity; soft/hard-drop behave as today
     │   FALLING    │  (a still-held key now resumes normal soft-drop)
     └──────────────┘
            │ lock + spawn next
            └────────────────────► (next block re-enters HOLDING)
```

Notes:
- Entering FALLING from a lapsed hold resets gravity accumulation so the first descent is
  one full normal interval later (not an instant catch-up) — satisfies "normal gravity."
- `hardDrop` from HOLDING locks the piece and (production) spawns the next, which begins
  its own hold — so a held key cannot chain through it (cascade broken).

## Constant

`HOLD_MS` (`src/game/core/constants.ts`) `= SECONDS_PER_BEAT * 1000 = 500`. Single tunable
source; documented as "one beat."
