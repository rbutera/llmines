# New-block hold + deliberate re-press — design

Date: 2026-06-04
Status: self-approved (headless run)
Scope: one behaviour tweak in the existing, working LLMines build. No rebuild.

## Problem

When a block locks and the next one spawns at the top, a held fast/slow-fall key
carries over: the new block immediately continues fast-falling, and holding the
drop key chains piece-after-piece (the "soft-drop-cascade" bug). The second
fall should be **deliberate**.

## Behaviour (pinned)

- On every spawn, the new block **holds** at the top for a hold window. During
  the hold the player can rotate and move freely, but the block does not descend.
- The block begins falling when **either** (1) the hold timer lapses — then it
  falls at NORMAL gravity — or (2) the player makes a **fresh** deliberate
  fast/slow-fall press.
- A held key does **not** carry over across a lock. If the drop key was held when
  the previous block locked, the new block does not auto-fast-fall; the player
  must re-press. Holding through the transition never skips the hold.
- A fresh press during the hold engages fast/slow-fall immediately. A continuously
  held key resumes normal fast/slow-fall only **after** the hold lapses.

## Key design idea: fresh vs carried-over is a keyboard-edge distinction

Browsers already tell us: the first `keydown` of a physical press has
`event.repeat === false`; OS auto-repeat events (and therefore a key still held
down across a lock) have `event.repeat === true`. So:

- **Fresh press** (`!e.repeat`) → routes to the new `pressSoftDrop()` /
  `pressHardDrop()` controller methods → cancels the hold and applies the drop.
- **Carried-over / continuous hold** (`e.repeat`) → routes to the existing
  `input("softDrop")` / `input("hardDrop")` path → which is **suppressed while
  the block is holding** and only drives normal fall after the hold lapses.

To deliberately drop a new block you must release and re-press (producing a fresh
`!e.repeat` keydown). Holding continuously only ever produces `e.repeat` events,
which cannot cancel a hold — exactly "must re-press".

## Hold duration

`HOLD_MS = SECONDS_PER_BEAT * 1000 = 500ms` — one musical beat at 120 BPM. This
matches the rhythm framing, gives a clear "ready to place" beat, and is short
enough not to feel laggy.

## Architecture

The pure core owns the hold state and the gating; the controller owns timing and
the input edges; the React layer classifies presses; the renderer adds a polish
cue. Units stay small and independently testable, mirroring the existing
`fall-progress.ts` split.

### Core (pure, no DOM/time)

- `types.ts` — add `HoldState { active: boolean; remainingMs: number }` and a
  non-null `GameState.hold: HoldState` (default `{ active: false, remainingMs: 0 }`).
- `constants.ts` — add `HOLD_MS`.
- `hold.ts` (new) — depends only on types (no cycle with `piece.ts`):
  - `freshHold(): HoldState` → `{ active: true, remainingMs: HOLD_MS }`
  - `noHold(): HoldState` → `{ active: false, remainingMs: 0 }`
  - `isHolding(state): boolean` → `state.active !== null && state.hold.active`
  - `tickHold(state, dtMs): GameState` → decrement `remainingMs` by `dtMs`;
    release (set `noHold()`) when it reaches ≤ 0; never moves the piece.
  - `releaseHold(state): GameState` → cancel the hold immediately.
- `grid.ts` — `createGame` seeds `hold: noHold()`.
- `piece.ts`:
  - `spawnPiece` sets `hold: freshHold()` on a successful spawn (game-over branch
    leaves `noHold()`).
  - `gravityStep` and `hardDrop` become no-ops while `isHolding(state)` — the
    single, un-bypassable suppression point. `softDrop` inherits this via
    `gravityStep`.
  - `freshSoftDrop(state): { state, locked }` → `gravityStep(releaseHold(state))`.
  - `freshHardDrop(state): GameState` → `hardDrop(releaseHold(state))`.
- `index.ts` — `export * from "./hold"`; `publicState` includes `hold`.

### Controller (timing + edges)

- `advance(dtMs)` — sweep still runs during the hold (the music bar never pauses).
  If `isHolding`, call `tickHold(state, dtMs)` and keep `gravityAccumMs` at 0 so a
  just-released block falls at full normal cadence; otherwise accumulate gravity
  as today.
- `input("softDrop" | "hardDrop")` — unchanged call shape; these are the
  carried-over/continuous path and are naturally suppressed during the hold by the
  core gate. Move/rotate still work during the hold.
- New `pressSoftDrop()` / `pressHardDrop()` — fresh presses: apply
  `freshSoftDrop` / `freshHardDrop`, and in production (`!testMode`) autospawn on
  lock, mirroring the existing `input` drop handlers.
