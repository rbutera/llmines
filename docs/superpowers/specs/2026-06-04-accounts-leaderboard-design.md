# Accounts + Convex leaderboard — design

Date: 2026-06-04
Status: self-approved (headless run)
Scope: one feature added to the existing, working LLMines build. No rebuild.

## Goal

Add Google accounts (NextAuth), persistent personal-best high scores, and a
global top-10 leaderboard, backed solely by Convex. Unauthenticated users can
still play but their scores are not saved.

## Hard constraint: build mock-first, never touch a real Convex deployment

The eval harness is offline and black-box. It cannot do a real Google OAuth
round-trip or reach a live Convex backend. Therefore:

- The SAME components + the SAME `convex/scores.ts` functions must run against a
  deterministic **mock** (eval) AND a real Convex deployment (later production
  pass) with no rewrite. The swap happens at a single **provider seam**.
- Do NOT run `convex dev`, `convex deploy`, or `convex login`. `convex/_generated/`
  is **hand-written** (codegen needs a deploy key offline in convex@1.40) and
  **committed**.
- Server functions are tested with **`convex-test`** (in-memory backend running
  the real `schema.ts` + functions), with identity mocked via `t.withIdentity`.
- The live NextAuth↔Convex token bridge (`ConvexProviderWithAuth`) is the only
  piece deferred to the real production pass; in eval the real provider must
  merely compile. Correctness is proven by the mock e2e + convex-test.

(Library reality, verified in this cell: `convex@1.40.0`, `convex-test@0.0.53`,
`next-auth@5.0.0-beta.31` all install; `convex-helpers`' `ConvexReactClientFake`
is not relied on — the seam is a React context, not a named fake client.)

## Architecture

Two backends-of-record for the same three operations, chosen by `TEST_MODE`:

```
                         AccountProvider  (TEST_MODE ? Mock : Real)
                          /                              \
   MockAccountProvider (eval)                   RealAccountProvider (prod)
    - in-memory mock-store.ts                    - NextAuth useSession/signIn/signOut
    - window.__lumines.auth seam                 - ConvexProvider + useQuery/useMutation
            \                                            /
             ── both expose the SAME contexts: useAuth(), useScores() ──
                                   |
                 UI (account bar, personal-best, leaderboard) + GameShell submit effect
```

`convex/scores.ts` holds the authoritative server logic; `mock-store.ts` mirrors
it exactly for eval. They are tested independently (convex-test / vitest) so the
mirror can't drift silently.

### Convex backend (`convex/`)

- `schema.ts` — one table `scores`:
  `{ subject: string, name: string, best: number }`, indexes `by_subject`
  (`["subject"]`) and `by_best` (`["best"]`).
- `scores.ts`:
  - `submitScore({ score })` mutation. Derives the player **server-side** from
    `ctx.auth.getUserIdentity()`. If no identity → no-op (returns `null`) — the
    unauthenticated rule. Else upsert the `by_subject` row: insert if absent,
    else patch `best` only when `score > best` (name refreshed). `subject` is
    NEVER a client argument (the security rule).
  - `topN({ n }?)` query — top `n` (default 10) by `best` desc via the `by_best`
    index, returned as `{ subject, name, best }[]`.
  - `personalBest()` query — current identity's `best`, or `null` if unauthed/none.
