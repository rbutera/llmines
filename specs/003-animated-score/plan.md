# Implementation Plan: Dynamic Animated Score

**Branch**: `003-animated-score` | **Date**: 2026-06-04 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/003-animated-score/spec.md`

## Summary

Make scoring feel juicy: on every score increase a count-up + pop/scale + flash/particle
effect fires **in the game view** (over the playfield), scaling with the size of the clear
— while the authoritative `score` number stays exactly correct and assertable.

**Technical approach** (presentation-only; no engine/core change):

- The score already reaches the React layer: `GameShell` subscribes to the controller and
  calls `setScore(rs.score)` on every emit; `PlayingScreen` renders the authoritative
  integer in the `data-testid="score"` element. That element stays a plain, instant integer
  (untouched) — the source of truth for assertions.
- Add a cosmetic **`ScoreFx`** overlay mounted over the `GameCanvas` (inside the game-view
  column, absolutely positioned, `pointer-events-none`). It receives the `score` value,
  detects increases (delta vs. the previous value via a ref), and plays the juice: an
  animated count-up of a *separate* in-view number, a pop/scale, and a flash/particle burst
  whose intensity tier scales with the delta. It is purely visual and never writes the
  `score` testid.
- A small **pure helper** (`score-effects.ts`) maps a delta to an effect tier
  (`none` / `modest` / `big`) and exposes the count-up duration — unit-testable in the
  existing node Vitest env without a DOM.
- Respect `prefers-reduced-motion` with a dialed-down fallback; on restart (`score → 0`)
  the overlay resets with no stale effect.

No changes to the controller, core, renderer, or the `window.__lumines` test API. The
feature is isolated to the React presentation layer, so all existing behaviour/polish and
prior features (001 clip fix, 002 hold) are untouched.

## Technical Context

**Language/Version**: TypeScript 5.x (strict), React 18, Next.js App Router

**Primary Dependencies**: React (overlay + animation), Tailwind (styling); existing pixi.js renderer is untouched. Vitest (unit), Playwright (e2e)

**Storage**: N/A

**Testing**: Vitest (`pnpm test`) for the pure tier/count-up helper; Playwright (`pnpm test:e2e`) for the in-view effect + authoritative-value assertions

**Target Platform**: Modern browsers (desktop + mobile web)

**Performance Goals**: 60 fps; overlay uses CSS transforms/opacity + a small, bounded number of particle nodes; no per-frame React churn beyond score changes

**Constraints**: The `score` testid MUST remain the exact authoritative integer at all times (no count-up on the testid). Effects are transient, non-blocking (`pointer-events-none`), never permanently obscure the board, and honour reduced-motion.

**Scale/Scope**: One new overlay component + one pure helper, mounted in `PlayingScreen`. No engine/core/test-API changes.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

The constitution (`.specify/memory/constitution.md`) is an unpopulated template — no
ratified gates. Applying defaults consistent with the codebase:

- **Keep the pure core / engine untouched**: PASS — this is React-presentation only; no
  change to `core/**`, the controller, the renderer, or the test API.
- **Authoritative value integrity**: PASS — the `score` testid stays an instant integer;
  the count-up animates a separate cosmetic element, so value assertions cannot break.
- **No regression**: PASS — existing gameplay/scoring/sweep and features 001/002 are not
  modified; the overlay is additive and non-blocking.
- **Testability**: PASS — pure tier helper unit-tested; e2e asserts the effect fires in the
  game view, scales with clear size, is transient, and the authoritative value stays exact.
- **Simplicity / YAGNI**: PASS — CSS-driven overlay + a tiny pure helper; no new heavy deps.

No violations. Complexity Tracking is empty.

## Project Structure

### Documentation (this feature)

```text
specs/003-animated-score/
├── plan.md              # This file
├── research.md          # Phase 0
├── data-model.md        # Phase 1
├── quickstart.md        # Phase 1
├── contracts/
│   └── score-fx.md      # Phase 1 — overlay/test-hook contract + invariants
├── checklists/
│   └── requirements.md  # From /speckit-specify
└── tasks.md             # /speckit-tasks (not created here)
```

### Source Code (repository root)

```text
src/game/
├── react/
│   ├── GameShell.tsx        # ← mount <ScoreFx> over the game view; score testid UNCHANGED
│   ├── GameCanvas.tsx        # unchanged (overlay is a sibling in the game-view container)
│   ├── ScoreFx.tsx           # ← NEW cosmetic overlay: count-up + pop/scale + flash/particles
│   ├── score-effects.ts      # ← NEW pure helper: delta → effect tier; count-up timing
│   └── score-effects.test.ts # ← NEW Vitest unit tests for the helper
├── engine/ · core/ · render/ · test-api/   # all UNCHANGED

e2e/lumines.spec.ts          # + score-fx e2e cases (effect fires, scales, transient, value exact)
```

**Structure Decision**: The authoritative score readout in the side HUD is left exactly as
is (the assertion contract). All new code is an additive React overlay in the game-view
column plus a pure, unit-testable helper. No engine, core, renderer, or test-API change —
the lowest-risk surface that satisfies the "do not rebuild / keep everything working"
mandate.

## Complexity Tracking

> No constitution violations; nothing to justify.
