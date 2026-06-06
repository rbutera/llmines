# Contract: UI Test Hooks, Window Seam & Provider Seams

## DOM test hooks (standard, non-test-only build)

Stable `data-testid`s rendered in the normal UI:

| testid | Where | Meaning |
|--------|-------|---------|
| `signin` | auth controls (when signed out) | Triggers sign-in (Google / mock) |
| `signout` | auth controls (when signed in) | Triggers sign-out |
| `user-name` | auth controls (when signed in) | The signed-in display name (avatar alongside if provided) |
| `personal-best` | start/game-over | The signed-in player's personal best |
| `leaderboard` | start/game-over | The leaderboard container |
| `leaderboard-row` | inside `leaderboard` | One per entry (≤10), name + score |

A "sign in to save" prompt is shown to signed-out players at game over (no fixed testid
required, but MUST be present).

## `window.__lumines` additions (TEST_MODE only — never shipped)

Gated exactly like the existing game hooks (`seed`/`spawn`/`tick`…). Augments the existing
object:

```ts
window.__lumines.auth = {
  signIn(identity: { name: string; subject: string }): void; // mock-authenticate
  signOut(): void;                                            // back to signed-out
};
window.__lumines.endGame(score: number): void;               // run the REAL game-over path
```

Behaviour:
- `auth.signIn({name, subject})` → seam status `authenticated`; UI shows `user-name`+`signout`;
  the injected Convex fake's `getUserIdentity()` returns this `subject` (server-derived).
- `auth.signOut()` → seam status `unauthenticated`; `signin` available again.
- `endGame(score)` → ends the current game with exactly `score` via the real game-over path:
  signed in → `submitScore({score})` then refresh `personal-best` + `leaderboard`; signed
  out → **no write**, show the prompt. No gameplay RNG involved.

## Provider seams (same code, mock vs real)

- `AuthProvider` / `useAuth()` — `TEST_MODE`: in-memory mock driven by `window.__lumines.auth`.
  Normal: NextAuth (`useSession`/`signIn("google")`/`signOut`). UI consumes `useAuth()` only.
- `ConvexClientProvider` — `TEST_MODE`: deterministic in-memory fake (over `mockBackend.ts`)
  exposing `submitScore`/`topN`/`personalBest`. Normal: real `ConvexReactClient`. Components
  use the same query/mutation calls either way.

## Invariants

- **INV-1 (auth reflected)**: after `auth.signIn`, `user-name` shows the name and `signout`
  is present; after `auth.signOut`, `signin` is present. (FR-001, SC-001)
- **INV-2 (signed-in persistence)**: `endGame(N)` while signed in sets `personal-best` to the
  player's best and adds/updates their `leaderboard-row`; best only improves. (FR-002/003, SC-002)
- **INV-3 (leaderboard reflects)**: after a qualifying `endGame`, `leaderboard` shows ≤10
  rows high→low including the new score. (FR-005/006, SC-003)
- **INV-4 (unauth not saved)**: `endGame(N)` while signed out writes nothing (no
  `leaderboard-row`, no `personal-best`) and shows the sign-in prompt; gameplay unaffected.
  (FR-007, SC-004)
- **INV-5 (server-derived id)**: see `convex-functions.md` INV-A. (FR-004, SC-005)
- **INV-6 (seam parity / offline)**: identical UI + function code runs against the mock
  (tests, offline) and a real backend (later). (FR-010, SC-006)
- **INV-7 (no regression)**: existing testids (`score`, `game-over`, `restart`, controls) and
  features 001–003 behave unchanged. (FR-011, SC-007)

## Verification matrix

| Invariant | Check |
|-----------|-------|
| INV-1 | Playwright: `auth.signIn` → `user-name`/`signout`; `auth.signOut` → `signin` |
| INV-2 | Playwright: `signIn` then `endGame(100)`→PB 100; `endGame(50)`→PB 100; `endGame(150)`→PB 150 |
| INV-3 | Playwright: two identities submit; `leaderboard-row` count ≤10, ordered, includes newest |
| INV-4 | Playwright: signed-out `endGame(999)` → no `leaderboard-row` for them, no `personal-best`, prompt shown |
| INV-5 | Vitest/`convex-test`: identity-mocked attribution + cross-user isolation |
| INV-6 | suite runs offline; provider seam selected by `TEST_MODE` |
| INV-7 | existing `pnpm test` + `pnpm test:e2e` green |
