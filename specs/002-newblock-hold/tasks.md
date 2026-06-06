---

description: "Task list for New-Block Hold + Deliberate Re-Press"
---

# Tasks: New-Block Hold + Deliberate Re-Press

**Input**: Design documents from `/specs/002-newblock-hold/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/hold-and-test-api.md, quickstart.md

**Tests**: INCLUDED. The spec's Testability section and the plan/contracts call for Vitest
controller tests and Playwright `window.__lumines` cases, so test tasks are generated
(TDD: story tests authored before that story's implementation).

**Organization**: Three prioritized user stories (P1/P2/P3) over a shared foundational
layer. The hold lifecycle is one cohesive controller change; foundational builds the
non-breaking scaffolding (types/constant/observability/wiring), then each story adds its
behaviour slice + independent tests.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: US1 / US2 / US3 (Setup, Foundational, Polish carry no story label)
- Exact file paths included in each task

## Path Conventions

Existing single web app. Core under `src/game/core/`; controller `src/game/engine/`; React
`src/game/react/`; test API `src/game/test-api/`. Unit tests co-located (`*.test.ts`); e2e
Playwright under `e2e/`.

---

## Phase 1: Setup (Baseline)

**Purpose**: Known-green baseline so any regression is attributable.

- [X] T001 Record baseline: run `pnpm test`, `pnpm test:e2e`, and `pnpm check` from repo root and confirm all pass (feature-001 already merged on this branch)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Non-breaking scaffolding shared by ALL stories: the hold constant, types, the
observable `hold` field, controller hold state + `beginHold()` on every spawn path, and the
keyboard freshness wiring. After this phase the game still behaves as today (gravity is not
yet gated; `tick()` is not yet hold-aware) but `state().hold` is observable.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [X] T002 [P] Add `HOLD_MS = SECONDS_PER_BEAT * 1000` (= 500) with a "one beat" comment in `src/game/core/constants.ts`
- [X] T003 [P] Add `HoldState { active: boolean; remainingMs: number }` to `src/game/core/types.ts`; add `hold: HoldState` to `PublicState` and return the inactive default `{ active: false, remainingMs: 0 }` from `publicState()` in `src/game/core/index.ts`
- [X] T004 Scaffold hold state in `src/game/engine/controller.ts`: add private `holdActive`/`holdRemainingMs` fields and a `beginHold()` helper (`holdActive=true, holdRemainingMs=HOLD_MS`, only when an active piece exists); call `beginHold()` on every spawn path (`start()` first spawn, `gravityTickAndSpawn()` after lock, `input` soft/hard-drop auto-spawn, `testSpawn()`); add `hold` to `RenderState` and source it in `renderState()`; override `hold` in `testState()`; change `input(action)` signature to `input(action, opts?: { fresh?: boolean })` with `fresh` defaulting to `true` (no gating yet). (depends on T002, T003)
- [X] T005 [P] In `src/game/react/GameShell.tsx`, pass `{ fresh: !e.repeat }` from the `keydown` handler into `controller.input(action, …)` (wiring only; behaviour unchanged until gating lands)

**Checkpoint**: Project compiles; `state().hold.active` is true right after a spawn; all existing tests still green (gravity/tick unchanged).

---

## Phase 3: User Story 1 - New block holds; held key does not carry over (Priority: P1) 🎯 MVP

**Goal**: On spawn the block holds for the hold window and does not descend; a drop key
held across the lock (non-fresh) does not drop the new block; move/rotate stay free. The
hold lapses to normal gravity so play continues (minimum viable + cascade killed).

**Independent Test**: Spawn a block; with no fresh press it advances 0 rows while
`state().hold.active` is true; a carried-over (non-fresh / no press-hook) drop causes no
descent; holding across multiple spawns skips no holds.

### Tests for User Story 1 ⚠️ (write first; MUST FAIL before T008/T009)

- [X] T006 [P] [US1] Add Vitest tests in `src/game/engine/controller.test.ts` (reuse the rAF-pump harness from feature 001): held piece does not descend while `remainingMs > 0`; `input('softDrop', { fresh: false })` during hold is a no-op (no descent, still held); move/rotate during hold apply and leave `remainingMs` unchanged; once the hold lapses the piece descends.
- [X] T007 [P] [US1] Add Playwright cases in `e2e/lumines.spec.ts`: after `spawn`, `state().hold.active === true` and 0-row advance with no press; a carry-over `tick()` (no press hook) does not fast-drop the block; holding across multiple `spawn()`s (never calling press hooks) skips no holds. ALSO update the existing "spawn places at top-centre; tick advances" test for the hold-aware `tick()` (first tick lapses the hold without descending; the next tick descends).

### Implementation for User Story 1

- [X] T008 [US1] In `src/game/engine/controller.ts` `advance(dt)`: while `holdActive`, do NOT apply gravity to the piece — decrement `holdRemainingMs` by `dt`, and at `≤ 0` set `holdActive=false`, clamp `holdRemainingMs=0`, and reset `gravityAccumMs=0` (so the first post-hold descent is a full normal interval later). Sweep continues unconditionally.
- [X] T009 [US1] In `src/game/engine/controller.ts`: make `testTick()` hold-aware (a tick while `holdActive` lapses the hold without descending; otherwise normal gravity step); add the fresh-gate so non-fresh `softDrop`/`hardDrop` in `input()` are ignored while `holdActive` (and behave normally when not holding). (depends on T008)
- [X] T010 [US1] Run `pnpm test` and `pnpm test:e2e`; confirm T006/T007 pass and the updated descent test passes

**Checkpoint**: Holding works on every spawn, the soft-drop cascade is dead, and unattended blocks fall by normal gravity. MVP complete.

---

## Phase 4: User Story 2 - Fresh deliberate press drops immediately (Priority: P2)

**Goal**: A fresh soft/hard-drop press during the hold ends it at once and engages the
drop — no waiting out the beat.

**Independent Test**: Spawn (held); a fresh `pressSoftDrop()` descends immediately with
`hold.active` false; a fresh `pressHardDrop()` lands immediately.

### Tests for User Story 2 ⚠️ (write first; MUST FAIL before T012)

- [X] T011 [P] [US2] Add tests: Vitest in `src/game/engine/controller.test.ts` — a fresh `input('softDrop', { fresh: true })` during hold ends the hold and descends one row immediately; Playwright in `e2e/lumines.spec.ts` — `pressSoftDrop()` during hold descends and sets `hold.active === false`; `pressHardDrop()` during hold lands the block immediately.

### Implementation for User Story 2

- [X] T012 [US2] In `src/game/engine/controller.ts`: add `testPressSoftDrop()` / `testPressHardDrop()` (end the hold if active, then perform a soft-drop step / hard-drop, then `emit()`); in `input()`, a fresh (`fresh: true`) soft/hard-drop while `holdActive` ends the hold and performs that drop.
- [X] T013 [US2] In `src/game/test-api/install.ts`, add `pressSoftDrop()` / `pressHardDrop()` to `LuminesTestApi` delegating to the controller methods; extend the local `State`/api typings in `e2e/lumines.spec.ts` as needed (add `hold` to the test `State` interface and the two press methods).
- [X] T014 [US2] Run `pnpm test` and `pnpm test:e2e`; confirm T011 passes

**Checkpoint**: Deliberate players can drop instantly during the hold; US1 still green.

---

## Phase 5: User Story 3 - Hold lapses into normal gravity (Priority: P3)

**Goal**: With no fresh press, once the hold window elapses the block falls at the normal
gravity rate (not accelerated, not an instant catch-up), and a later fresh press engages
normally.

**Independent Test**: Spawn (held); pass time ≥ `HOLD_MS` with no press; the block then
descends at the normal gravity cadence and `hold.active` is false.

### Tests for User Story 3 ⚠️ (write first)

- [X] T015 [P] [US3] Add tests: Vitest in `src/game/engine/controller.test.ts` (rAF pump) — after pumping ≥ `HOLD_MS` with no press, the first descent occurs ~one `GRAVITY_INTERVAL_MS` later (normal cadence, not instant) and `getRenderState().hold` has counted down to inactive; after the lapse a fresh `input('softDrop',{fresh:true})` still soft-drops. Playwright — tick to lapse the hold, then confirm subsequent ticks descend at one row per tick (normal gravity).

### Implementation for User Story 3

- [X] T016 [US3] In `src/game/engine/controller.ts`, confirm/finalize the lapse path from T008 resets `gravityAccumMs` so there is no instant catch-up descent at hold-end; adjust only if the T015 normal-cadence assertion requires it.
- [X] T017 [US3] Run `pnpm test` and `pnpm test:e2e`; confirm T015 passes

**Checkpoint**: Full lifecycle complete — hold → (fresh press | lapse) → normal gravity.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Confirm no regression and validate end-to-end.

- [X] T018 [P] Run the full existing suites and confirm no regression, including the feature-001 bottom-row clip tests and the gameplay tests (square clear, gravity settle, sweep timing, game over/restart): `pnpm test` + `pnpm test:e2e`
- [X] T019 Run `pnpm check` (lint + `tsc --noEmit`) — clean
- [X] T020 Execute `specs/002-newblock-hold/quickstart.md` §2 manual feel check (`NEXT_PUBLIC_TEST_MODE=1 pnpm dev`): confirm the "ready to place" beat, that holding the drop key across a lock does not cascade, and that a fresh re-press drops immediately

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: none — start immediately.
- **Foundational (Phase 2)**: after Setup — BLOCKS all user stories. T002/T003/T005 are [P]; T004 depends on T002+T003.
- **User Stories (Phase 3–5)**: all require Foundational. US1 (P1) is the MVP and should land first; US2 and US3 build on US1's hold gate but are independently testable.
- **Polish (Phase 6)**: after the desired stories are complete.

### User Story Dependencies

- **US1 (P1)**: needs Foundational only. Self-contained MVP (hold + cascade kill + lapse).
- **US2 (P2)**: needs Foundational + US1's hold gate (fresh-press ends the same hold). Independently testable.
- **US3 (P3)**: needs Foundational + US1's lapse path (refines/asserts normal-gravity quality). Independently testable.

### Within Each User Story

- Tests are authored first and must fail before the story's implementation tasks.
- US1: T006/T007 (tests) → T008 → T009 → T010 (verify).
- US2: T011 (tests) → T012 → T013 → T014 (verify).
- US3: T015 (tests) → T016 → T017 (verify).

### Parallel Opportunities

- Foundational: T002, T003, T005 in parallel (different files); T004 after T002+T003.
- Each story's test task is [P] with the prior story's test task only if different files —
  here all unit tests share `controller.test.ts` and all e2e share `lumines.spec.ts`, so
  test tasks within the SAME file must be authored sequentially; the [P] marker reflects
  unit-vs-e2e being different files.
- T018 (regression run) is independent review; T019/T020 are final gates.

---

## Parallel Example: Foundational

```bash
# Different files, no inter-dependency:
Task: "Add HOLD_MS to src/game/core/constants.ts"
Task: "Add HoldState + PublicState.hold to src/game/core/types.ts and index.ts"
Task: "Pass fresh = !e.repeat from keydown in src/game/react/GameShell.tsx"
```

---

## Implementation Strategy

### MVP First (Foundational + User Story 1)

1. Phase 1: baseline.
2. Phase 2: scaffolding (types/constant/observability/wiring) — non-breaking.
3. Phase 3: US1 — hold gates gravity, carry-over ignored, lapse to normal gravity.
4. **STOP and VALIDATE**: cascade killed; `state().hold` correct; existing suites green.
5. Phases 4–5: US2 (fresh press) then US3 (normal-gravity quality).
6. Phase 6: regression + lint/typecheck + manual feel.

### Incremental Delivery

Foundational → US1 (MVP, cascade fixed) → US2 (responsiveness) → US3 (passive-fall polish),
each independently testable and shippable.

---

## Notes

- [P] = different files, no dependency.
- Keep the pure core time-free: hold timing lives in the controller; core only gains the
  `hold` projection field with an inactive default.
- The only intentionally-changed existing test is the "spawn places at top-centre; tick
  advances" descent assertion (hold-aware `tick()`); all other existing tests must stay
  green unchanged.
- Reuse the rAF-pump unit-test harness introduced in feature 001 for fine-grained hold
  timing assertions.
- Commit after each story's verify task.
