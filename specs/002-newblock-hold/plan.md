# Implementation Plan: New-Block Hold + Deliberate Re-Press

**Branch**: `002-newblock-hold` | **Date**: 2026-06-04 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/002-newblock-hold/spec.md`

## Summary

When a block locks and the next spawns, the new block must **hold** at the top for one
beat (500 ms) before gravity takes it, and a drop key **held across the lock** must not
carry over — only a *fresh* press may drop early. This kills the soft-drop/hard-drop
cascade.

**Technical approach** (localized to the controller + input edge + test API):

1. **Distinguish fresh vs carried-over presses at the keyboard edge** using
   `KeyboardEvent.repeat`. `GameShell`'s `keydown` handler passes `fresh = !e.repeat` to
   `controller.input(action, { fresh })`. The initial press is `repeat === false`; a key
   held across the lock keeps emitting `repeat === true`; re-pressing yields a new
   `repeat === false`. Move/rotate are unaffected (repeat still allowed for held movement).
2. **Add a hold phase to the controller.** On every new-block spawn, begin a hold
   (`{ active: true, remainingMs: HOLD_MS }`). While holding, gravity does not advance the
   piece; the hold timer counts down in the production `advance(dt)` loop. The hold ends
   when (a) the timer reaches 0 → normal gravity resumes, or (b) a **fresh** soft/hard-drop
   press arrives → the hold ends immediately and that drop engages. A non-fresh
   (carried-over) drop is ignored while holding, and behaves normally once not holding (so
   continuous soft-drop still works after the hold and the cascade is broken at each spawn).
3. **Expose observability + deterministic control.** `state()` gains
   `hold: { active, remainingMs }`. New `pressSoftDrop()` / `pressHardDrop()` test hooks
   perform *fresh* deliberate drops. `tick()` becomes hold-aware: a tick during the hold
   lapses it (no descent) instead of moving the piece; carry-over is simulated simply by
   not calling the press hooks across a `spawn()`.

`HOLD_MS = 500` is derived from the existing `SECONDS_PER_BEAT` (0.5 s) constant. The pure
core (grid/piece/sweep) is unchanged except for adding the `hold` field to the public-state
projection with an inactive default.

## Technical Context

**Language/Version**: TypeScript 5.x (strict), React 18, Next.js App Router

**Primary Dependencies**: React (input/HUD), pixi.js (render); Vitest (unit), Playwright (e2e)

**Storage**: N/A (in-memory game state)

**Testing**: Vitest (`pnpm test`) for core + controller; Playwright (`pnpm test:e2e`) driving `window.__lumines` under `NEXT_PUBLIC_TEST_MODE=1`

**Target Platform**: Modern browsers (desktop + mobile web)

**Performance Goals**: Maintain 60 fps; hold logic adds only a timer decrement per frame

**Constraints**: No regression to movement, rotation, normal gravity, soft/hard-drop semantics (once falling), sweep, scoring, lock/settle, game-over/restart, or the prior bottom-row clip fix. Hold must feel intentional, not laggy (≤ one beat).

**Scale/Scope**: One controller-level feature. Touches `controller.ts`, `GameShell.tsx`, `constants.ts`, the public-state type, and the test-api surface, plus tests. No new modules.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

The constitution (`.specify/memory/constitution.md`) is an unpopulated template with no
ratified principles, so there are no concrete gates. Applying defaults consistent with the
codebase's stated architecture (pure core; controller owns wall-clock timing; test
interface deterministic):

- **Keep the core pure / time out of `core/**`**: PASS — hold timing lives in the
  controller (like `gravityAccumMs`), not in pure core. Core only gains a `hold` field on
  the public-state *projection* with a static inactive default.
- **Deterministic test interface**: PASS — hold is driven by discrete `tick()` + explicit
  `pressSoftDrop/pressHardDrop`; no wall-clock in test mode.
- **Minimal, localized change; no new public surface beyond the spec's**: PASS — only the
  spec-mandated `hold` state field and two press hooks are added.
- **No regression**: PASS — existing gameplay semantics preserved; one existing e2e
  assertion that encodes the *old* spawn-descent timing is intentionally updated (the
  behaviour it asserts is what the feature changes).

No violations. Complexity Tracking is empty.

## Project Structure

### Documentation (this feature)

```text
specs/002-newblock-hold/
├── plan.md              # This file
├── research.md          # Phase 0
├── data-model.md        # Phase 1
├── quickstart.md        # Phase 1
├── contracts/           # Phase 1
│   └── hold-and-test-api.md
├── checklists/
│   └── requirements.md  # From /speckit-specify
└── tasks.md             # /speckit-tasks (not created here)
```

### Source Code (repository root)

```text
src/game/
├── core/
│   ├── constants.ts     # + HOLD_MS (= SECONDS_PER_BEAT * 1000 = 500)
│   ├── types.ts         # + HoldState type (active, remainingMs)
│   └── index.ts         # PublicState gains `hold`; publicState() defaults it inactive
├── engine/
│   ├── controller.ts    # ← PRIMARY: hold lifecycle (advance/spawn/input fresh-gate),
│   │                    #   RenderState.hold, testState/testTick hold-aware,
│   │                    #   testPressSoftDrop/testPressHardDrop
│   └── keymap.ts        # unchanged (action mapping; freshness derived from e.repeat)
├── react/
│   └── GameShell.tsx    # ← keydown passes fresh = !e.repeat to input()
└── test-api/
    └── install.ts       # ← state() type includes hold; + pressSoftDrop/pressHardDrop

src/game/engine/controller.test.ts  # + hold unit tests (production-loop pump + fresh-gate)
e2e/lumines.spec.ts                  # + hold e2e cases; update the spawn→tick descent test
```

**Structure Decision**: Existing single-app structure retained. The hold state machine is
owned by `GameController` (consistent with it owning all wall-clock timing); the keyboard
edge supplies press-freshness; the pure core is untouched apart from the public-state
projection field.

## Complexity Tracking

> No constitution violations; nothing to justify.
