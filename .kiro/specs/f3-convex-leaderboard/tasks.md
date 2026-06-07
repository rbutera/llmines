# Tasks — F3: Convex + NextAuth + global leaderboard

- [x] 1. Convex backend (real, committed)
  - `convex/schema.ts` (`scores` table + indexes).
  - `convex/scores.ts` (`submitScore`, `topN`, `personalBest`; server-derived id).
  - `convex/auth.config.ts` (env-driven; unused by mock).
  - Hand-author `convex/_generated/{api.js,api.d.ts,server.js,server.d.ts,dataModel.d.ts}`.
  - _Requirements: 2.1, 2.2, 2.3, 3.1, 4.1, 4.4_

- [x] 2. Convex function tests (convex-test, in-memory)
  - `convex/scores.test.ts`: personal-best-only-improves, top-N ordering,
    signed-out no-write (security), via `t.withIdentity`.
  - _Requirements: 4.2, 2.3_

- [x] 3. NextAuth real layer (compiles; not used by mock)
  - `src/server/auth/config.ts`, `src/server/auth/index.ts`,
    `src/app/api/auth/[...nextauth]/route.ts`; optional env in `src/env.js`.
  - _Requirements: 1.1, 1.2, 1.3, 4.3_

- [x] 4. Data/auth seam
  - `src/game/leaderboard/types.ts`, `mock.ts` (reactive stores),
    `context.tsx` (provider + hooks + TEST_MODE window hooks), `real.tsx`.
  - _Requirements: 4.3, 5.1, 5.2, 5.3_

- [x] 5. UI
  - `AuthPanel.tsx` (`signin`/`signout`/`user-name`), `Leaderboard.tsx`
    (`leaderboard`/`leaderboard-row`/`personal-best`); wire into start +
    game-over; game-over submit effect.
  - _Requirements: 1.1, 1.2, 2.4, 3.1, 3.2, 3.3_

- [x] 6. Controller + test hooks
  - `controller.testEndGame(score)`; provider installs `window.__lumines.auth`
    + `endGame`.
  - _Requirements: 5.3_

- [x] 7. Verify + commit
  - `pnpm test` green; `SKIP_ENV_VALIDATION=1 NEXT_PUBLIC_TEST_MODE=1 pnpm build`.
  - `git add -A && git commit -m "kiro brownfield f3: convex + nextauth + leaderboard"`
  - _Requirements: 6.1_
