# Bottom-row clip/delay fix — design

Date: 2026-06-04
Status: self-approved (headless run)
Scope: one bug fix in the existing, working LLMines build. No rebuild.

## Problem

When a piece settles onto the bottom row (via gravity), it visibly hangs
**below** the playfield canvas for a beat and then snaps up into place. The
acceptance is that a settling/hard-dropped piece must always render entirely
within the canvas bounds, with no delay/clip artifact before it locks.

## Root cause

The active falling piece is drawn separately from the settled stack so it can
descend smoothly. The renderer (`renderer.ts` `drawPiece`) offsets it vertically
by `fallProgress * CELL`, where `fallProgress` is produced by the controller
(`controller.ts` `renderState`):

```
fallProgress = clamp(gravityAccumMs / GRAVITY_INTERVAL_MS, 0, 1)
```

This offset is applied **unconditionally**, including when the piece is already
**resting** (its next gravity row is illegal — bottom row, or atop the stack).
While resting, the piece does not move in game state, but `gravityAccumMs` keeps
accumulating over the up-to-700 ms before the next gravity tick locks it. So
`fallProgress` ramps 0 → 1 and drags the resting piece down by up to a full cell
— past the bottom grid line, below `BOARD_H` (the clip). When the gravity tick
finally fires, `lockPiece`/`settle` snaps it back onto the in-bounds bottom row
(the "delay then snap").

For a mid-air piece this offset is correct (it really is about to drop one row).
The bug is exclusively the **resting** case, where there is no legal next row to
interpolate toward, so the offset must be zero.

Note: the data layer is already correct — `settle()` bounds the grid to
`ROWS` rows, so `window.__lumines.state().grid` never has out-of-bounds cells.
This is purely a render-offset bug in production (rAF) mode; in test mode
`fallProgress` is already forced to 0.

## Fix

Gate the descent interpolation on whether the piece can actually descend. When
the active piece is resting, `fallProgress` is 0 and the piece renders exactly
on its grid row — in bounds, immediately, with no later snap.

Extract the (currently inline, untestable) computation into a small pure
function so it can be unit-tested in isolation:

```ts
// src/game/engine/fall-progress.ts
export function computeFallProgress(
  state: GameState,
  gravityAccumMs: number,
  intervalMs: number,
  testMode: boolean,
): number
```

Rules:
- `testMode` → 0 (deterministic harness; unchanged behaviour).
- no active piece → 0.
- piece is resting (`isResting(state)`, i.e. cannot descend) → 0.  ← the fix.
- otherwise → `clamp(gravityAccumMs / intervalMs, 0, 1)` (unchanged mid-air).

`controller.renderState()` calls this helper instead of computing inline.

## Components / data flow

```
GameController.advance (rAF) ── mutates gravityAccumMs, GameState
        │
        ▼
renderState() ──► computeFallProgress(state, accum, interval, testMode)
        │                                   │
        │                                   └─ isResting(state) (core, pure)
        ▼
RenderState.fallProgress ──► PixiRenderer.drawPiece (yOff = fallProgress*CELL)
```

Single responsibility: `computeFallProgress` decides how far the active piece
should be visually interpolated; the renderer just draws it. No other call site
reads `fallProgress`.

## What does NOT change (no regression)

- Mid-air smooth descent: unchanged for pieces that can still fall.
- Per-column overhang settle after a lock/clear: that is the renderer's
  `seedCollapse`/`fallOffsets` animation on the **settled** grid, entirely
  separate from active-piece `fallProgress`. Untouched.
- Lock timing / gameplay cadence: unchanged. We do not shorten the lock delay;
  with the offset removed the piece simply rests in place until the normal
  gravity tick converts it to settled cells (no visible reposition).
- Hard drop: already locks + spawns immediately in production; no lingering
  resting active piece. Helper guard is harmless here.

## Testing

- Unit (vitest, `src/game/engine/fall-progress.test.ts`): drive
  `computeFallProgress` directly.
  - resting on the bottom row with `gravityAccumMs` near full interval → 0
    (the regression guard — proves no below-bounds offset).
  - resting atop a stack mid-board → 0.
  - mid-air piece with half-interval accum → ~0.5 (descent preserved).
  - testMode → 0; no active piece → 0; clamps to [0,1].
- Existing e2e/unit suites must stay green (`pnpm test`). The grid-bounds
  acceptance is already covered by the "spawn places … tick to floor" e2e test
  (asserts settled cells land on rows 8–9 of a fixed 10-row grid).

## Acceptance mapping

- "renders entirely within bounds, no cells below grid" → resting piece has
  fallProgress 0, so `drawPiece` never offsets below `BOARD_H`.
- "no delay/clip artifact before lock; immediate + smooth" → no below-bounds
  hang and no later snap-up; the piece is drawn at its final row on arrival.
- "must not regress the smooth per-column overhang settle" → that path is the
  settled-grid collapse animation, untouched by this change.
