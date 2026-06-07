# Design — F1: Bottom-row clip/delay fix

## Overview

The bug is entirely in the production render/timing path. The pure core
(`src/game/core/**`) is correct: `viewGrid` composites the active piece using
`inBounds`, so `state().grid` never contains out-of-bounds cells. The artifact
comes from two cooperating facts in `GameController`:

1. `renderState()` returns `fallProgress = gravityAccumMs / GRAVITY_INTERVAL_MS`
   for the active piece. The renderer (`PixiRenderer.drawPiece`) draws the piece
   at `pos.row * CELL + fallProgress * CELL`.
2. When the piece is resting (it cannot descend), `gravityAccumMs` keeps climbing
   toward `GRAVITY_INTERVAL_MS` (700ms) before `gravityStep` finally locks it.

So a resting piece is drawn sliding up to one full cell below its true landing
row (below `BOARD_H`) for up to ~700ms, then snaps up when it locks. That is the
"clip below the canvas + delay before snap" the report describes.

## Root cause

`fallProgress` is interpolation toward the NEXT row, but it is applied even when
there is no next row to fall into. A resting piece should have zero visual fall
offset, and it should not sit waiting a full gravity interval to lock.

## Changes

All changes are in `src/game/engine/controller.ts`. No core or renderer changes
are required; test mode already forces `fallProgress = 0`.

### 1. Clamp fall offset for a resting piece (Req 1, 2.2, 3)

In `renderState()`, compute `fallProgress` as `0` when the active piece cannot
descend. Use the existing pure helper `isResting(state)` from core.

```ts
fallProgress: this.testMode || isResting(this.state)
  ? 0
  : Math.max(0, Math.min(1, this.gravityAccumMs / interval)),
```

Effect: the moment a piece can no longer descend, it renders exactly on its
landing row(s) — never below the grid. Mid-fall pieces keep their smooth
fractional descent (Req 2.2).

### 2. Immediate settle on rest (Req 2.1)

In `advance(dtMs)`, after the gravity accumulation loop, if the game is still
live and the active piece is resting, lock it and spawn the next piece
immediately (resetting `gravityAccumMs`). This removes the up-to-700ms hover
before lock so the settle reads as immediate.

```ts
if (!this.state.gameOver && isResting(this.state)) {
  this.gravityAccumMs = 0;
  this.state = spawnNext(lockPiece(this.state));
}
```

`lockPiece` runs `settle`, and the renderer seeds its per-column collapse
animation from the resulting grid diff, so the smooth overhang settle (Req 4)
is preserved. `spawnNext` is the existing production auto-spawn path.

## Scope / non-goals

- Test mode is unaffected: the deterministic harness drives `tick()`/`spawn()`
  and `fallProgress` is already `0` in test mode, so `state().grid` assertions
  are unchanged.
- No change to scoring, sweep, RNG, or the core model.
- No new dependencies.

## Verification

- `pnpm build` (with `SKIP_ENV_VALIDATION=1 NEXT_PUBLIC_TEST_MODE=1`) succeeds.
- `pnpm test` (vitest core suite) stays green — core is untouched.
- Manual reasoning: a resting piece's render offset is `0`, so no cell is drawn
  below `BOARD_H`; lock happens on the next frame, so there is no visible delay.
