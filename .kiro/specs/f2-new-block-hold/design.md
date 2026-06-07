# Design — F2: New-block hold + deliberate re-press

## Overview

Add a per-block "hold" window that pauses auto-gravity at spawn, plus a
fresh-press model that prevents a held drop key from carrying over the lock. The
hold is stored as pure data on `GameState` (so `publicState` can expose it),
while wall-clock decrement and the soft-drop engagement live in the controller.
Real keyboard carry-over is killed by ignoring auto-repeat keydowns for drop
keys in `GameShell`; the deterministic test seam exposes explicit
`pressSoftDrop`/`pressHardDrop` hooks.

## Data model

### `constants.ts`
- `NEW_BLOCK_HOLD_MS = SECONDS_PER_BEAT * 1000` (= 500ms, one beat).

### `types.ts` — `GameState`
- Add `hold: { active: boolean; remainingMs: number }`.

### `grid.ts` — `createGame`
- Initialise `hold: { active: false, remainingMs: 0 }`.

### `piece.ts`
- `spawnPiece`: on success set `hold: { active: true, remainingMs: NEW_BLOCK_HOLD_MS }`;
  on failure (game over) set `hold: { active: false, remainingMs: 0 }`.
- `lockPiece`: clear `hold` to `{ active: false, remainingMs: 0 }` (piece is gone;
  the next spawn re-arms it). `gravityStep`/`hardDrop` lock via `lockPiece`, so
  they inherit this.
- `moveLeft`/`moveRight`/`rotateCW` do NOT touch `hold` (move/rotate during hold).

### `index.ts` — `PublicState` / `publicState`
- Add `hold: { active: boolean; remainingMs: number }` to `PublicState` and copy
  `state.hold` through in `publicState`.

## Controller (`controller.ts`)

New private field: `softDropEngaged = false` (input state, not core).

### `RenderState`
- Add `holdActive: boolean` so the renderer can show the "ready to place" beat.

### Active gravity interval
- Helper `currentIntervalMs()` returns `softDropEngaged ? SOFT_DROP_INTERVAL_MS : GRAVITY_INTERVAL_MS`.

### `advance(dtMs)` (production loop)
1. `advanceSweep` as today.
2. If `state.hold.active`: decrement `remainingMs` by `dtMs`; when it reaches 0,
   set `hold.active = false` and reset `gravityAccumMs = 0`. **Return early — no
   gravity while held.**
3. Else: accumulate `gravityAccumMs`; step gravity using `currentIntervalMs()`.
   On a lock, spawn-and-reset (see below). Then the F1 immediate-settle: if the
   piece is resting, `spawnNext(lockPiece(state))` and reset.

### Spawn-and-reset
A single place that, after a lock, does:
`state = spawnNext(state); gravityAccumMs = 0; softDropEngaged = false;`
This guarantees Req 3.3 (engagement reset on every spawn → carry-over killed).

### Input methods
- `input()` keeps `left`/`right`/`rotate` (work during hold). `softDrop`/
  `hardDrop` delegate to the press methods.
- `pressSoftDrop()` (fresh press): guard on active/live; `endHold()`;
  `softDropEngaged = true`; one `gravityStep`; if it locked and not test mode,
  spawn-and-reset; emit.
- `pressHardDrop()` (fresh press): guard; `endHold()`; `softDropEngaged = false`;
  `hardDrop`; if not test mode, spawn-and-reset; emit.
- `releaseSoftDrop()`: `softDropEngaged = false`.
- `endHold()`: `state.hold = { active: false, remainingMs: 0 }`.

### `renderState()`
- `fallProgress = (testMode || hold.active || isResting) ? 0 : clamp(gravityAccumMs / currentIntervalMs())`.
- `holdActive = state.hold.active`.

### Test interface
- `testSpawn`: after spawning, reset `softDropEngaged = false`, `gravityAccumMs = 0`.
- `testState` returns `publicState` (now includes `hold`).

## Test seam (`install.ts`)
- Add `pressSoftDrop()` and `pressHardDrop()` to `LuminesTestApi` and the
  `window.__lumines` object, wired to the controller methods.
- `state()` already returns `hold` via `publicState`.

## Keyboard (`GameShell.tsx`)
- keydown: `left`/`right`/`rotate` → `controller.input(action)` (repeat allowed).
  `softDrop`/`hardDrop` → only when `!e.repeat` call `controller.pressSoftDrop()`
  / `pressHardDrop()`. Auto-repeat keydowns are ignored, so a key held across the
  lock produces only repeats (ignored) → no carry-over; the player must release
  and re-press for a fresh keydown.
- keyup: soft-drop key → `controller.releaseSoftDrop()`.

## Renderer (`renderer.ts`) — polish
- In `drawPiece`, when `rs.holdActive`, use a stronger pulsing glow so the held
  block reads as "ready to place" (intentional, not laggy). No layout change.

## Why existing tests still pass
- `tick()` calls `gravityStep`, which ignores `hold`, so a spawned piece still
  advances one row per tick and never auto-spawns (Req 5.2).
- Core unit tests don't assert full `GameState` equality; the added `hold` field
  is inert for them (Req 5.1).
- Keyboard move/rotate are single presses in the E2E suite (`!e.repeat`), so the
  drop-key repeat gating doesn't affect them.
- The F1 immediate-settle path is preserved and reuses the spawn-and-reset (Req 5.3).

## Verification
- `pnpm build` (TEST_MODE) passes; `pnpm test` stays green.
- Add focused core unit tests for: spawn arms hold; lock clears hold;
  publicState exposes hold.
