---

description: "Task list for Fix Bottom-Row Clip/Delay"
---

# Tasks: Fix Bottom-Row Clip/Delay

**Input**: Design documents from `/specs/001-fix-bottom-row-clip/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/render-invariants.md, quickstart.md

**Tests**: INCLUDED. The spec's Testability requirement and the plan/contracts call for a
Vitest controller regression test (`fallProgress`) and a Playwright bottom-row landing
case, so test tasks are generated.

**Organization**: One user story (P1). This is a localized, render-layer bug fix in the
existing brownfield build — no rebuild, no new modules.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1)
- Exact file paths included in each task

## Path Conventions

Existing single web app. Game code under `src/game/`; unit tests are Vitest co-located
(`*.test.ts`); e2e is Playwright under `e2e/`.

---

## Phase 1: Setup (Baseline)

**Purpose**: Establish a known-green baseline so any regression from the fix is attributable.

- [X] T001 Record baseline: run `pnpm test`, `pnpm test:e2e`, and `pnpm check` from repo root and confirm all currently pass (note any pre-existing failures before making changes)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure shared by all stories.

**N/A** — This is a single-line fix to an existing system with `isResting` already
exported from `src/game/core` and `RenderState.fallProgress` already wired through
`src/game/render/renderer.ts`. There is no blocking infrastructure to build. Proceed
directly to Phase 3.

---

## Phase 3: User Story 1 - Blocks settle cleanly on the bottom row (Priority: P1) 🎯 MVP

**Goal**: A piece dropped or settling onto the bottom row renders entirely within the
playfield at all times — no cell drawn below the canvas, and no visible delay/snap before
it locks — while `window.__lumines.state().grid` reflects the landed block on the correct
bottom rows with no out-of-bounds cells.

**Independent Test**: Drive a piece to the bottom row (via `__lumines.spawn` + `tick`, or
hard drop). Verify (a) no cell renders below the canvas and no snap-up before lock
(visual / unit), and (b) `state().grid` shows the block on the correct bottom rows with
zero out-of-bounds cells (e2e).

### Tests for User Story 1 ⚠️ (write first; unit test MUST FAIL before T004)

- [X] T002 [P] [US1] Add a Vitest controller regression test in `src/game/engine/controller.test.ts`: construct a non-test-mode `GameController`, drive a piece until it is resting on the bottom row, and assert `getRenderState().fallProgress === 0`; also assert a mid-fall (can-descend) piece reports `fallProgress > 0` after accumulated time. This test MUST FAIL against the current code (guards INV-2/INV-3, FR-001/FR-002).
- [X] T003 [P] [US1] Add a Playwright case in `e2e/lumines.spec.ts`: seed, `spawn` a mono 2×2, `tick` until it lands on the bottom row, then assert via `state().grid` that the block occupies the correct bottom rows and that no cell exists outside grid bounds (guards INV-1, FR-003/SC-001/SC-003).

### Implementation for User Story 1

- [X] T004 [US1] In `src/game/engine/controller.ts`, add `isResting` to the import from `../core` and change `renderState()` so `fallProgress` is `0` when the active piece is resting: `fallProgress: this.testMode || isResting(this.state) ? 0 : Math.max(0, Math.min(1, this.gravityAccumMs / interval))` (depends on T002 existing and failing)
- [X] T005 [US1] Run `pnpm test` and confirm the T002 regression test now passes; run `pnpm test:e2e` and confirm T003 passes

**Checkpoint**: User Story 1 fully functional — bottom-row landings render in-bounds with no clip/snap, and state reflects correct landed cells.

---

## Phase 4: Polish & Cross-Cutting Concerns

**Purpose**: Confirm no regression and validate end-to-end.

- [X] T006 [P] Verify no-regression of the per-column overhang settle (FR-004/SC-004): confirm `seedCollapse`/`fallOffsets` in `src/game/render/renderer.ts` are untouched and run the existing collapse-related tests/visual check from `specs/001-fix-bottom-row-clip/quickstart.md` §3
- [X] T007 Run full gate: `pnpm check` (lint + `tsc --noEmit`), `pnpm test`, `pnpm test:e2e` — all green (FR-005/INV-5)
- [X] T008 Execute `specs/001-fix-bottom-row-clip/quickstart.md` §2 manual visual check (`NEXT_PUBLIC_TEST_MODE=1 pnpm dev`): confirm no cell below the canvas and no snap-up before lock on the bottom row, including a hard drop

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately.
- **Foundational (Phase 2)**: N/A (empty).
- **User Story 1 (Phase 3)**: Starts after Setup. Within it, tests (T002–T003) before the fix (T004); T005 verifies after T004.
- **Polish (Phase 4)**: After Phase 3 completes.

### User Story Dependencies

- **User Story 1 (P1)**: The only story; self-contained MVP.

### Within User Story 1

- T002 and T003 are authored first ([P], different files). T002 must FAIL before T004.
- T004 applies the fix. T005 re-runs the suites to confirm pass.

### Parallel Opportunities

- T002 (`controller.test.ts`) and T003 (`e2e/lumines.spec.ts`) touch different files → run in parallel.
- T006 can run in parallel with other polish review; T007/T008 are final gates.

---

## Parallel Example: User Story 1

```bash
# Author both regression tests together (different files):
Task: "Add Vitest fallProgress regression test in src/game/engine/controller.test.ts"
Task: "Add Playwright bottom-row landing case in e2e/lumines.spec.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Phase 1: Setup — record green baseline (T001).
2. Phase 2: Foundational — none.
3. Phase 3: User Story 1 — write failing unit test (T002) + e2e guard (T003), apply the
   one-line `fallProgress` fix (T004), confirm green (T005).
4. **STOP and VALIDATE**: bottom-row landings clean; `state().grid` correct.
5. Phase 4: Polish — confirm overhang settle unaffected and run full gates (T006–T008).

This single story IS the MVP and the entire feature.

---

## Notes

- [P] tasks = different files, no dependencies.
- The fix is render-layer only; the core model (`canPlace`/`settle`) already guarantees
  in-bounds cells, so `state().grid` correctness is preserved by construction.
- Do NOT touch `seedCollapse`/`fallOffsets` (per-column overhang settle) — that polish
  must not regress.
- Keep `window.__lumines` test API surface unchanged.
- Commit after the fix + passing tests.
