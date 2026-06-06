---

description: "Task list for Accounts, High Scores & Global Leaderboard"
---

# Tasks: Accounts, High Scores & Global Leaderboard

**Input**: Design documents from `/specs/004-convex-leaderboard/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/convex-functions.md, contracts/ui-and-test-hooks.md, quickstart.md

**Tests**: INCLUDED. The spec mandates a server-side identity test (`convex-test`) and
black-box DOM/flow assertions (Playwright via `window.__lumines` mock hooks). All offline.

**Organization**: A shared backend + two seams (Foundational) underpin four prioritized
user stories. **Dual-mode, OFFLINE**: build/test against the deterministic mock only — do
NOT run `convex dev`/`deploy`/`login`; commit `convex/_generated/`. See research.md
Decision 7 for the offline package-install fallback.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: US1 / US2 / US3 / US4 (Setup, Foundational, Polish carry no story label)
- Exact file paths included in each task

## Path Conventions

create-t3-app + tRPC base. Backend under `convex/`; auth under `src/server/auth/`; React/
seams under `src/game/react/`; test seam in `src/game/test-api/`. Unit/function tests via
Vitest (`*.test.ts`); e2e Playwright under `e2e/`.

---

## Phase 1: Setup

**Purpose**: Baseline + add dependencies + env, so the backend and seams can be built.

- [X] T001 Record baseline: run `pnpm test`, `pnpm test:e2e`, `pnpm check`; confirm all pass (features 001/002/003 merged on this branch)
- [X] T002 Add deps: `pnpm add convex next-auth` and `pnpm add -D convex-test` (and `convex-helpers` only if its installed version exports a usable fake). **If the registry is unreachable offline**, follow research.md Decision 7 fallback (hand-rolled fake client + hand-authored `_generated`; isolate real wiring) and record the deviation here.
- [X] T003 Extend `src/env.js`: add server `AUTH_SECRET`/`AUTH_GOOGLE_ID`/`AUTH_GOOGLE_SECRET` and `NEXT_PUBLIC_CONVEX_URL` as **optional** (so the mock/test build validates without them); mirror in `.env.example`. Do not add real secrets.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The shared Convex backend, its server-side identity security, the in-memory
mock, both provider seams, and the test-mode auth/endGame hooks. All stories depend on this.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [X] T004 Create `convex/schema.ts`: `scores` table `{ subject, name, best, updatedAt }` with indexes `by_subject` and `by_best` (per data-model.md).
- [X] T005 Create `convex/scores.ts`: `submitScore({score})` (identity from `ctx.auth.getUserIdentity()`, null → no write/return null, else upsert max best — **never read a client `userId`/`subject`**); `topN({limit=10})` (top-10 by `best` desc, tie-break `updatedAt` asc); `personalBest()` (caller's best or null). Per contracts/convex-functions.md. (depends on T004)
- [X] T006 Produce **committed** `convex/_generated/` (`api`, `server`, `dataModel`): run `convex codegen` **iff it works fully offline**; otherwise hand-author the minimal files to match T004/T005 (research.md Decision 3). Do NOT run `convex dev`/`deploy`/`login`. (depends on T005)
- [X] T007 [P] Add `convex/scores.test.ts` (Vitest + `convex-test`, mocked identity via `t.withIdentity`): attribution to the mocked `subject` (INV-A); best only improves (INV-B); `topN` ≤10 ordered + one row per user (INV-C); `personalBest` reflects only caller (INV-D); a second identity can't overwrite the first; unauthenticated `submitScore` writes nothing. (depends on T005/T006) — *fallback: if `convex-test` is unavailable offline, unit-test the same logic via `mockBackend.ts` and make the convex functions thin wrappers (note the deviation).*
- [X] T008 [P] Create `src/game/react/auth/mockBackend.ts`: a deterministic in-memory scores store implementing the same `submitScore`/`topN`/`personalBest` semantics (max-best upsert keyed by `subject`), used by the TEST_MODE fake client.
- [X] T009 Create the auth seam `src/game/react/auth/useAuth.ts` + `src/game/react/providers/AuthProvider.tsx`: expose `{status,name,avatar,subject,signIn,signOut}`; TEST_MODE → in-memory mock state (driven later by the window hook); normal → NextAuth (`useSession`/`signIn("google")`/`signOut`), with the real wiring isolated so the TEST_MODE path imports nothing requiring network. (depends on T002)
- [X] T010 Create the Convex data seam `src/game/react/providers/ConvexClientProvider.tsx`: TEST_MODE → fake client over `mockBackend.ts` exposing `submitScore`/`topN`/`personalBest` to `useQuery`/`useMutation`-style calls; normal → real `ConvexReactClient`. Same call surface either way. (depends on T006/T008)
- [X] T011 Wire `AuthProvider` + `ConvexClientProvider` into `src/app/layout.tsx` (compose with the existing `TRPCReactProvider`; must not break SSR or existing rendering). (depends on T009/T010)
- [X] T012 Add NextAuth route + config under `src/server/auth/` (Google provider) for normal mode only, isolated so it is not imported in the TEST_MODE path. (depends on T002)
- [X] T013 Extend the test seam: add `window.__lumines.auth.signIn({name,subject})` / `auth.signOut()` (flip the mock auth state AND the fake client's `getUserIdentity()` subject) and `window.__lumines.endGame(score)` plumbing (run the real game-over path with an exact score) in `src/game/test-api/install.ts` + `src/game/react/GameShell.tsx`, gated by TEST_MODE exactly like the existing hooks. (depends on T009/T010)

**Checkpoint**: Backend + seams + test hooks exist; `pnpm check` green (committed `_generated`); `convex/scores.test.ts` green; existing suites still pass. No UI yet.

---

## Phase 3: User Story 1 - Sign in / out with Google (Priority: P1) 🎯 MVP

**Goal**: Sign in/out with the signed-in identity reflected in the UI.

**Independent Test**: `auth.signIn` → `user-name` + `signout` shown; `auth.signOut` → `signin` shown.

### Tests for User Story 1 ⚠️ (write first; MUST FAIL before T015)

- [X] T014 [P] [US1] Add `e2e/leaderboard.spec.ts` case: `__lumines.auth.signIn({name:"Ada",subject:"u-ada"})` → `user-name` shows "Ada" and `signout` is present; `__lumines.auth.signOut()` → `signin` is present (INV-1, SC-001).

### Implementation for User Story 1

- [X] T015 [US1] Create `src/game/react/AuthControls.tsx` (consumes `useAuth()`): renders `signin` when signed out, `user-name` + avatar + `signout` when signed in; mount it in `src/game/react/GameShell.tsx` header. (depends on T013)
- [X] T016 [US1] Run `pnpm test:e2e`; confirm T014 passes and existing tests stay green.

**Checkpoint**: Auth visible and reflected in the UI. MVP slice complete.

---

## Phase 4: User Story 2 - Save high scores & personal best (Priority: P2)

**Goal**: Signed-in game over persists the run and keeps the personal best (only improves); player sees it.

**Independent Test**: signed in, `endGame(100)`→PB 100; `endGame(50)`→PB 100; `endGame(150)`→PB 150.

### Tests for User Story 2 ⚠️ (write first; MUST FAIL before T018)

- [X] T017 [P] [US2] Add `e2e/leaderboard.spec.ts` cases: signed-in `endGame(N)` sets `personal-best`; lower score leaves it unchanged; higher score raises it (INV-2, SC-002). (Server rule already covered by T007.)

### Implementation for User Story 2

- [X] T018 [US2] In `src/game/react/GameShell.tsx`, on game over **when `useAuth().status==="authenticated"`** call the seam `submitScore({score})` then refresh `personalBest`; render `personal-best` (a small component or in `Leaderboard.tsx`) on the start/game-over screens. Wire `window.__lumines.endGame(score)` to run this exact path. (depends on T013/T015)
- [X] T019 [US2] Run `pnpm test` (incl. `convex/scores.test.ts`) and `pnpm test:e2e`; confirm T017 passes and US1 still green.

**Checkpoint**: Personal best persists and only improves; attribution is server-derived (T007).

---

## Phase 5: User Story 4 - Unauthenticated play allowed but not saved (Priority: P2)

**Goal**: Signed-out players play fully; their scores aren't saved; they're prompted to sign in.

**Independent Test**: signed out, `endGame(999)` → no `personal-best`, no `leaderboard-row` for them, "sign in to save" prompt shown; gameplay unaffected.

### Tests for User Story 4 ⚠️ (write first; MUST FAIL before T021)

- [X] T020 [P] [US4] Add `e2e/leaderboard.spec.ts` cases: signed-out `endGame(999)` writes nothing (no new `leaderboard-row`, no `personal-best`) and shows the sign-in prompt; full gameplay still works while signed out (INV-4, SC-004).

### Implementation for User Story 4

- [X] T021 [US4] In `src/game/react/GameShell.tsx`, guard the game-over submit so signed-out runs never call `submitScore`, and render a "sign in to save" prompt on game over when unauthenticated. (depends on T018)
- [X] T022 [US4] Run `pnpm test:e2e`; confirm T020 passes and US1/US2 still green.

**Checkpoint**: The signed-in-only persistence rule holds; open play preserved.

---

## Phase 6: User Story 3 - Global top-10 leaderboard (Priority: P3)

**Goal**: A global top-10 leaderboard renders in-app and reflects newly submitted scores.

**Independent Test**: leaderboard shows ≤10 ranked rows; a new qualifying score appears in order.

### Tests for User Story 3 ⚠️ (write first; MUST FAIL before T024)

- [X] T023 [P] [US3] Add `e2e/leaderboard.spec.ts` cases: with multiple identities' scores submitted, `leaderboard` shows ≤10 `leaderboard-row`s ordered high→low and reflects a newly submitted qualifying score (INV-3, SC-003).

### Implementation for User Story 3

- [X] T024 [US3] Create `src/game/react/Leaderboard.tsx` consuming the seam `topN()`: render `leaderboard` + one `leaderboard-row` per entry (name + score); mount on the start and game-over screens in `src/game/react/GameShell.tsx`; ensure it refreshes after a qualifying `endGame`. (depends on T018)
- [X] T025 [US3] Run `pnpm test:e2e`; confirm T023 passes and US1/US2/US4 still green.

**Checkpoint**: Full feature — auth + personal best + leaderboard + unauth guard.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Security re-review, no-regression, and offline gate.

- [X] T026 Security re-review (review gate / SC-005): confirm `submitScore` derives the user only from `ctx.auth` and reads no client identifier; confirm the identity-isolation test (T007) covers cross-user overwrite + unauthenticated no-op.
- [X] T027 [P] Run the full existing suites and confirm no regression, including features 001/002/003 and gameplay: `pnpm test` + `pnpm test:e2e`.
- [X] T028 Run `pnpm check` (lint + `tsc --noEmit`) — must pass thanks to the committed `convex/_generated/`; then execute `specs/004-convex-leaderboard/quickstart.md` §1–§3 (offline). Do NOT run the §4 real-backend pass.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: T001 first; T002 (deps) gates the backend + seams; T003 [P] with T002.
- **Foundational (Phase 2)**: after Setup — BLOCKS all stories. Order: T004→T005→T006; T007/T008 [P] after T005/T006; T009/T012 after T002; T010 after T006/T008; T011 after T009/T010; T013 after T009/T010.
- **User Stories (Phase 3–6)**: all require Foundational. US1 (P1) first; US2 (P2) then US4 (P2) then US3 (P3). US4 and US3 build on US2's game-over submit + PB wiring.
- **Polish (Phase 7)**: after the desired stories.

### User Story Dependencies

- **US1 (P1)**: Foundational only — self-contained auth MVP.
- **US2 (P2)**: Foundational + US1 (needs a signed-in identity to submit).
- **US4 (P2)**: Foundational + US2 (guards the same game-over submit path).
- **US3 (P3)**: Foundational + US2 (reads scores written by submit).

### Within Each User Story

- The Playwright (or convex-test) test is authored first and must fail before the impl.
- US1: T014 → T015 → T016. US2: T017 → T018 → T019. US4: T020 → T021 → T022. US3: T023 → T024 → T025.

### Parallel Opportunities

- Setup: T003 [P] with T002.
- Foundational: T007 (function tests) [P] with T008 (mockBackend) — different files; T009 (auth seam) [P] with T012 (NextAuth route).
- Each story's test task is [P] (e2e file is shared, so author sequentially across stories; the marker flags independence from the story's impl files).

---

## Parallel Example: Foundational

```bash
# After the schema + functions + _generated exist (T004–T006):
Task: "convex-test function/security tests in convex/scores.test.ts"
Task: "in-memory mockBackend.ts for the TEST_MODE fake client"
```

---

## Implementation Strategy

### MVP First (Foundational + US1)

1. Phase 1: baseline + deps + env (mind the offline fallback).
2. Phase 2: Convex backend (schema/functions/`_generated`) + `convex-test` security test + both seams + test hooks — the hardest, blocking part.
3. Phase 3: US1 — sign in/out reflected in the UI.
4. **STOP and VALIDATE**: auth works against the mock; `pnpm check`/tests green offline.
5. Phases 4–6: US2 (personal best) → US4 (unauth guard) → US3 (leaderboard).
6. Phase 7: security re-review + regression + offline gate.

### Incremental Delivery

Foundational → US1 (auth) → US2 (personal best, server-derived) → US4 (open-play guard) →
US3 (leaderboard). Each story is independently testable against the mock.

---

## Notes

- **OFFLINE / dual-mode**: never run `convex dev`/`deploy`/`login`; commit `convex/_generated/`;
  the real `ConvexReactClient`/NextAuth wiring is isolated out of the TEST_MODE path so the
  mock build/test is hermetic. See research.md Decision 7 for the package-install fallback.
- **Security gate (hard)**: `submitScore` derives the user from `ctx.auth` only — never a
  client-passed id (FR-004/SC-005), proven by the identity-mocked `convex-test`.
- Keep the existing game subsystem and testids (`score`, `game-over`, `restart`, controls)
  unchanged; new testids: `signin`/`signout`/`user-name`/`personal-best`/`leaderboard`/`leaderboard-row`.
- Commit after each story's verify task.
