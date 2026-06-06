# Phase 0 Research: New-Block Hold + Deliberate Re-Press

No `NEEDS CLARIFICATION` markers remained. Research is a grounding of the existing
brownfield code plus decisions on the few open mechanics.

## Decision 1 — Fresh-press detection via `KeyboardEvent.repeat`

**Decision**: Treat a drop input as a *fresh deliberate press* iff the originating
`keydown` has `e.repeat === false`. `GameShell` passes `fresh = !e.repeat` into
`controller.input(action, { fresh })`.

**Rationale**: The cascade bug's mechanism is `GameShell`'s `keydown` handler
(`src/game/react/GameShell.tsx`) calling `controller.input(action)` on every keydown,
*including OS auto-repeat events*, with no `e.repeat` check. A key held across the lock
keeps firing `repeat: true` keydowns → the new piece soft/hard-drops. The browser sets
`repeat: false` only on the initial press and again after a release+press, so
`!e.repeat` is exactly "fresh deliberate press." This needs no key-state tracking and is
robust across the lock→spawn transition.

**Alternatives considered**:
- *Track keyup/keydown to know if a key is "newly down"*: more state, equivalent result;
  `e.repeat` already encodes it.
- *Debounce/throttle drop inputs*: would dampen the cascade but not honour the
  deliberate "re-press" semantics, and would harm responsiveness.

## Decision 2 — Hold owned by the controller, not the pure core

**Decision**: The hold (`active`, `remainingMs`) is controller state, decremented in the
production `advance(dt)` loop, exactly like the existing `gravityAccumMs`. The pure core
(`src/game/core/**`) stays time-free.

**Rationale**: `core/types.ts` explicitly documents "No React/Pixi/DOM/**time** imports
anywhere in core." Wall-clock hold timing belongs with the controller, which already owns
gravity timing and the rAF loop. Only the *projection* `PublicState` gains a `hold` field;
the pure `publicState()` returns an inactive default (it has no timer), and the controller
overrides it in `testState()`.

**Alternatives considered**: Putting `remainingMs` into core `GameState` — rejected: it
would push wall-clock into the pure layer and break its determinism contract.

## Decision 3 — Hold lifecycle / state machine

**Decision**: On every spawn that yields an active piece, `beginHold()` sets
`{ active: true, remainingMs: HOLD_MS }`. Behaviour:
- **Holding**: gravity does not advance the piece; `advance(dt)` decrements `remainingMs`
  by `dt`; at `≤ 0` → `active = false`, and gravity accumulation resets so the first
  post-hold descent is a full normal interval later (normal gravity, FR-005).
- **Fresh soft-drop press while holding** → end hold immediately + perform soft-drop step
  (FR-004, US2).
- **Fresh hard-drop press while holding** → end hold immediately + hard-drop (which locks
  and, in production, spawns the next block → which enters its own hold).
- **Carried-over (non-fresh) drop while holding** → ignored (FR-003/FR-006).
- **Any drop when not holding** → unchanged existing behaviour (so a still-held key
  resumes normal soft-drop only after the hold completes — FR-006).
- **Move/rotate** → always processed, never affect the hold timer (FR-002).

**Rationale**: Directly encodes the pinned behaviour. Resetting gravity accumulation at
hold-end guarantees "normal gravity" (not an immediate catch-up drop). The hold re-arms on
every spawn, so holding the key across N locks skips zero holds (SC-006).

**Alternatives considered**: Ending the hold on *any* drop event (fresh or repeat) —
rejected: that is the current cascade. Pausing the sweep during the hold — rejected: the
sweep is music-synced and must keep running; only the piece descent is gated.

## Decision 4 — "fast/slow-fall" maps to soft-drop (+ hard-drop)

**Decision**: This build has soft-drop (fast, `j`/`ArrowDown`) and hard-drop (`Space`);
there is no separate "slow-fall" mechanic. The deliberate-press gating applies to
soft-drop and hard-drop. `SOFT_DROP_INTERVAL_MS` exists but is currently unused (soft-drop
is one `gravityStep` per keydown via key-repeat); this feature does not change that.

**Rationale**: The spec input phrases it generically as "fast/slow-fall"; mapped to the
actual controls, the drop keys are the inputs that must require a fresh press.

## Decision 5 — Deterministic test driving (hold-aware `tick()` + press hooks)

**Decision**:
- `tick()` becomes hold-aware: a tick while holding lapses the hold (no descent) instead
  of moving the piece; once not holding, `tick()` is the normal gravity step.
- `pressSoftDrop()` / `pressHardDrop()` perform *fresh* deliberate drops in test mode
  (end hold + drop one / hard-drop). Carry-over is simulated by simply not calling them
  across a `spawn()` — the block stays held until a press or the hold lapses.
- `state().hold` exposes `{ active, remainingMs }`.

**Rationale**: The test interface is wall-clock-free, so the hold must integrate with the
discrete stepper. Since `HOLD_MS (500) < GRAVITY_INTERVAL_MS (700)`, one `tick()` lapses
the hold — coarse but sufficient for the e2e assertions; fine-grained `remainingMs`
countdown is verified in a unit test that pumps the real production loop (the harness
proven in feature 001).

**Impact on existing tests**: The e2e "spawn places at top-centre; tick advances" asserts
that one tick after spawn descends the piece. With the hold, the first tick lapses the
hold (no descent) and the second descends. This single assertion is **updated** to reflect
the intended new behaviour (it encodes exactly the timing the feature changes). The
"land within ~20 ticks", square-clear, gravity-settle, sweep-timing, and game-over tests
are unaffected (they have ample ticks / don't assert first-tick descent).

## Verification strategy

- **Unit (Vitest)**: pump the production loop (mock `requestAnimationFrame`, controlled
  timestamps) to assert: held piece does not descend while `remainingMs > 0`; a fresh
  `input('softDrop', {fresh:true})` during hold drops immediately; a carried-over
  `input('softDrop', {fresh:false})` during hold is a no-op; after `HOLD_MS` elapses the
  piece descends at normal gravity; `getRenderState().hold` reflects the countdown.
- **e2e (Playwright)**: `state().hold.active` true on spawn with no press; `tick()` carry-
  over does not fast-drop; `pressSoftDrop()` drops immediately; hold lapses to normal
  gravity; holding across multiple spawns (not calling press hooks) skips no holds.
- **Regression**: full existing Vitest + Playwright suites green (with the one updated
  descent assertion), including the feature-001 bottom-row clip tests.
