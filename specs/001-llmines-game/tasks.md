---

description: "Task list for LLMines — Browser Lumines Clone (MVP)"
---

# Tasks: LLMines — Browser Lumines Clone (MVP)

**Input**: Design documents from `/specs/001-llmines-game/`

**Prerequisites**: plan.md ✅, spec.md ✅, research.md ✅, data-model.md ✅, contracts/test-api.md ✅, quickstart.md ✅

**Tests**: INCLUDED. The feature spec pins testing tooling (vitest for logic, Playwright for e2e) and dedicates User Story 5 to a deterministic test interface, so unit + e2e test tasks are first-class here.

**Organization**: Tasks are grouped by user story (US1–US5 from spec.md) to enable independent implementation and testing.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: US1–US5 (setup/foundational/polish carry no story label)
- Exact file paths are included in each task.

## Path Conventions

Single Next.js app (create-t3-app). Game code under `src/game/`, UI under `src/app/_components/`, tests under `tests/unit/` (vitest) and `tests/e2e/` (Playwright). Repo root: `/Users/rai/dev/sdd-eval/cells/speckit-claude-greenfield`.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Test tooling and the game source skeleton.

- [X] T001 [P] Add vitest dev dependency and create `vitest.config.ts` at repo root (node environment, `include: ["tests/unit/**/*.test.ts"]`, alias `~`→`src`)
- [X] T002 [P] Add `@playwright/test` dev dependency and create `playwright.config.ts` at repo root (webServer runs the app with `NEXT_PUBLIC_TEST_MODE=1`, `testDir: "tests/e2e"`, chromium project)
- [X] T003 Add `test`, `test:unit` (`vitest run`), and `test:e2e` (`playwright test`) scripts to `package.json`
- [X] T004 [P] Create the `src/game/` directory tree (`core/`, `render/`, `audio/`, `driver/`, `test/`) and define pinned constants in `src/game/constants.ts` (GRID_COLS=16, GRID_ROWS=10, SPAWN_COL=7, SPAWN_ROW=0, BEAT_MS=500, SWEEP_BEATS=8, SWEEP_MS_PER_COL=250, SWEEP_FULL_MS=4000, GRAVITY_TICK_MS, SOFT_DROP_TICK_MS)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core types, the pure-state engine skeleton, and the canvas/React mount that every story builds on.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [X] T005 [P] Define core types in `src/game/core/types.ts` (`Color`, `Cell`, `Grid`, `Piece`, `Phase`, `ActivePiece`, `MarkedCell`, `GameState`) per data-model.md
- [X] T006 [P] Implement grid helpers in `src/game/core/grid.ts` (`createGrid`, `cloneGrid`, `inBounds`, `isOccupied`, `get`/`set`)
- [X] T007 [P] Implement seedable mulberry32 RNG in `src/game/core/rng.ts` (`seedRng(state,n)`, `nextColor` advancing `rngState`, `randomPiece`)
- [X] T008 [P] Unit test the RNG (same seed → identical piece sequence) in `tests/unit/rng.test.ts`
- [X] T009 Implement engine state skeleton in `src/game/core/engine.ts` (`createInitialState`, `GameState` lifecycle, `renderGrid(state)` projection overlaying active piece on settled grid, dispatch shell)
- [X] T010 Implement PixiRenderer base in `src/game/render/PixiRenderer.ts` (async `Application.init`, draw empty 16×10 grid, `resize`, `destroy`, `update(state)` entrypoint)
- [X] T011 Implement `GameCanvas.tsx` in `src/app/_components/GameCanvas.tsx` (`'use client'`, mount PixiRenderer into a ref'd div in `useEffect`, destroy on unmount, StrictMode-safe)
- [X] T012 Implement `Game.tsx` root in `src/app/_components/Game.tsx` (`'use client'`, single `<main>` landmark, screen-state placeholder rendering `<GameCanvas/>`)
- [X] T013 Wire `src/app/page.tsx` to render `<Game/>` (replace T3 demo) and set title/metadata in `src/app/layout.tsx`

**Checkpoint**: App boots to a rendered empty playfield; pure-core types/engine/rng compile and rng test passes.

---

## Phase 3: User Story 1 — Play a falling-block round (Priority: P1) 🎯 MVP

**Goal**: A controllable 2×2 piece spawns at top-centre, falls on a gravity tick, responds to move/rotate/soft-drop/hard-drop, and locks onto the floor/stack.

**Independent Test**: Start the app, confirm a 2×2 piece spawns at cols 7–8/rows 0–1, falls, responds to `h`/`l`/`j`/`k`/`space`, and locks; verified by `piece` unit tests + manual play.

### Tests for User Story 1

- [X] T014 [P] [US1] Unit test piece mechanics in `tests/unit/piece.test.ts` (spawn position; move accepted/rejected at walls & stack; 90° rotation accepted/rejected near edges; hard-drop lands; lock writes 4 cells)

### Implementation for User Story 1

- [X] T015 [US1] Implement piece mechanics in `src/game/core/piece.ts` (`spawnPiece` at SPAWN_COL/ROW, `tryMove`, `rotate90`, `collides`, `lockPiece` into grid) — make T014 pass
- [X] T016 [US1] Wire piece operations into the engine in `src/game/core/engine.ts` (`spawn`, `moveLeft`, `moveRight`, `rotate`, `softDrop`, `hardDrop`, `stepGravity` with lock-on-rest; production auto-spawn after lock)
- [X] T017 [US1] Add keyboard input handling in `src/app/_components/Game.tsx` (or `src/app/_components/useKeyboard.ts`): `h`/`l` move, `j` soft-drop, `k` rotate, `space` hard-drop, with ArrowLeft/Right/Down/Up aliases; `preventDefault` on space
- [X] T018 [US1] Implement the production gravity loop in `src/game/driver/gameDriver.ts` (rAF accumulator advancing `stepGravity` every GRAVITY_TICK_MS, faster while soft-dropping, auto-spawn next piece)
- [X] T019 [US1] Render the active falling piece with fall/settle easing and 4 distinct sub-blocks in `src/game/render/PixiRenderer.ts`

**Checkpoint**: A piece can be steered, dropped, and locked; stacking works. Playable falling-block toy (no clears yet).

---

## Phase 4: User Story 2 — Form squares & clear them with the sweep (Priority: P1)

**Goal**: Monochrome 2×2+ areas are marked; the timeline bar sweeps left→right clearing marked cells column-by-column, scoring `cells × distinctSquares`, then collapsing cells by gravity.

**Independent Test**: Construct a same-colour 2×2, run a sweep, confirm the 4 cells delete, score += 4, and cells above settle; 2×3→+12, 3×3→+36; verified by `marking`/`scoring`/`sweep`/`gravity` unit tests.

### Tests for User Story 2

- [X] T020 [P] [US2] Unit test square detection & distinct-square count in `tests/unit/marking.test.ts` (2×2→4 marked/1 square; 2×3→2 squares; 3×3→4 squares; mixed-colour 2×2 unmarked)
- [X] T021 [P] [US2] Unit test scoring rule in `tests/unit/scoring.test.ts` (4, 12, 36, and three-separate-2×2→36)
- [X] T022 [P] [US2] Unit test sweep timing & per-column clear in `tests/unit/sweep.test.ts` (250 ms/col; 4000 ms full traversal; wrap)
- [X] T023 [P] [US2] Unit test gravity collapse in `tests/unit/gravity.test.ts` (cells fall into emptied gaps, per-column stable order)

### Implementation for User Story 2

- [X] T024 [P] [US2] Implement `src/game/core/marking.ts` (`markedCells(grid)` by 2×2-membership; `distinctSquares(grid, region)` by monochrome top-left windows) — make T020 pass
- [X] T025 [P] [US2] Implement `src/game/core/scoring.ts` (`scoreForClear(cells, squares) = cells * squares`) — make T021 pass
- [X] T026 [P] [US2] Implement `src/game/core/sweep.ts` (advance `sweepX` by `dtMs/250`; on integer crossing delete column's marked cells into `sweepCleared`; detect traversal completion) — make T022 pass
- [X] T027 [P] [US2] Implement `src/game/core/gravity.ts` (`applyGravity(grid)` compacting each column downward) — make T023 pass
- [X] T028 [US2] Wire clearing into the engine in `src/game/core/engine.ts` (`sweepStep(dtMs)` and `sweepNow()`: clear → `scoreForClear` over traversal set → `applyGravity` → reset `sweepCleared`/`sweepX`) — depends on T024–T027 and T016
- [X] T029 [US2] Render mark highlight pulse, the sweeping bar (glow/trail) tracking `sweepX`, and clear flash + collapse animation in `src/game/render/PixiRenderer.ts`
- [X] T030 [US2] Advance the sweep in the production loop in `src/game/driver/gameDriver.ts` (call `sweepStep` each frame; provisional rAF clock until US4 audio sync)

**Checkpoint**: Building a square and letting the bar pass clears it and increases the score; gravity settles the stack. Core Lumines loop complete.

---

## Phase 5: User Story 3 — Game flow: start, score, game over, restart (Priority: P2)

**Goal**: Start screen → in-game (grid + live score + persistent legend) → game-over (final score + restart), with game-over triggered when a spawn is blocked.

**Independent Test**: Load → start screen with start control + cheatsheet; start → score reads 0 and updates on clears; fill spawn zone → game-over with final score; restart → empty grid, score 0.

### Implementation for User Story 3

- [X] T031 [P] [US3] Implement `src/app/_components/ControlsCheatsheet.tsx` (`data-testid="controls-cheatsheet"`; lists `h`/`l` move, `j` soft-drop, `k` rotate, `space` hard-drop + brief how-to-play)
- [X] T032 [P] [US3] Implement `src/app/_components/Hud.tsx` (live score with `data-testid="score"`, text = number)
- [X] T033 [P] [US3] Implement `src/app/_components/StartScreen.tsx` (`data-testid="start-button"`, how-to-play, embeds `<ControlsCheatsheet/>`)
- [X] T034 [P] [US3] Implement `src/app/_components/GameOverScreen.tsx` (`data-testid="game-over"` present only here, final score, `data-testid="restart"`)
- [X] T035 [US3] Implement the screen state machine in `src/app/_components/Game.tsx` (start→playing→gameover→restart; mount HUD + persistent in-game `<ControlsCheatsheet/>` during play) — depends on T031–T034
- [X] T036 [US3] Implement game-over detection on blocked spawn and full reset on restart in `src/game/core/engine.ts` (set `phase="gameover"`/`gameOver=true` when spawn cells occupied; `restart` → fresh empty grid, score 0)

**Checkpoint**: Full three-screen loop works end to end with live scoring and restart.

---

## Phase 6: User Story 4 — Audio synced to the sweep (Priority: P2)

**Goal**: Backing track starts on game start, loops, and the sweep stays locked to tempo (8 beats / 4.0 s per traversal).

**Independent Test**: Start a round; an audio source exists with `loop` enabled pointing at `/backing-track.mp3`; a full traversal = 8 beats; gameplay proceeds even if autoplay is blocked.

### Implementation for User Story 4

- [X] T037 [P] [US4] Implement `src/game/audio/audioClock.ts` (create `HTMLAudioElement` with `loop=true`, `src="/backing-track.mp3"`; expose `play()`, `currentTime`, and a beats helper)
- [X] T038 [US4] Start audio on the start gesture and drive `sweepX` from the audio clock with rAF fallback in `src/game/driver/gameDriver.ts` (map `currentTime`→beats→sweep columns; do not circumvent autoplay) — depends on T037 and T030

**Checkpoint**: Sweep visibly tracks the looping music at the pinned tempo; mechanics unaffected when audio is blocked.

---

## Phase 7: User Story 5 — Deterministic test interface (Priority: P2)

**Goal**: When `NEXT_PUBLIC_TEST_MODE=1`, expose `window.__lumines` + `data-testid` hooks and pause auto-loops; when unset, none present and production behaviour unchanged. Validate the whole feature via Playwright.

**Independent Test**: Build with the flag → API + hooks drive the game deterministically (seed, spawn, tick never auto-spawns, sweepProgress timing); build without → no `window.__lumines`, auto-gravity + synced sweep normal.

### Implementation for User Story 5

- [X] T039 [US5] Add optional `NEXT_PUBLIC_TEST_MODE` to the client schema and `runtimeEnv` in `src/env.js`
- [X] T040 [US5] Implement `src/game/test/testApi.ts` exposing `window.__lumines` (`seed`, `state`, `marked`, `spawn` [lock-first], `tick` [never auto-spawns], `sweepNow`, `sweepProgress`) bound to the engine — per contracts/test-api.md
- [X] T041 [US5] Gate test mode in `src/game/driver/gameDriver.ts` and `src/app/_components/Game.tsx`: when flag set, pause auto-gravity + audio-synced sweep and call `installTestApi()`; when unset, never install and run normally (build-time dead-code elimination)

### Tests for User Story 5 (Playwright e2e — exercise the full feature)

- [X] T042 [P] [US5] e2e flow in `tests/e2e/flow.spec.ts` (start-button → playing/score 0 → fill spawn zone via `spawn()` → `game-over` → `restart` → empty/score 0) — Scenario A
- [X] T043 [P] [US5] e2e clear & score in `tests/e2e/clear-and-score.spec.ts` (seed, build 2×2 → `sweepNow()` → cells gone + score +4; build 3×3 → +36; gravity collapse) — Scenario B
- [X] T044 [P] [US5] e2e sweep timing in `tests/e2e/sweep-timing.spec.ts` (`sweepProgress(250)`→`sweepX≈1`; `sweepProgress(4000)`→one full traversal) + audio source assertion (`loop`, src `/backing-track.mp3`) — Scenario C

**Checkpoint**: External harness can drive the game deterministically; hooks absent in normal builds.

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: The subjective quality bars (FR-023/FR-024) and final validation.

- [X] T045 [P] In-game animation polish pass in `src/game/render/PixiRenderer.ts` (piece fall easing + settle bounce, sub-block readability, sweep-bar glow/trail, mark pulse, clear flash/particles, smooth collapse)
- [X] T046 [P] Out-of-game UI/UX polish pass across `src/app/_components/*` and `src/styles/globals.css` (cohesive neon Lumines theme, layout, transitions, button states)
- [X] T047 Accessibility pass in `src/app/_components/Game.tsx` (single `<main>`, full keyboard operability, visible focus, sensible labels)
- [X] T048 Run `pnpm check` (lint + `tsc --noEmit`) and resolve all errors
- [X] T049 Run quickstart.md validation: `pnpm test:unit`, `pnpm test:e2e`, and a manual normal-build play-through (confirm no `window.__lumines`)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately.
- **Foundational (Phase 2)**: Depends on Setup — BLOCKS all user stories.
- **User Stories (Phase 3–7)**: All depend on Foundational.
  - **US1 (P1)**: independent after foundation.
  - **US2 (P1)**: core logic independent (unit-tested on constructed grids); engine wiring (T028) depends on US1 engine (T016); full play depends on US1.
  - **US3 (P2)**: depends on US1 (score source) + foundation; game-over wiring touches engine.
  - **US4 (P2)**: depends on US2 sweep + driver (T030).
  - **US5 (P2)**: depends on engine ops from US1/US2 and on US3 screens for `data-testid` hooks; its e2e specs validate US1–US4 behaviour.
- **Polish (Phase 8)**: Depends on the targeted stories being complete.

### Within Each User Story

- Unit tests authored alongside the module they cover (write to fail, then implement).
- Pure-core modules → engine wiring → driver/render/UI integration.
- e2e specs (US5) run only with `NEXT_PUBLIC_TEST_MODE=1`.

### Parallel Opportunities

- **Setup**: T001, T002, T004 in parallel (T003 after T001/T002).
- **Foundational**: T005, T006, T007 in parallel; T008 after T007; T009 after T005/T006; render/React T010–T013 sequential-ish (shared mount chain).
- **US1**: T014 (test) ∥ start; T015 then T016; T017/T019 can proceed once T016 lands.
- **US2**: T020–T023 (tests) and T024–T027 (pure modules) are all separate files → highly parallel; T028 after T024–T027 + T016; T029/T030 after T028.
- **US3**: T031–T034 components in parallel; T035 after them; T036 in engine.
- **US5**: T042–T044 e2e specs in parallel after T040/T041.
- **Polish**: T045 ∥ T046.

---

## Parallel Example: User Story 2

```bash
# Author all US2 unit tests together (separate files):
Task: "Unit test marking in tests/unit/marking.test.ts"      # T020
Task: "Unit test scoring in tests/unit/scoring.test.ts"      # T021
Task: "Unit test sweep in tests/unit/sweep.test.ts"          # T022
Task: "Unit test gravity in tests/unit/gravity.test.ts"      # T023

# Implement all US2 pure-core modules together (separate files):
Task: "Implement src/game/core/marking.ts"                   # T024
Task: "Implement src/game/core/scoring.ts"                   # T025
Task: "Implement src/game/core/sweep.ts"                     # T026
Task: "Implement src/game/core/gravity.ts"                   # T027
```

---

## Implementation Strategy

### MVP First (US1 + US2 — the playable core)

1. Phase 1 Setup → Phase 2 Foundational.
2. Phase 3 (US1): controllable falling/locking pieces. **Validate** with `piece` unit tests + manual play.
3. Phase 4 (US2): marking, sweep, scoring, gravity. **Validate**: build a square, sweep, score increases, stack collapses. This is the true MVP — recognisably Lumines.

### Incremental Delivery

1. Foundation → US1 (falling-block toy) → demo.
2. + US2 → clearing & scoring → demo (core loop).
3. + US3 → full start/score/game-over/restart flow → demo.
4. + US4 → music-synced sweep → demo.
5. + US5 → deterministic test interface + green Playwright suite.
6. Phase 8 polish pass against the subjective quality bars and full quickstart validation.

### Notes

- [P] = different files, no incomplete-task dependency.
- Keep `src/game/core/` free of React/Pixi/DOM/timer imports (vitest target).
- Test hooks must vanish from normal builds — verify in T049.
- Commit after each task or logical group; stop at any checkpoint to validate a story independently.