- `testTick()` — **hold-aware**: if holding, `tickHold(state, GRAVITY_INTERVAL_MS)`
  (one beat of time, no movement); otherwise one `gravityStep`. One test tick =
  one gravity beat, whether spent holding or falling. `HOLD_MS (500) <
  GRAVITY_INTERVAL_MS (700)` → a single tick lapses the hold without moving.
- `testPressSoftDrop()` / `testPressHardDrop()` — drive the fresh-press methods.
- `RenderState` gains `hold: HoldState`.

### React (`GameShell.tsx`)

Classify drop keys by freshness:

```ts
const action = keyToAction(e);
if (!action) return;
e.preventDefault();
if (action === "softDrop") {
  e.repeat ? controller.input("softDrop") : controller.pressSoftDrop();
} else if (action === "hardDrop") {
  e.repeat ? controller.input("hardDrop") : controller.pressHardDrop();
} else {
  controller.input(action); // left/right/rotate — work during the hold too
}
```

### Renderer (polish, optional but included)

`drawPiece` reads `rs.hold`. While `hold.active`, modulate the active piece's
glow with a gentle pulse (a "ready to place" shimmer) instead of the static 0.4
glow. Renderer-only; no logic/test impact.

### Test API (`install.ts`)

`LuminesTestApi` adds `pressSoftDrop()` and `pressHardDrop()`; `state()` already
carries `hold` via `publicState`. Carried-over holding is simulated by **not**
calling the press hooks across a `spawn()` — the block stays held until a press
or until the hold lapses (via `tick()`).

## Data flow

```
keydown ─┬─ !e.repeat drop ─► controller.pressSoftDrop/HardDrop ─► freshSoftDrop/HardDrop ─► releaseHold + drop
         ├─ e.repeat drop  ─► controller.input(drop) ─► gravityStep/hardDrop ─(gated by isHolding)─► no-op during hold
         └─ move/rotate    ─► controller.input(...)  ─► always applies

rAF advance(dt): isHolding ? tickHold(dt) (no gravity) : gravity accumulate → gravityStep → autospawn
spawnPiece ─► hold = freshHold()           tickHold reaches 0 ─► hold = noHold() ─► normal gravity resumes
```

## Error handling / edge cases

- First piece also holds (consistent; harmless; gives a start-of-game beat).
- `pressSoftDrop`/`pressHardDrop` guard on `started && !gameOver && active` like
  `input`.
- Locking a held piece (via `testSpawn`'s implicit lock, or a fresh hard drop)
  works unchanged: `lockPiece`/`settle` ignore the hold and bound to the grid.
- `computeFallProgress` gains an `isHolding(state) → 0` guard so a held piece
  never shows downward interpolation (defensive; accum is already 0 during hold).

## Testing

- `src/game/core/hold.test.ts` (unit): `freshHold`/`noHold` shapes; `isHolding`;
  `tickHold` decrements then releases at ≤ 0 without moving; `releaseHold` cancels;
  `gravityStep`/`hardDrop` are no-ops while holding; `spawnPiece` sets the hold;
  `freshSoftDrop`/`freshHardDrop` release then drop.
- `src/game/engine/fall-progress.test.ts`: add a held-piece → 0 case.
- `e2e/lumines.spec.ts`: extend `State` with `hold`; update the "tick advances"
  test to release the hold first; add:
  - spawn → `hold.active === true`, piece still at the top;
  - `tick()` consumes the hold (piece does not move, `hold.active === false`),
    next `tick()` moves it one row (normal gravity after the window);
  - `pressSoftDrop()` during the hold cancels it and advances immediately;
  - carried-over hold (no press hooks across `spawn()`) does not advance the new
    block during the hold window.
- All existing unit + e2e suites stay green (landing tests use `tick × 20`, still
  ample after a one-tick release).

## Acceptance mapping

- "new block does not advance faster than the hold allows unless a fresh press" →
  gravity gated by `isHolding`; only `pressSoftDrop/HardDrop` cancel the hold.
- "a key held through the lock does not auto-drop (must re-press)" → only
  `!e.repeat` fresh keydowns route to `press*`; `e.repeat` carried-over events hit
  the gated `input` path and are suppressed during the hold.
- "after the hold window with no fresh press, falls at normal gravity" →
  `tickHold` releases at ≤ 0, then `gravityStep` runs at the normal interval.
- Testability → `state().hold`, `pressSoftDrop()`, `pressHardDrop()`, hold-aware
  `tick()` all provided.
- Polish → 500ms one-beat hold + pulsing "ready" glow.
- No regression → existing gravity/settle/sweep/score/game-over paths untouched;
  the hold only gates descent and resets cleanly.