- `scores.test.ts` — convex-test: best-only-rises, unauthed no-op, top-10
  ordering, and the server-derived-subject rule (two `withIdentity` subjects
  don't collide; a client-passed id is ignored because there is none).
- `_generated/` — hand-written for convex@1.40 (committed):
  `api.js`/`api.d.ts` (`anyApi` + `ApiFromModules` typing), `server.js`/`.d.ts`
  (`*Generic` re-exports bound to `DataModel`), `dataModel.d.ts`
  (`DataModelFromSchemaDefinition<typeof schema>`).
- `convex/tsconfig.json` — scopes the convex dir to its own compile.

### Account seam (`src/game/account/`)

- `types.ts` — `AuthUser { subject; name; image? }`,
  `AuthApi { user: AuthUser | null; signIn(); signOut() }`,
  `LeaderboardEntry { subject; name; best }`,
  `ScoresApi { personalBest: number | null; leaderboard: LeaderboardEntry[]; submitScore(score) }`.
- `context.tsx` — `AuthContext`, `ScoresContext`, `useAuth()`, `useScores()`.
- `mock-store.ts` — **pure** in-memory store mirroring `scores.ts`
  (`submit(identity, score)`, `topN(n)`, `personalBest(subject)`); unit-tested.
- `MockAccountProvider.tsx` — holds React state over a `mock-store`, exposes the
  contexts, and (TEST_MODE) attaches `window.__lumines.auth.signIn/signOut`.
- `RealAccountProvider.tsx` — `useSession` + `signIn`/`signOut` from
  `next-auth/react`; Convex `useQuery(api.scores.topN/personalBest)` +
  `useMutation(api.scores.submitScore)`; wraps children in `<SessionProvider>` +
  `<ConvexProvider>`. The Convex client is constructed lazily inside the
  component so importing this module in TEST_MODE never touches the network.
- `AccountProvider.tsx` — `TEST_MODE ? MockAccountProvider : RealAccountProvider`.

### NextAuth (`src/server/auth.ts` + route)

- `src/server/auth.ts` — `export const { handlers, auth, signIn, signOut } =
  NextAuth({ providers: [Google] })`.
- `src/app/api/auth/[...nextauth]/route.ts` — `export const { GET, POST } = handlers`.
- `src/env.js` — add **optional** `AUTH_SECRET`, `AUTH_GOOGLE_ID`,
  `AUTH_GOOGLE_SECRET` (server) and `NEXT_PUBLIC_CONVEX_URL` (client) so the app
  builds without them in eval.

### UI

- `src/game/react/AccountBar.tsx` — signed out: a `data-testid="signin"` button
  (calls `useAuth().signIn`). Signed in: `data-testid="user-name"` (+ avatar) and
  a `data-testid="signout"` button.
- `src/game/react/Leaderboard.tsx` — `data-testid="leaderboard"` container with a
  `data-testid="leaderboard-row"` per entry (rank, name, best). Reads
  `useScores().leaderboard`.
- `src/game/react/PersonalBest.tsx` — `data-testid="personal-best"` showing the
  signed-in user's best (and a "sign in to save" prompt when signed out).
- `GameShell.tsx` — render `AccountBar` in the header; `Leaderboard` on the start
  and game-over screens; `PersonalBest` on the game-over screen. Wrap the tree in
  `AccountProvider`. A submit effect: when phase becomes `gameover` with a final
  score, call `useScores().submitScore(score)` (the mock/real no-ops when signed
  out).

### Test seam (TEST_MODE only)

- `window.__lumines.endGame(score)` → `controller.testEndGame(score)` sets the
  real game to game-over with that exact score and emits; GameShell's gameover
  submit effect then runs the real submit path. Added in `install.ts` (controller
  seam), merged into the existing `window.__lumines`.
- `window.__lumines.auth.signIn({ name, subject })` / `signOut()` → drive the
  `MockAccountProvider` state (attached by that provider, merged into the same
  `window.__lumines`). `subject` is the server-derived id the mock keys on.

Both installers MERGE into `window.__lumines` (`{ ...(window.__lumines ?? {}) }`)
so order doesn't matter.

## Data flow (eval / mock)

```
window.__lumines.auth.signIn({name,subject})
   → MockAccountProvider auth state → AccountBar shows user-name/signout,
     ScoresContext.personalBest = mockStore.personalBest(subject)

window.__lumines.endGame(120)
   → controller.testEndGame → GameShell phase=gameover (score 120)
   → submit effect → useScores().submitScore(120)
        → mockStore.submit({subject,name}, 120)  [no-op if signed out]
        → personalBest rises only if 120 > prev; leaderboard re-derived (top 10)
   → PersonalBest + Leaderboard re-render
```

The real path is identical at the component level; only the provider's
`submitScore`/`personalBest`/`leaderboard` are backed by Convex instead of the
mock store.

## Security (review gate)

`submitScore` takes **no** userId argument. The player is derived from
`ctx.auth.getUserIdentity()` server-side; an unauthenticated call is a no-op.
convex-test proves it: two identities (`t.withIdentity({subject:"a"})` /
`{subject:"b"}`) get independent rows, and a call with no identity writes
nothing. The mock store enforces the same (`submit(null, …)` is a no-op).

## Error handling / edge cases

- Unauthed `submitScore` / `endGame` while signed out → no write (returns null).
- Personal best ties (`score === best`) do not update (strictly greater).
- Leaderboard with < 10 rows renders what exists; ordering is `best` desc.
- `MockAccountProvider` resets cleanly on `signOut` (auth → null; personal-best
  display reverts to the prompt; the leaderboard still shows all rows).
- Importing `RealAccountProvider` in TEST_MODE constructs no Convex client
  (lazy), so no network at import/SSR.

## Testing

- **convex-test (`convex/scores.test.ts`, node env):** real schema + functions.
  best-only-rises; unauthed no-op; top-10 desc ordering; per-subject isolation.
- **Unit (`src/game/account/mock-store.test.ts`):** the pure mirror — same four
  behaviours, deterministic.
- **e2e (`e2e/leaderboard.spec.ts`, TEST_MODE):** black-box via the window seam:
  - signed-out start shows `signin`; no write path;
  - `auth.signIn` → `user-name` + `signout` visible, `signin` gone;
  - `endGame(100)` signed in → `personal-best` shows 100; `leaderboard-row`
    reflects it; `endGame(40)` does NOT lower it (best-only); `endGame(250)`
    raises it and reorders the leaderboard;
  - `signOut` then `endGame(999)` → no leaderboard change (unauth rule);
  - the existing `data-testid="score"` and all prior gameplay tests stay green.
- Vitest config gains `convex/**/*.test.ts` to `include` and
  `server.deps.inline: ["convex-test"]`; `import.meta.glob` typed via a global
  `ImportMeta` augmentation (no dependency on `vite/client` under pnpm).
- e2e remains in sync with `install.ts` for the `window.__lumines` type (auth +
  endGame added to both), as in prior features.

## Acceptance mapping

- Sign in/out reflected in UI → `AccountBar` + `useAuth`; e2e drives via the seam.
- Signed-in score persisted; personal best only when beaten → `submitScore`
  (convex-test) + `mock-store` (unit) + e2e.
- Global top-10 renders from Convex and reflects a new high score → `topN` +
  `Leaderboard`; e2e asserts reorder.
- Unauthed plays but is not written → server identity gate + mock no-op; e2e.
- Server-derived user (security) → `getUserIdentity()`, convex-test isolation.
- Dual-mode no-rewrite → the `AccountProvider` seam; hand-written committed
  `_generated`; real provider compiles (token bridge documented as the deferred
  production-pass step).

## Out of scope

Friends, profiles, social, real-time multiplayer, anti-cheat beyond server-side
acceptance, email/password or non-Google providers.
