# Quickstart: Validate Accounts, High Scores & Leaderboard (offline / mock)

Run/verify guide. Function rules live in `contracts/convex-functions.md`; UI/seam hooks in
`contracts/ui-and-test-hooks.md`; schema in `data-model.md`. **Everything here is offline —
do NOT run `convex dev`/`deploy`/`login`.**

## Prerequisites

- `pnpm install` (and, when reachable, `pnpm add convex next-auth` + `pnpm add -D convex-test`;
  see research.md Decision 7 fallback if the registry is unreachable).
- `convex/_generated/` is committed (codegen offline or hand-authored).
- Feature implemented: `convex/scores.ts`, the auth + Convex seams, auth/leaderboard UI,
  and the `window.__lumines.auth`/`endGame` test hooks.

## 1. Convex function tests (server rules + security)

```bash
pnpm test   # includes convex/scores.test.ts via convex-test (in-memory, mocked identity)
```

**Expected**: `submitScore` attributes to the mocked `subject` (never a client arg);
personal best only improves; a second identity gets its own row and cannot overwrite the
first; unauthenticated submit writes nothing; `topN` returns ≤10 ordered high→low;
`personalBest` reflects only the caller (INV-A…D / SC-002/SC-005).

## 2. UI + flow e2e (mock-driven, no OAuth/network)

```bash
pnpm test:e2e   # includes e2e/leaderboard.spec.ts
```

Driven via the TEST_MODE hooks, e.g.:

```js
__lumines.auth.signIn({ name: "Ada", subject: "u-ada" }); // user-name shows "Ada", signout present
__lumines.endGame(100);   // PB -> 100; leaderboard-row for Ada @100
__lumines.endGame(50);    // PB stays 100 (not beaten)
__lumines.endGame(150);   // PB -> 150; leaderboard reflects 150
__lumines.auth.signOut(); // signin available again
__lumines.endGame(999);   // signed out: NOT saved, no leaderboard-row, "sign in to save" prompt
```

**Expected**: INV-1…INV-4 hold (auth reflected; persistence + PB-only-improves; leaderboard
reflects; unauth not saved).

## 3. Typecheck / lint / no-regression

```bash
pnpm check        # lint + tsc --noEmit (passes thanks to committed convex/_generated)
pnpm test         # + existing core/controller/score-effects suites
pnpm test:e2e     # + existing game e2e (001/002/003) still green
```

## 4. Real backend (LATER — top-2 cells only; not in this run)

Out of scope here: provisioning Convex + Google OAuth and swapping the seams to the real
`ConvexReactClient` + NextAuth. The seam guarantees no code rewrite — only env + provider
selection. Do not perform during this work.

## Pass criteria

- [ ] `pnpm test`, `pnpm test:e2e`, `pnpm check` green — fully offline.
- [ ] Sign in/out reflected in the UI; personal best persists and only improves.
- [ ] Global top-10 leaderboard renders and reflects a new qualifying score.
- [ ] Unauthenticated play works but is never saved (prompted to sign in).
- [ ] `submitScore` derives the user server-side (identity-mocked test proves it).
- [ ] No regression to existing gameplay or features 001/002/003.
