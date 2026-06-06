# Implementation Plan: Fix Bottom-Row Clip/Delay

**Branch**: `001-fix-bottom-row-clip` | **Date**: 2026-06-04 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-fix-bottom-row-clip/spec.md`

## Summary

A falling piece that is resting (cannot descend) still renders up to one full cell
*below* its logical row, because the renderer adds a smooth fall-interpolation offset
(`fallProgress * CELL`) to the active piece every frame. On the bottom row this draws
the piece past the canvas floor (`BOARD_H`), producing the visible "clip below the
canvas, then snap up when it locks" artifact.

**Technical approach**: Stop the active-piece descent interpolation from overshooting
its resting position. In `GameController.renderState()`, set `fallProgress` to `0`
whenever the active piece is resting (`isResting(state)` — already exported from core),
so a grounded piece is drawn exactly at its logical row (always in bounds) and then
locks in place with no positional snap. This is a render-timing fix only: the logical
model (`canPlace`/`settle`) already guarantees no out-of-bounds cells, so `state().grid`
correctness is preserved. The per-column overhang **settle** animation is a separate
mechanism (settled-cell `fallOffsets` seeded by `seedCollapse` on grid diffs) and is
untouched by this change, so it does not regress.

## Technical Context

**Language/Version**: TypeScript 5.x (strict), React 18, Next.js App Router

**Primary Dependencies**: pixi.js (immediate-mode canvas renderer), Next.js, React; Vitest (unit), Playwright (e2e)

**Storage**: N/A (in-memory game state)

**Testing**: Vitest (`pnpm test` / `vitest run`) for core + controller units; Playwright (`pnpm test:e2e`) driving `window.__lumines` in `NEXT_PUBLIC_TEST_MODE=1`

**Target Platform**: Modern browsers (WASM/WebGL via pixi); desktop + mobile web

**Project Type**: Single web application (existing brownfield build) — frontend only

**Performance Goals**: Maintain 60 fps render loop; fix must add no per-frame cost beyond a single boolean check

**Constraints**: No regression to existing gameplay, scoring, sweep, or the per-column overhang settle polish; change must be minimal and localized

**Scale/Scope**: One bug fix; expected change is a few lines in `controller.ts` plus regression tests. No new modules, entities, or public API surface.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

The project constitution (`.specify/memory/constitution.md`) is an unpopulated template
with no ratified principles, so there are no concrete governance gates to enforce.
Applying sensible defaults consistent with the existing codebase:

- **Minimal, localized change**: PASS — fix is confined to the render-state derivation; no architectural change.
- **Preserve existing behaviour/tests**: PASS — existing Vitest + Playwright suites must stay green; new tests are additive.
- **No new public surface**: PASS — no change to `window.__lumines` test API or core exports.
- **Simplicity / YAGNI**: PASS — uses the already-exported `isResting`; no new abstractions.

No violations. Complexity Tracking section is intentionally empty.

## Project Structure

### Documentation (this feature)

```text
specs/001-fix-bottom-row-clip/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
│   └── render-invariants.md
├── checklists/
│   └── requirements.md  # From /speckit-specify
└── tasks.md             # Phase 2 output (/speckit-tasks — NOT created here)
```

### Source Code (repository root)

```text
src/game/
├── core/                # Pure game logic (bounds-safe; no change needed)
│   ├── grid.ts          # inBounds/isOccupied/settle/pieceCells/viewGrid
│   ├── piece.ts         # canPlace, gravityStep, hardDrop, isResting (EXPORTED)
│   └── ...
├── engine/
│   └── controller.ts    # ← PRIMARY CHANGE: renderState().fallProgress clamp
├── render/
│   └── renderer.ts       # drawPiece consumes fallProgress (clip symptom site; no change required)
└── test-api/
    └── install.ts        # window.__lumines surface (unchanged)

src/game/engine/          # + new controller unit test (regression)
e2e/lumines.spec.ts       # + bottom-row landing regression case
```

**Structure Decision**: Existing single-app structure is retained. The fix lives in
`src/game/engine/controller.ts` (the single source of `fallProgress`). Renderer and core
remain unchanged. Tests are added alongside the existing Vitest core tests and the
Playwright e2e spec.

## Complexity Tracking

> No constitution violations; nothing to justify.
