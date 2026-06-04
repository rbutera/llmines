# Tasks: LLMines Game

**Input**: Design documents from `specs/001-llmines-game/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/deterministic-test-interface.md](./contracts/deterministic-test-interface.md), [quickstart.md](./quickstart.md)

**Tests**: Tests are included because the feature specification explicitly requires Vitest logic tests and Playwright end-to-end tests.

**Organization**: Tasks are grouped by user story so each story can be implemented and tested as an independent increment.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel because it touches different files and has no dependency on incomplete tasks in the same phase.
- **[Story]**: Maps to the user story from `spec.md`; setup, foundational, and polish tasks intentionally omit story labels.
- Every task includes at least one exact repository-relative file path.

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Add required test tooling, scripts, and directory structure before implementation begins.

- [X] T001 Add Vitest, Playwright, jsdom, and test scripts to `package.json`
- [X] T002 Create Vitest configuration in `vitest.config.ts`
- [X] T003 Create Playwright configuration with normal and test-mode web server projects in `playwright.config.ts`
- [X] T004 [P] Create shared unit-test setup file in `tests/setup/vitest.setup.ts`
- [X] T005 [P] Create Playwright fixture helpers for normal and test-mode sessions in `tests/e2e/fixtures.ts`
- [X] T006 [P] Create LLMines source directory placeholder in `src/lib/llmines/.gitkeep`
- [X] T007 [P] Create e2e test directory placeholder in `tests/e2e/.gitkeep`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Define shared constants, types, utilities, and page/component entry points required by every user story.

**Critical**: No user story work should begin until this phase is complete.

- [X] T008 Define grid, spawn, tempo, sweep, color, and asset constants in `src/lib/llmines/constants.ts`
- [X] T009 Define Color, Cell, Grid, Piece, coordinates, session, sweep, and render-state types in `src/lib/llmines/types.ts`
- [X] T010 [P] Implement deterministic seeded RNG utilities in `src/lib/llmines/rng.ts`
- [X] T011 [P] Implement grid creation, cloning, bounds, overlay, and column-gravity helpers in `src/lib/llmines/grid.ts`
- [X] T012 [P] Implement reusable piece matrix rotation helpers in `src/lib/llmines/piece.ts`
- [X] T013 Replace scaffold metadata with LLMines title and description in `src/app/layout.tsx`
- [X] T014 Replace default scaffold page with the LLMines entry point in `src/app/page.tsx`
- [X] T015 Add base LLMines visual tokens and responsive layout primitives in `src/styles/globals.css`

**Checkpoint**: Shared constants, types, helpers, and app entry points exist; user story implementation can begin.

---

## Phase 3: User Story 1 - Start and Play a Core Round (Priority: P1)

**Goal**: A desktop browser player can start a round, see the 16x10 playfield and score, control a falling 2x2 piece, lock it, and continue with new pieces during normal play.

**Independent Test**: Start from the initial screen, use the start button, confirm score 0 and a top-center 2x2 piece, exercise `h`, `l`, `j`, `k`, and `space`, hard-drop to lock, and confirm a new piece spawns in normal play.

### Tests for User Story 1

- [X] T016 [P] [US1] Write unit tests for spawn, movement, rotation, collision, gravity tick, hard-drop, lock, and normal auto-spawn in `tests/unit/engine.test.ts`
- [X] T017 [P] [US1] Write Playwright tests for start screen, single main landmark, score 0, controls cheatsheet, and keyboard controls in `tests/e2e/llmines-core.spec.ts`

### Implementation for User Story 1

- [X] T018 [US1] Implement core game session creation, spawning, movement, rotation, soft-drop, hard-drop, locking, and normal auto-spawn in `src/lib/llmines/engine.ts`
- [X] T019 [US1] Implement keyboard command mapping for `h`, `l`, `j`, `k`, `space`, and arrow aliases in `src/lib/llmines/input.ts`
- [X] T020 [US1] Create the client game shell with start, playing, and state subscription flow in `src/app/_components/LLMinesGame.tsx`
- [X] T021 [US1] Create the PixiJS board component with canvas ref mounting and basic active/settled cell rendering in `src/app/_components/PixiBoard.tsx`
- [X] T022 [US1] Create the live score and in-game HUD component with `data-testid="score"` in `src/app/_components/GameHud.tsx`
- [X] T023 [US1] Create reusable visible controls and how-to-play panel with `data-testid="controls-cheatsheet"` in `src/app/_components/ControlsPanel.tsx`
- [X] T024 [US1] Add start screen button with `data-testid="start-button"` and in-game legend integration in `src/app/_components/LLMinesGame.tsx`
- [X] T025 [US1] Wire animation-frame gravity stepping and React state updates for normal play in `src/app/_components/LLMinesGame.tsx`
- [X] T026 [US1] Verify US1 unit and e2e tests pass by updating implementation details in `tests/unit/engine.test.ts` and `tests/e2e/llmines-core.spec.ts`

**Checkpoint**: User Story 1 is playable and independently testable.

---

## Phase 4: User Story 2 - Form Squares, Sweep, Clear, and Score (Priority: P1)

**Goal**: A player can form same-color squares, see marked cells, have the sweep clear marked cells column by column, score by the pinned formula, and watch remaining cells settle by gravity.

**Independent Test**: Arrange a known monochrome 2x2 square, confirm marked cells, advance a sweep, verify only passed marked cells clear, score increases correctly, and cells above gaps fall down in order.

### Tests for User Story 2

- [X] T027 [P] [US2] Write unit tests for 2x2, 2x3, and 3x3 square counting by top-left coordinate in `tests/unit/square-detection.test.ts`
- [X] T028 [P] [US2] Write unit tests for sweep column deletion, score multiplier, and post-clear gravity in `tests/unit/sweep.test.ts`
- [X] T029 [P] [US2] Write unit tests for score calculation across single-square and overlapping-square clears in `tests/unit/scoring.test.ts`
- [X] T030 [P] [US2] Write Playwright deterministic clear-and-score flow using `window.__lumines` in `tests/e2e/llmines-clearing.spec.ts`

### Implementation for User Story 2

- [X] T031 [US2] Implement aligned monochrome square detection and marked-cell derivation in `src/lib/llmines/square-detection.ts`
- [X] T032 [US2] Implement pinned sweep scoring formula in `src/lib/llmines/scoring.ts`
- [X] T033 [US2] Implement timeline sweep progress, passed-column calculation, marked-cell deletion, and gravity application in `src/lib/llmines/sweep.ts`
- [X] T034 [US2] Integrate square marking, sweep clearing, scoring, and grid gravity into the game engine in `src/lib/llmines/engine.ts`
- [X] T035 [US2] Render marked-cell and sweep-bar states in `src/app/_components/PixiBoard.tsx`
- [X] T036 [US2] Update the HUD to display score changes while keeping score text numeric in `src/app/_components/GameHud.tsx`
- [X] T037 [US2] Verify US2 unit and e2e tests pass by updating implementation details in `tests/unit/square-detection.test.ts`, `tests/unit/sweep.test.ts`, `tests/unit/scoring.test.ts`, and `tests/e2e/llmines-clearing.spec.ts`

**Checkpoint**: User Story 2 is independently testable and completes the core Lumines-style rule loop.

---

## Phase 5: User Story 3 - Tempo-Synced Audio and Sweep Feedback (Priority: P2)

**Goal**: The sweep stays aligned to the looping 120 BPM backing track during normal play, while visual states make formation, marking, clearing, and collapse legible.

**Independent Test**: Start a round, confirm `/backing-track.mp3` is configured with loop enabled, observe a 4.0-second sweep traversal, and verify animation states for marked, clearing, and collapsing cells.

### Tests for User Story 3

- [X] T038 [P] [US3] Write unit tests for audio-time-to-sweep-position math and 4.0-second wrapping in `tests/unit/sweep-timing.test.ts`
- [X] T039 [P] [US3] Write Playwright tests for audio source, loop attribute, and visible Pixi canvas in `tests/e2e/llmines-audio-visual.spec.ts`

### Implementation for User Story 3

- [X] T040 [US3] Implement backing-track audio element creation, loop configuration, and current-time sweep mapping in `src/lib/llmines/audio.ts`
- [X] T041 [US3] Wire normal-play audio lifecycle and audio-synced sweep updates into `src/app/_components/LLMinesGame.tsx`
- [X] T042 [US3] Add Pixi animations for falling, locking, marking, clearing, sweep pass, and column collapse in `src/app/_components/PixiBoard.tsx`
- [X] T043 [US3] Add animation state fields needed by Pixi rendering in `src/lib/llmines/types.ts`
- [X] T044 [US3] Tune in-game HUD and surrounding screen styles for cohesive polished presentation in `src/styles/globals.css`
- [X] T045 [US3] Verify US3 unit and e2e tests pass by updating implementation details in `tests/unit/sweep-timing.test.ts` and `tests/e2e/llmines-audio-visual.spec.ts`

**Checkpoint**: User Story 3 is independently testable for audio contract, timing, and visual feedback.

---

## Phase 6: User Story 4 - Game Over and Restart (Priority: P2)

**Goal**: The game ends when the spawn area is blocked, shows final score, and restarts into a clean round.

**Independent Test**: Fill the spawn area, trigger a spawn, confirm game-over screen and final score, then restart and verify empty grid, score 0, cleared game-over state, and a new piece.

### Tests for User Story 4

- [X] T046 [P] [US4] Write unit tests for spawn-overflow game over and restart state reset in `tests/unit/game-over.test.ts`
- [X] T047 [P] [US4] Write Playwright tests for `data-testid="game-over"` and `data-testid="restart"` flow in `tests/e2e/llmines-game-over.spec.ts`

### Implementation for User Story 4

- [X] T048 [US4] Implement spawn-overflow detection and restart state reset in `src/lib/llmines/engine.ts`
- [X] T049 [US4] Add game-over screen, final score display, and restart button with `data-testid="restart"` in `src/app/_components/LLMinesGame.tsx`
- [X] T050 [US4] Add game-over state presentation styles in `src/styles/globals.css`
- [X] T051 [US4] Ensure restart resets Pixi board rendering and animations in `src/app/_components/PixiBoard.tsx`
- [X] T052 [US4] Verify US4 unit and e2e tests pass by updating implementation details in `tests/unit/game-over.test.ts` and `tests/e2e/llmines-game-over.spec.ts`

**Checkpoint**: User Story 4 is independently testable and completes a full playable session loop.

---

## Phase 7: User Story 5 - Automatable Deterministic Verification (Priority: P3)

**Goal**: External tests can deterministically drive and inspect the game only when `NEXT_PUBLIC_TEST_MODE=1`; normal builds expose no test interface.

**Independent Test**: Enable test mode, call `seed`, `state`, `marked`, `spawn`, `tick`, `sweepNow`, and `sweepProgress`, verify deterministic results, then run without test mode and confirm `window.__lumines` is absent.

### Tests for User Story 5

- [X] T053 [P] [US5] Write contract tests for the `window.__lumines` API shape and absence in normal mode in `tests/e2e/llmines-test-api.spec.ts`
- [X] T054 [P] [US5] Write unit tests for test-mode spawn locking, no auto-spawn tick behavior, and state snapshots in `tests/unit/test-api.test.ts`
- [X] T055 [P] [US5] Write unit tests for deterministic `sweepProgress(dtMs)` timing assertions in `tests/unit/test-sweep-progress.test.ts`

### Implementation for User Story 5

- [X] T056 [US5] Implement the deterministic harness API from the contract in `src/lib/llmines/test-api.ts`
- [X] T057 [US5] Add public test-mode environment typing and parsing in `src/env.js`
- [X] T058 [US5] Install and remove `window.__lumines` only under `NEXT_PUBLIC_TEST_MODE=1` in `src/app/_components/LLMinesGame.tsx`
- [X] T059 [US5] Ensure test-mode `tick()` locks without auto-spawning and `spawn(piece)` locks any active piece first in `src/lib/llmines/engine.ts`
- [X] T060 [US5] Ensure deterministic `state().grid`, `marked()`, `sweepNow()`, and `sweepProgress(dtMs)` match the contract in `src/lib/llmines/test-api.ts`
- [X] T061 [US5] Verify US5 unit and e2e tests pass by updating implementation details in `tests/unit/test-api.test.ts`, `tests/unit/test-sweep-progress.test.ts`, and `tests/e2e/llmines-test-api.spec.ts`

**Checkpoint**: User Story 5 is independently testable and satisfies the external automation contract.

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: Final quality, accessibility, performance, and validation work across all user stories.

- [X] T062 [P] Add quickstart validation notes for implemented commands and expected results in `specs/001-llmines-game/quickstart.md`
- [X] T063 [P] Add Playwright accessibility checks for one main landmark, keyboard start/restart, and visible controls in `tests/e2e/llmines-accessibility.spec.ts`
- [X] T064 Add responsive layout and text-overflow polish for start, in-game, and game-over screens in `src/styles/globals.css`
- [X] T065 Optimize Pixi object reuse and animation cleanup to avoid remount leaks in `src/app/_components/PixiBoard.tsx`
- [X] T066 Remove unused create-t3-app demo component imports and references in `src/app/page.tsx`
- [X] T067 Run and fix `pnpm typecheck`, `pnpm lint`, `pnpm test`, and `pnpm test:e2e` issues in `package.json`
- [X] T068 Update implementation notes for any accepted deviations from the plan in `specs/001-llmines-game/plan.md`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 Setup**: No dependencies; can start immediately.
- **Phase 2 Foundational**: Depends on Phase 1; blocks all user stories.
- **Phase 3 US1**: Depends on Phase 2; provides the playable baseline.
- **Phase 4 US2**: Depends on Phase 2 and can be developed after the engine shell exists; full browser validation is easiest after US1.
- **Phase 5 US3**: Depends on US1 and US2 states so animation and audio can reflect real gameplay.
- **Phase 6 US4**: Depends on US1 engine/session flow; can proceed in parallel with US3 after US1.
- **Phase 7 US5**: Depends on the engine APIs from US1 and US2; can proceed once those engine seams exist.
- **Phase 8 Polish**: Depends on the desired story set being complete.

### User Story Dependencies

- **US1 (P1)**: No user-story dependency; first MVP increment.
- **US2 (P1)**: Needs the foundational engine model and benefits from US1 UI, but rule logic can be implemented independently in `src/lib/llmines`.
- **US3 (P2)**: Requires gameplay states from US1 and US2 for meaningful audio-synced visual feedback.
- **US4 (P2)**: Requires the US1 session lifecycle and spawn behavior.
- **US5 (P3)**: Requires core engine and sweep behavior from US1 and US2.

### Story Task Ordering

- Tests before implementation within each story.
- Types/constants before engine code.
- Engine behavior before React/Pixi integration.
- DOM hooks and e2e wiring after the relevant UI exists.
- Verification task last within each story.

---

## Parallel Execution Examples

### User Story 1

```text
Task: T016 Write unit tests in tests/unit/engine.test.ts
Task: T017 Write Playwright tests in tests/e2e/llmines-core.spec.ts
```

After T018 is complete:

```text
Task: T021 Create Pixi board in src/app/_components/PixiBoard.tsx
Task: T022 Create HUD in src/app/_components/GameHud.tsx
Task: T023 Create controls panel in src/app/_components/ControlsPanel.tsx
```

### User Story 2

```text
Task: T027 Write square detection tests in tests/unit/square-detection.test.ts
Task: T028 Write sweep tests in tests/unit/sweep.test.ts
Task: T029 Write scoring tests in tests/unit/scoring.test.ts
Task: T030 Write e2e clearing test in tests/e2e/llmines-clearing.spec.ts
```

After T031 through T033 are complete:

```text
Task: T035 Render marked cells and sweep bar in src/app/_components/PixiBoard.tsx
Task: T036 Update score HUD in src/app/_components/GameHud.tsx
```

### User Story 3

```text
Task: T038 Write sweep timing tests in tests/unit/sweep-timing.test.ts
Task: T039 Write audio and canvas e2e tests in tests/e2e/llmines-audio-visual.spec.ts
```

After T040 is complete:

```text
Task: T041 Wire audio lifecycle in src/app/_components/LLMinesGame.tsx
Task: T042 Add Pixi animations in src/app/_components/PixiBoard.tsx
```

### User Story 4

```text
Task: T046 Write game-over unit tests in tests/unit/game-over.test.ts
Task: T047 Write game-over e2e tests in tests/e2e/llmines-game-over.spec.ts
```

After T048 is complete:

```text
Task: T049 Add game-over screen in src/app/_components/LLMinesGame.tsx
Task: T050 Add game-over styles in src/styles/globals.css
Task: T051 Reset Pixi board on restart in src/app/_components/PixiBoard.tsx
```

### User Story 5

```text
Task: T053 Write API contract e2e tests in tests/e2e/llmines-test-api.spec.ts
Task: T054 Write test API unit tests in tests/unit/test-api.test.ts
Task: T055 Write deterministic sweep progress tests in tests/unit/test-sweep-progress.test.ts
```

After T056 is complete:

```text
Task: T057 Add test-mode environment parsing in src/env.js
Task: T058 Gate window.__lumines in src/app/_components/LLMinesGame.tsx
Task: T059 Add engine test-mode semantics in src/lib/llmines/engine.ts
```

---

## Implementation Strategy

### MVP First

1. Complete Phase 1 and Phase 2.
2. Complete Phase 3 (US1) to get a playable falling-block baseline.
3. Stop and validate US1 independently with `tests/unit/engine.test.ts` and `tests/e2e/llmines-core.spec.ts`.

### Acceptance-Core Increment

1. Complete Phase 4 (US2) after US1.
2. Validate square formation, sweep clears, scoring, and gravity with unit tests and deterministic e2e coverage.
3. At this point the core Lumines-style MVP loop exists.

### Full MVP Delivery

1. Add US3 for audio sync and animation polish.
2. Add US4 for game-over and restart.
3. Add US5 for deterministic external test automation.
4. Complete Phase 8 polish and run the full quickstart validation.

### Parallel Team Strategy

1. Finish Setup and Foundational tasks together.
2. Split US1 UI subcomponents after the engine shell exists.
3. Split US2 rule tests and rule modules across different files.
4. Run US3 and US4 in parallel after US1, then integrate with US5 once the core engine seams are stable.

## Notes

- Keep production behavior and test-mode behavior explicitly separated.
- Do not add accounts, high scores, leaderboard, multiplayer, mobile/touch controls, skins, themes, or settings menus.
- Keep game rules in `src/lib/llmines` and rendering in `src/app/_components/PixiBoard.tsx`.
- Verify tests fail before implementing their corresponding tasks.
- Commit after each story checkpoint or other coherent implementation group.
