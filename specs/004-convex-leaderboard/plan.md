# Implementation Plan: Accounts, High Scores & Global Leaderboard

**Branch**: `004-convex-leaderboard` | **Date**: 2026-06-05 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/004-convex-leaderboard/spec.md`

## Summary

Add Google sign-in (NextAuth), per-user persistent high scores + personal best, and a
global top-10 leaderboard (Convex) — without rebuilding the game. The score a run is
attributed to is derived from the authenticated identity **server-side**. Everything is
built and tested against a **deterministic mock** (no real OAuth, no live Convex); the
identical component/function code runs against a real backend in a later production pass.

**Technical approach** — two seams plus a Convex backend:

1. **Auth seam** (`useAuth()` + provider). Components consume a small auth interface
   (`{ status, name, avatar, subject, signIn(), signOut() }`), never NextAuth directly. In
   normal mode the provider is backed by NextAuth (Google SSO); in `TEST_MODE` it is backed
   by an in-memory mock driven by `window.__lumines.auth.signIn/signOut`. Real NextAuth
   wiring is isolated so the mock/test path builds and runs offline.
2. **Convex data seam** (`ConvexProvider`-level). The same `useQuery`/`useMutation`-style
   calls run against a real `ConvexReactClient` (normal) or a deterministic in-memory fake
   (`TEST_MODE`). The fake implements the same `submitScore`/`topN`/`personalBest` surface.
3. **Convex backend** (`convex/schema.ts` + functions): `submitScore` (mutation, identity
   from `ctx.auth.getUserIdentity()`, upsert best), `topN` (query, top-10 by best),
   `personalBest` (query, caller's best). `convex/_generated/` is **committed**. Server
   functions are tested with `convex-test` (in-memory) using `t.withIdentity(...)` —
   which also proves the server-derived-identity security rule.
4. **UI + game-over wiring** in `GameShell`: sign-in/out + identity, personal-best, and
   leaderboard (start + game-over), with stable testids; on game over a signed-in run calls
   `submitScore`; `window.__lumines.endGame(score)` runs that real path deterministically.

The existing game (engine/core/renderer, features 001–003) is untouched except for adding
auth/leaderboard UI around it and the test-hook additions.

## Technical Context

**Language/Version**: TypeScript 5.8 (strict), React 19, Next.js 15 (App Router)

**Primary Dependencies**: Existing — tRPC/react-query, pixi.js. **To add** — `convex`
(client + server + codegen), `next-auth` (Google provider), `convex-test` (in-memory
backend, dev). Possibly `convex-helpers` *iff* its installed version exports a usable fake;
otherwise a small hand-rolled fake client.

**Storage**: Convex (sole backend for scores/leaderboard) — accessed only via the seam; in
tests an in-memory fake/`convex-test`. No other DB.

**Testing**: Vitest (`pnpm test`) for the Convex functions via `convex-test` (mocked
identity) + any pure helpers; Playwright (`pnpm test:e2e`) for auth/leaderboard UI driven by
the `TEST_MODE` mock hooks. All offline.

**Target Platform**: Modern browsers; Next.js server for auth routes.

**Project Type**: Single web app (create-t3-app + tRPC base). Adds `convex/` + auth.

**Performance Goals**: Leaderboard read is top-10 (trivial); no impact on the 60fps game loop.

**Constraints**: Build/test entirely against the mock. **Do NOT run `convex dev`,
`convex deploy`, or `convex login`** (no network/provisioning). Commit `convex/_generated/`.
Security gate: per-user writes derive the user from `ctx.auth` server-side — never a
client-passed id. `TEST_MODE` hooks gated exactly like the existing game hooks, never
shipped.

**Scale/Scope**: Largest of the four features — new backend, auth, two seams, committed
`_generated`, new UI. Net-new files under `convex/`, `src/server/auth*`, `src/game/react/`,
plus test-seam additions.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

The constitution file is an unpopulated template — no ratified gates. Applying the
codebase's defaults plus the spec's explicit review gate:

- **Security (self-imposed hard gate)**: PASS by design — `submitScore` ignores any client
  identifier and derives the player from `ctx.auth.getUserIdentity()`; covered by a
  `convex-test` identity test.
- **Don't rebuild / keep existing behaviour**: PASS — game engine/core/renderer and features
  001–003 untouched; auth/leaderboard are additive UI + a backend.
- **Determinism / offline**: PASS — mock seam makes the suite hermetic; no network, no
  Convex provisioning; `_generated` committed.
- **Test seam parity**: PASS — same component/function code runs mock vs real via the seams.
- **Simplicity / YAGNI**: PASS — one-doc-per-user best model; top-10; out-of-scope list
  (friends/profiles/realtime/anti-cheat) honoured.

No violations. Complexity Tracking notes the unavoidable dual-mode seam (justified below).

## Project Structure

### Documentation (this feature)

```text
specs/004-convex-leaderboard/
├── plan.md              # This file
├── research.md          # Phase 0 — decisions, library-reality risks + fallbacks
├── data-model.md        # Phase 1 — Convex schema + entities
├── quickstart.md        # Phase 1 — offline mock validation guide
├── contracts/
│   ├── convex-functions.md   # submitScore / topN / personalBest signatures + rules
│   └── ui-and-test-hooks.md  # DOM testids + window.__lumines auth/endGame + seams
├── checklists/requirements.md
└── tasks.md             # /speckit-tasks (not created here)
```

### Source Code (repository root)

```text
convex/
├── schema.ts                 # scores table (one doc per user: subject, name, best, updatedAt)
├── scores.ts                 # submitScore (mutation), topN (query), personalBest (query)
└── _generated/               # COMMITTED (api.d.ts/api.js/server.d.ts/dataModel.d.ts ...)

