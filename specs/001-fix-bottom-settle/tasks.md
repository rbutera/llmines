# Tasks: Fix Bottom Settle

**Input**: Design documents from `specs/001-fix-bottom-settle/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/test-api.md, quickstart.md

**Tests**: Included because the feature specification explicitly requires testability through landed-grid state and visible playfield bounds.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on incomplete tasks)
- **[Story]**: Which user story this task belongs to (US1, US2)
- Every task includes exact file paths

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Establish the current implementation and validation surfaces before changing behavior.

- [X] T001 Inspect current bottom-row landing and render paths in src/game/core/piece.ts, src/game/engine/controller.ts, and src/game/render/renderer.ts
- [X] T002 [P] Inspect existing deterministic browser tests and helper patterns in e2e/lumines.spec.ts
- [X] T003 [P] Confirm the test API contract remains unchanged in src/game/test-api/install.ts

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Add reusable validation helpers needed by both user stories.

**CRITICAL**: No user story work should begin until this phase is complete.

- [X] T004 Add shared Playwright helpers for spawning pieces, ticking to lock, hard-dropping, and reading landed grid rows in e2e/lumines.spec.ts
- [X] T005 Add a shared Playwright helper that locates the Pixi canvas/playfield and verifies the canvas does not overflow below the board area in e2e/lumines.spec.ts

**Checkpoint**: Browser tests can now validate both grid state and visual containment.

---

## Phase 3: User Story 1 - Bottom-row landings stay inside the playfield (Priority: P1) MVP

**Goal**: Hard-dropped and naturally falling pieces that land on the bottom row remain fully inside the playfield and lock without a below-grid delay or snap-back artifact.

**Independent Test**: Hard-drop and tick a 2x2 piece to the floor, verify the public grid contains only valid bottom-row cells, and verify no visible block pixels appear below the playfield during the landing transition.

### Tests for User Story 1

- [X] T006 [P] [US1] Add a Playwright test for hard-drop bottom-row landed grid state and visual containment in e2e/lumines.spec.ts
- [X] T007 [P] [US1] Add a Playwright test for natural gravity bottom-row landed grid state and visual containment in e2e/lumines.spec.ts
- [X] T008 [P] [US1] Add core regression assertions for hardDrop and gravityStep bottom-row landed cells staying within valid rows in src/game/core/core.test.ts

### Implementation for User Story 1

- [X] T009 [US1] Update active-piece vertical offset calculation in src/game/render/renderer.ts so the rendered 2x2 piece cannot extend below BOARD_H at any fallProgress value
- [X] T010 [US1] Update active-piece draw handling in src/game/render/renderer.ts so hard-drop and gravity-lock frames render either the capped active piece or the landed grid with no below-grid intermediate frame
- [X] T011 [US1] Run the US1 Playwright tests and adjust e2e/lumines.spec.ts expectations so hard-drop and natural bottom-row landings pass only when no below-playfield artifact is visible

**Checkpoint**: User Story 1 is fully functional and testable independently.

---

## Phase 4: User Story 2 - Existing overhang settle polish is preserved (Priority: P2)

**Goal**: Uneven-stack and per-column overhang settle behavior remains smooth after the bottom-row containment fix.

**Independent Test**: Build an uneven near-bottom stack, settle a piece across it, verify the public grid remains valid, and verify the visual settle remains contained inside the playfield without removing the existing per-column motion.

### Tests for User Story 2

- [X] T012 [P] [US2] Add a Playwright regression test for uneven near-bottom overhang settle containment in e2e/lumines.spec.ts
- [X] T013 [P] [US2] Add a core regression test for near-bottom uneven stack settling preserving valid landed grid rows in src/game/core/core.test.ts

### Implementation for User Story 2

- [X] T014 [US2] Audit settled-grid collapse animation state in src/game/render/renderer.ts to keep fallOffsets independent from the active-piece bottom-boundary clamp
- [X] T015 [US2] Update settled-cell offset handling in src/game/render/renderer.ts so per-column collapse offsets remain smooth while no settled cell rectangle can render below BOARD_H
- [X] T016 [US2] Run the US2 Playwright regression test and adjust e2e/lumines.spec.ts only for deterministic setup or assertions needed to validate overhang containment

**Checkpoint**: User Stories 1 and 2 both work independently without regressing scoring, sweep, controls, or normal landings.

---

## Phase 5: Polish & Cross-Cutting Concerns

**Purpose**: Final validation and cleanup across the narrow brownfield bug fix.

- [X] T017 Run unit tests with pnpm test and resolve any failures in src/game/core/core.test.ts
- [X] T018 Run browser tests with pnpm test:e2e and resolve any failures in e2e/lumines.spec.ts
- [X] T019 Run static checks with pnpm typecheck and resolve any failures in src/game/render/renderer.ts, src/game/engine/controller.ts, or e2e/lumines.spec.ts
- [X] T020 [P] Review specs/001-fix-bottom-settle/quickstart.md and update it only if validation commands or expected outcomes changed

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies; can start immediately.
- **Foundational (Phase 2)**: Depends on Setup completion; blocks user-story implementation.
- **User Story 1 (Phase 3)**: Depends on Foundational completion; delivers MVP.
- **User Story 2 (Phase 4)**: Depends on Foundational completion and should be validated after US1 if the renderer clamp is shared.
- **Polish (Phase 5)**: Depends on completed target user stories.

### User Story Dependencies

- **User Story 1 (P1)**: Starts after Phase 2; no dependency on US2.
- **User Story 2 (P2)**: Starts after Phase 2; can write tests independently, but final renderer validation should account for US1 clamp behavior.

### Within Each User Story

- Tests T006-T008 should be written before implementation tasks T009-T011.
- Tests T012-T013 should be written before implementation tasks T014-T016.
- Renderer implementation tasks should preserve existing core model behavior unless tests prove a model-level bug.
- Each story checkpoint should be validated before moving to the next phase.

### Parallel Opportunities

- T002 and T003 can run in parallel during setup.
- T006, T007, and T008 can run in parallel after foundational helpers are complete.
- T012 and T013 can run in parallel after foundational helpers are complete.
- T020 can run in parallel with final command validation after implementation behavior is stable.

---

## Parallel Example: User Story 1

```bash
Task: "Add a Playwright test for hard-drop bottom-row landed grid state and visual containment in e2e/lumines.spec.ts"
Task: "Add a Playwright test for natural gravity bottom-row landed grid state and visual containment in e2e/lumines.spec.ts"
Task: "Add core regression assertions for hardDrop and gravityStep bottom-row landed cells staying within valid rows in src/game/core/core.test.ts"
```

---

## Parallel Example: User Story 2

```bash
Task: "Add a Playwright regression test for uneven near-bottom overhang settle containment in e2e/lumines.spec.ts"
Task: "Add a core regression test for near-bottom uneven stack settling preserving valid landed grid rows in src/game/core/core.test.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1 setup.
2. Complete Phase 2 validation helpers.
3. Add failing US1 tests for hard-drop and natural bottom-row landings.
4. Implement the active-piece render-boundary fix in `src/game/render/renderer.ts`.
5. Stop and validate US1 independently with `pnpm test` and targeted Playwright tests.

### Incremental Delivery

1. Deliver US1 to remove the visible bottom-row clip/delay artifact.
2. Add US2 regression coverage for uneven near-bottom overhang settle.
3. Apply any settled-cell offset containment needed without weakening per-column motion.
4. Run full unit, browser, and typecheck validation.

### Notes

- Keep the feature scoped to bottom-row visual containment and lock smoothness.
- Do not change scoring, sweep timing, RNG, board dimensions, or player controls.
- Do not add new public test API methods unless implementation proves the current browser test surface cannot validate the required outcomes.
