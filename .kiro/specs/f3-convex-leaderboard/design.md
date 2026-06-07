# Design — F3: Convex + NextAuth + global leaderboard

## Architecture

A single **data/auth seam** lets the SAME UI run against a deterministic mock
(eval) and real Convex + NextAuth (later). UI components only ever call seam
hooks; a provider chosen by `NEXT_PUBLIC_TEST_MODE` decides the backing impl.

```
UI (AuthPanel, Leaderboard, game-over submit)
        │  useAuth() / useLeaderboard() / usePersonalBest() / useSubmitScore()
        ▼
LeaderboardProvider  ──TEST_MODE──▶  MockProvider (in-memory reactive stores)
                     ──normal────▶  RealProvider (ConvexReactClient + NextAuth)
```

The mock mirrors the exact server rules (server-derived identity,
personal-best-only-improves) so eval assertions match the real backend.

## Convex backend (real, committed)

- `convex/schema.ts`: `scores` table `{ subject, name, best }`, indexed
  `by_subject` and `by_best`.
- `convex/scores.ts`:
  - `submitScore({ score })` mutation: `identity = ctx.auth.getUserIdentity()`;
    if none → no write (Req 2.2/2.3). Else upsert by `identity.subject`, updating
    `best` only when `score > best` (Req 2.1). Name comes from the identity.
  - `topN({ n })` query: top N by `best` desc (default 10) → `{ subject, name, score }[]`.
  - `personalBest()` query: identity-scoped best, or `null` when signed out.
- `convex/auth.config.ts`: provider config for real Convex auth (env-driven),
  unused by the mock/eval path.
- `convex/_generated/` hand-authored (api, server, dataModel) so the app
  typechecks with NO codegen/deploy (Req 4.1, 4.4).
- `convex/scores.test.ts`: `convex-test` runs the real functions in-memory with
  `t.withIdentity(...)` — covers personal-best-only-improves, top-N ordering,
  and the signed-out no-write security rule (Req 4.2, 2.3).

## NextAuth (real path)

create-t3-app v5 layer: `src/server/auth/config.ts` (Google provider, JWT
session), `src/server/auth/index.ts` (`NextAuth(...)` → `auth/handlers/signIn/
signOut`), and `src/app/api/auth/[...nextauth]/route.ts`. Client uses
`next-auth/react`. Env vars added as OPTIONAL in `src/env.js` (build uses
`SKIP_ENV_VALIDATION`). None of this is exercised by the mock eval.

## Seam (`src/game/leaderboard/`)

- `types.ts`: `AuthUser { name; subject; image? }`, `ScoreEntry { subject; name; score }`,
  and the context value type `{ user; signIn; signOut; entries; personalBest;
  submitScore }`.
- `mock.ts`: two tiny reactive stores (subscribe/emit):
  - `MockAuth`: holds `user | null`; `signIn(name, subject)`, `signOut()`.
  - `MockLeaderboard`: `Map<subject, entry>`; `submit(subject, name, score)`
    (upsert, improve-only), `top(n)`, `bestOf(subject)`. Singletons for the
    session.
- `context.tsx`: `LeaderboardProvider` + hooks `useAuth`, `useLeaderboard`,
  `usePersonalBest`, `useSubmitScore`. In TEST_MODE it renders `MockProvider`
  (uses `useSyncExternalStore` over the stores) and installs the
  `window.__lumines.auth` + `endGame` test hooks. In normal mode it renders
  `RealProvider`.
- `real.tsx`: `RealProvider` wraps `<SessionProvider>` + a lazily client-side
  `ConvexReactClient` (guarded so prerender never instantiates it); the hooks map
  to `useSession`/`signIn('google')`/`signOut()` and
  `useQuery(api.scores.topN/personalBest)` / `useMutation(api.scores.submitScore)`.

## UI

- `AuthPanel.tsx`: signed-out → `signin` button (+ "sign in to save" prompt);
  signed-in → `user-name` (+ avatar) and `signout` button.
- `Leaderboard.tsx`: `leaderboard` container, a `leaderboard-row` per entry, and
  `personal-best` when signed in.
- Wired into `StartScreen` and `GameOverScreen`.
- Game-over submit: a `useEffect` submits the final score once on game over when
  authenticated (this IS the real game-over path that `endGame` drives).

## Test hooks (`window.__lumines`)

- `controller.testEndGame(score)`: forces `gameOver=true` with the exact score,
  emits → GameShell switches to game-over → submit effect runs.
- In TEST_MODE the `LeaderboardProvider` attaches:
  - `window.__lumines.auth = { signIn({name,subject}), signOut() }` → MockAuth.
  - `window.__lumines.endGame(score)` → `controller.testEndGame(score)` (submit
    happens via the game-over effect using the CURRENT mock identity's subject —
    server-derived, not a client arg). Signed out ⇒ no write.

## Why the build stays green / no regression

- All real-client instantiation is gated to non-test, client-only, so a
  TEST_MODE build/prerender never needs a Convex URL or auth secret.
- `convex/_generated/` is committed; convex files typecheck under the root config.
- Existing tests untouched; new `score` testid (F4) and prior hooks unaffected.

## Verification
- `pnpm test` (adds `convex/scores.test.ts`) green.
- `SKIP_ENV_VALIDATION=1 NEXT_PUBLIC_TEST_MODE=1 pnpm build` passes.
- E2E manual/auto: signIn → user-name; endGame improves personal-best & fills
  leaderboard-row; signed-out endGame writes nothing; signOut restores signin.
