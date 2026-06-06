# Phase 0 Research: Accounts, High Scores & Global Leaderboard

No spec `NEEDS CLARIFICATION` markers remain. Research here grounds the (large) feature in
the **actual** project state and pins decisions + offline fallbacks. The dominant theme,
flagged by [[convex-eval-strategy]], is **library reality vs. the spec's named APIs**.

## Observed reality (verified)

- Base is **create-t3-app with tRPC** — `~/trpc/react` provider in `layout.tsx`, routers
  under `src/server/api`. **No `next-auth`, no `@auth/*`, no `convex`, no `convex-test`,
  no `convex-helpers` installed**; **no `convex/` directory**.
- Test seam: `NEXT_PUBLIC_TEST_MODE` (`src/env.js`, `src/game/test-api/flag.ts`) gates
  `window.__lumines`, installed by `GameShell` via `installTestApi(controller)`
  (`src/game/test-api/install.ts`). Game-over is a React phase in `GameShell`
  (`phase: "gameover"`).
- Tests: Vitest (node env) + Playwright (builds then serves with `NEXT_PUBLIC_TEST_MODE=1`).

**Implication**: this feature must *add* Convex + NextAuth from scratch and stay offline.

## Decision 1 — Two seams so the same code runs mock (eval) and real (later)

**Decision**: Components depend on an **auth seam** (`useAuth()`) and a **Convex data seam**
(provider-injected client), never on NextAuth/`ConvexReactClient` directly.
- `TEST_MODE`: `AuthProvider` = in-memory mock driven by `window.__lumines.auth`;
  `ConvexClientProvider` = deterministic in-memory fake implementing
  `submitScore`/`topN`/`personalBest`.
- Normal: `AuthProvider` wraps NextAuth (`useSession`/`signIn`/`signOut`);
  `ConvexClientProvider` wraps a real `ConvexReactClient`.

**Rationale**: Directly using the SDKs in components would force a real OAuth round-trip and
a live backend in tests — both forbidden. The seam is the spec's explicit requirement
("the seam + determinism, not a specific export name").

**Alternatives considered**: per-test network mocking (fragile, not hermetic); shipping
test-only branches inside components (leaks test logic into prod) — rejected.

## Decision 2 — `convex-helpers` fake is OPTIONAL; default to a hand-rolled fake

**Decision**: Use `ConvexReactClientFake` from `convex-helpers` **only if** the installed
version actually exports it; otherwise inject a **small hand-rolled fake** that satisfies the
`useQuery`/`useMutation` shapes the components use, backed by `mockBackend.ts` (the same
pure score logic the real functions implement).

**Rationale**: The spec anticipates the export may be absent ("IF your installed version
exports it; otherwise a small fake client"). A hand-rolled fake removes a dependency risk
and keeps the eval hermetic. The components don't care which fake they get.

**Alternatives considered**: hard dependency on a specific `convex-helpers` export —
rejected (brittle against version reality).

## Decision 3 — `convex/_generated/` is committed; codegen offline or hand-authored

**Decision**: Commit `convex/_generated/`. Generate it with **`convex codegen`** if it runs
fully offline (no login/deploy). If codegen cannot run without provisioning/network,
**hand-author** the minimal `_generated` files (`api`, `server`, `dataModel`) to match
`schema.ts` + `scores.ts` so the app typechecks and `convex-test` can load the modules.

**Rationale**: The app must typecheck/build without a cloud deployment, and `convex dev`/
`deploy`/`login` are forbidden. [[convex-eval-strategy]] explicitly anticipates hand-written
`_generated`.

**Alternatives considered**: running `convex dev` to generate — forbidden. Skipping
`_generated` — breaks typechecking/imports.

## Decision 4 — Data model: one document per user (their best)

**Decision**: A single `scores` table, **one doc per user** keyed by `subject`
(server-derived), holding `{ subject, name, best, updatedAt }`. `submitScore(score)` upserts
the max (insert if absent; update only when `score > best`). `topN` returns the top 10 by
`best` desc (tie-break `updatedAt` asc). `personalBest` returns the caller's doc.

**Rationale**: Directly models "personal best (updates only when beaten)" and
"leaderboard = top-10 by best, one row per user". Minimal, index-friendly (`by_subject`,
`by_best`).

**Alternatives considered**: append-only `runs` log + derive best/topN — more flexible but
extra scope/complexity not required by the spec; rejected for YAGNI.

## Decision 5 — Server-derived identity (security gate)

**Decision**: `submitScore` takes only `{ score }`. It reads
`const id = await ctx.auth.getUserIdentity()`; if null → reject/no-op (unauthenticated rule);
else `subject = id.subject`, `name = id.name`. No `userId`/`subject` is ever accepted from
the client.

**Rationale**: Satisfies FR-004 and the review gate. `convex-test`'s `t.withIdentity({...})`
makes this deterministically testable (writes attributed to the mocked subject; a different
identity can't overwrite another's row).

## Decision 6 — Auth seam handles the unauthenticated rule + the test endGame path

**Decision**: On game over, `GameShell` calls `submitScore({ score })` **only if**
`useAuth().status === "authenticated"`; otherwise it shows the "sign in to save" prompt and
writes nothing. `window.__lumines.endGame(score)` runs this exact path with a chosen score
(no gameplay RNG); `auth.signIn({name, subject})`/`signOut()` flip the mock auth state and
the injected fake's identity.

**Rationale**: Lets the black-box suite assert personal-best-only-improves, leaderboard-
reflects-new-score, and unauthenticated-not-saved with deterministic scores.

## Decision 7 — Test strategy (offline, layered)

**Decision**:
- **Convex functions** (`convex/scores.test.ts`, Vitest + `convex-test`): real `schema.ts` +
  functions; `t.withIdentity` for identity. Assert: insert→best=N; lower→unchanged;
  higher→updated; `topN` order + ≤10; **identity rule** (a second identity gets its own row,
  cannot overwrite the first); unauthenticated `submitScore` is rejected/no-op.
- **UI** (`e2e/leaderboard.spec.ts`, Playwright via mock hooks): sign-in shows
  `user-name`+`signout`; sign-out shows `signin`; `endGame` while signed in updates
  `personal-best` and `leaderboard`/`leaderboard-row`; personal best only improves;
  `endGame` while signed out writes nothing + shows the prompt.
- **No-regression**: existing Vitest + Playwright suites (001–003) stay green.

**Open risk (environmental, not a spec gap)**: package installation may be unavailable
offline. If `pnpm add convex next-auth convex-test` cannot reach a registry, fall back to:
hand-authored `_generated` + hand-rolled fake client + a minimal mock auth, and keep the
real NextAuth/`ConvexReactClient` wiring isolated in provider modules **not imported by the
TEST_MODE path** (so the mocked build/test is green offline). The Convex-function tests
require `convex`/`convex-test` to be present; if they truly cannot be installed, the same
pure score logic is unit-tested via `mockBackend.ts` and the convex functions become thin
wrappers over it — documented as a deviation in tasks. Prefer real install when reachable.

## No-regression analysis

The game subsystem is untouched. Risk areas are additive: provider wrapping in
`layout.tsx` (must not break the existing tRPC provider or SSR), and `GameShell` UI
additions (new testids, must not disturb existing `score`/`game-over`/controls testids).
Both are covered by keeping existing tests green (SC-007/FR-011).