src/server/auth/              # NextAuth config (Google provider) — real-mode only, isolated
src/env.js                    # + AUTH_* / NEXT_PUBLIC_CONVEX_URL (optional in test mode)

src/game/react/
├── providers/
│   ├── AuthProvider.tsx      # auth seam: NextAuth-backed (real) | mock (TEST_MODE)
│   └── ConvexClientProvider.tsx  # real ConvexReactClient | in-memory fake (TEST_MODE)
├── auth/
│   ├── useAuth.ts            # the seam hook consumed by UI
│   └── mockBackend.ts        # deterministic in-memory scores backend (TEST_MODE)
├── AuthControls.tsx          # signin/signout/user-name + "sign in to save" prompt
├── Leaderboard.tsx           # leaderboard + leaderboard-row + personal-best
└── GameShell.tsx             # mount auth/leaderboard UI; submit on game over; test hooks

src/app/layout.tsx            # wrap children in AuthProvider + ConvexClientProvider (seamed)
src/game/test-api/install.ts  # + auth.signIn/signOut + endGame(score) on window.__lumines

convex/scores.test.ts         # convex-test: submitScore/topN/personalBest + identity rule
e2e/leaderboard.spec.ts       # Playwright: auth + personal-best + leaderboard (mock-driven)
```

**Structure Decision**: Keep the game subsystem (`src/game/core|engine|render`) untouched.
Add a `convex/` backend and two provider seams so the *same* UI/logic runs against the mock
(eval) and a real backend (later). NextAuth and `ConvexReactClient` real wiring are isolated
in provider modules that the `TEST_MODE` path does not import, so the mocked build/test runs
offline.

## Complexity Tracking

| Decision | Why needed | Simpler alternative rejected because |
|----------|-----------|--------------------------------------|
| Auth + Convex **seams** (not direct SDK use in components) | Spec demands the *same* code run against a deterministic mock (offline eval) AND a real backend, with no rewrite | Using NextAuth/ConvexReactClient directly in components would force network/OAuth in tests (forbidden) and couple UI to the SDK |
| Commit `convex/_generated/` (codegen offline, or hand-author) | App must typecheck/build without running codegen against a cloud deployment | Running `convex dev`/codegen-against-cloud is explicitly forbidden (no provisioning/network) |
