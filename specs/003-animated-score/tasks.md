---

description: "Task list for Dynamic Animated Score"
---

# Tasks: Dynamic Animated Score

**Input**: Design documents from `/specs/003-animated-score/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/score-fx.md, quickstart.md

**Tests**: INCLUDED. The spec's Testability anchor (`score` stays exact) + the contract's
test hooks call for a Vitest unit test (tier helper) and Playwright cases (effect fires /
scales / transient / value-exact). Subjective "impactful" is validated by the manual
quickstart pass.

**Organization**: Presentation-only. Three prioritized user stories (P1/P2/P3) over a
shared foundational layer (the pure tier helper + the `ScoreFx` overlay mounted over the
game view). No engine/core/renderer/test-API change.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: US1 / US2 / US3 (Setup, Foundational, Polish carry no story label)
- Exact file paths included in each task

## Path Conventions

Existing single web app. React layer under `src/game/react/`; unit tests co-located
(`*.test.ts`, node Vitest env); e2e Playwright under `e2e/`. The authoritative
`data-testid="score"` lives in `src/game/react/GameShell.tsx` and stays unchanged.

---

## Phase 1: Setup (Baseline)

**Purpose**: Known-green baseline so any regression is attributable.

- [X] T001 Record baseline: run `pnpm test`, `pnpm test:e2e`, and `pnpm check`; confirm all pass (features 001 + 002 already merged on this branch)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Shared, non-breaking scaffolding for all stories: the pure tier helper and the
`ScoreFx` overlay mounted over the game view (idle — renders nothing until a story wires
behaviour). The `score` testid is left exactly as-is.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [X] T002 Add a Vitest unit test `src/game/react/score-effects.test.ts` (TDD; node env, pure — no DOM): `fxTier(0) === "none"`, a small positive delta → `"modest"`, a delta ≥ the big threshold → `"big"`; `countUpDurationMs` is clamped/positive. (fails until T003)
- [X] T003 Create the pure helper `src/game/react/score-effects.ts`: `export type FxTier = "none"|"modest"|"big"`, `BIG_THRESHOLD` constant, `fxTier(delta: number): FxTier`, and `countUpDurationMs(delta: number): number`. Make T002 pass.
- [X] T004 [P] Create `src/game/react/ScoreFx.tsx` skeleton: a `pointer-events-none`, absolutely-positioned overlay accepting a `score: number` prop, rendering `data-testid="score-fx"` (idle/empty when no effect is playing). No behaviour yet.
- [X] T005 Mount the overlay over the game view in `src/game/react/GameShell.tsx`: wrap `<GameCanvas>` in a `relative` container and render `<ScoreFx score={score} />` inside it; leave the `data-testid="score"` element in the aside UNCHANGED. (depends on T004)

**Checkpoint**: Project compiles; an idle `score-fx` overlay exists over the board; `score` testid unchanged; all existing tests still green.

---

## Phase 3: User Story 1 - Juicy animated score on every scoring event (Priority: P1) 🎯 MVP

**Goal**: On every score increase, a visible animation fires in the game view (count-up +
pop/scale + flash) while the `score` testid stays the exact authoritative integer.

**Independent Test**: Trigger a scoring clear; `score-fx` becomes visible in the game view
and the `score` testid still equals the exact number.

### Tests for User Story 1 ⚠️ (write first; MUST FAIL before T007)

- [X] T006 [P] [US1] Add a Playwright case in `e2e/lumines.spec.ts`: start, build + `sweepNow` a square so the score increases; assert `score-fx` becomes visible in the game view AND the `score` testid equals the exact value (e.g. `"4"`) during/after the effect (INV-1/INV-2, SC-001/SC-002). Add `score-fx`/`data-fx-tier` to the test typings as needed.

### Implementation for User Story 1

- [X] T007 [US1] In `src/game/react/ScoreFx.tsx`, detect a score increase (delta vs a `prevScore` ref) and play the base effect: an animated count-up of a separate in-view number + a pop/scale + flash; show `data-testid="score-fx"` while the effect plays. Do NOT touch the authoritative `score` testid. (depends on T005)
- [X] T008 [US1] Run `pnpm test:e2e` (and `pnpm test`); confirm T006 passes and the `score` value stays exact

**Checkpoint**: Scoring visibly pops in the game view; authoritative value intact. MVP complete.

---

## Phase 4: User Story 2 - Bigger clears feel bigger (Priority: P2)

**Goal**: Effect intensity scales with the clear — `big` tier for large clears, `modest`
for small, with a visibly stronger/longer effect for `big`.

**Independent Test**: A multi-square (big) clear yields `data-fx-tier="big"`; a single-square
clear yields `"modest"`.

### Tests for User Story 2 ⚠️ (write first; MUST FAIL before T010)

- [X] T009 [P] [US2] Add a Playwright case in `e2e/lumines.spec.ts`: produce a small clear → assert `score-fx` has `data-fx-tier="modest"`; produce a large multi-square clear → assert `data-fx-tier="big"` (INV-3, SC-003).

### Implementation for User Story 2

- [X] T010 [US2] In `src/game/react/ScoreFx.tsx`, compute the tier with `fxTier(delta)` from `score-effects.ts`, set `data-fx-tier` on the `score-fx` element, and scale the visual intensity (extra particles/flash, stronger pop) for `big` vs `modest`. (depends on T007)
- [X] T011 [US2] Run `pnpm test` and `pnpm test:e2e`; confirm T009 passes and US1 still green

**Checkpoint**: Big plays punch harder; small plays stay modest.

---

## Phase 5: User Story 3 - Feedback never disrupts play or correctness (Priority: P3)

**Goal**: Effects are transient and non-blocking, never permanently obscure the board,
reset cleanly on restart, and honour reduced motion.

**Independent Test**: After an effect plays it disappears; the overlay never blocks input;
restart resets the score to 0 with no stale effect.

### Tests for User Story 3 ⚠️ (write first; MUST FAIL before T013)

- [X] T012 [P] [US3] Add Playwright cases in `e2e/lumines.spec.ts`: the `score-fx` overlay is `pointer-events-none` and disappears after its duration (transient); after `restart`, the `score` testid is `0` and no `score-fx` effect is visible (INV-4/INV-5, SC-004).

### Implementation for User Story 3

- [X] T013 [US3] In `src/game/react/ScoreFx.tsx`: auto-expire each burst via timers with cleanup (transient); ensure `pointer-events-none`; on a non-positive delta / restart (`score → 0`) clear in-flight effects and snap the displayed value to `score`; add a `prefers-reduced-motion` dialed-down path. (depends on T007)
- [X] T014 [US3] Run `pnpm test` and `pnpm test:e2e`; confirm T012 passes and US1/US2 still green

**Checkpoint**: Polish is safe — non-blocking, transient, resets cleanly, accessible.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Confirm no regression and validate the feel.

- [X] T015 [P] Run the full existing suites and confirm no regression, including features 001/002 and gameplay (square clear, gravity settle, sweep timing, game over/restart): `pnpm test` + `pnpm test:e2e`
- [X] T016 Run `pnpm check` (lint + `tsc --noEmit`) — clean
- [X] T017 Execute `specs/003-animated-score/quickstart.md` §2 manual feel check (`NEXT_PUBLIC_TEST_MODE=1 pnpm dev`): confirm impactful in-view feedback on scoring, big clears hit harder, the HUD number stays correct, nothing blocks play, and reduced-motion dials it down

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: none — start immediately.
- **Foundational (Phase 2)**: after Setup — BLOCKS all stories. T002 (test) → T003 (helper); T004 [P]; T005 after T004.
- **User Stories (Phase 3–5)**: all require Foundational. US1 (P1) is the MVP and lands first; US2 and US3 build on US1's effect but are independently testable.
- **Polish (Phase 6)**: after the desired stories are complete.

### User Story Dependencies

- **US1 (P1)**: needs Foundational only. Self-contained MVP (effect fires; value exact).
- **US2 (P2)**: needs Foundational + US1's effect (adds tier scaling via `fxTier`). Independently testable.
- **US3 (P3)**: needs Foundational + US1's effect (adds transience/reset/reduced-motion). Independently testable.

### Within Each User Story

- The Playwright test is authored first and must fail before the story's `ScoreFx.tsx` impl.
- US1: T006 → T007 → T008. US2: T009 → T010 → T011. US3: T012 → T013 → T014.

### Parallel Opportunities

- Foundational: T004 (`ScoreFx.tsx`) is [P] with the helper work (T002/T003, different
  files); T005 (GameShell mount) waits on T004.
- Each story's e2e test (`e2e/lumines.spec.ts`) is one shared file → author sequentially
  across stories; the [P] marker flags it as independent of the impl file (`ScoreFx.tsx`).

---

## Parallel Example: Foundational

```bash
# Different files, no inter-dependency:
Task: "Create pure tier helper + unit test (src/game/react/score-effects.ts / .test.ts)"
Task: "Create the ScoreFx overlay skeleton (src/game/react/ScoreFx.tsx)"
```

---

## Implementation Strategy

### MVP First (Foundational + User Story 1)

1. Phase 1: baseline.
2. Phase 2: pure tier helper (+unit test) and the idle `ScoreFx` overlay mounted over the
   game view — non-breaking.
3. Phase 3: US1 — effect fires on score increase (count-up + pop/flash); `score` stays exact.
4. **STOP and VALIDATE**: scoring feels juicy in-view; value assertions intact; suites green.
5. Phases 4–5: US2 (tier scaling) then US3 (transient/reset/reduced-motion).
6. Phase 6: regression + lint/typecheck + manual feel pass.

### Incremental Delivery

Foundational → US1 (MVP, juicy score) → US2 (bigger = bigger) → US3 (safe polish), each
independently testable and shippable.

---

## Notes

- [P] = different files, no dependency.
- **Do not touch** the `data-testid="score"` element, the controller, core, renderer, or
  `window.__lumines` — the feature is purely an additive React overlay + a pure helper.
- The authoritative integer never count-ups; the count-up animates a separate cosmetic
  element so value assertions never break.
- Keep the overlay `pointer-events-none` and time-boxed so it can't block input or cover
  the board.
- Commit after each story's verify task.
