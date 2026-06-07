# Tasks — F1: Bottom-row clip/delay fix

- [ ] 1. Clamp the active piece's fall offset when it is resting
  - In `src/game/engine/controller.ts`, import `isResting` from core.
  - In `renderState()`, set `fallProgress` to `0` when `isResting(this.state)`
    is true (in addition to the existing test-mode `0`).
  - _Requirements: 1.1, 1.2, 2.2, 3.1_

- [ ] 2. Lock + spawn immediately when the piece comes to rest
  - In `advance(dtMs)`, after the gravity accumulation loop, if the game is live
    and `isResting(this.state)`, reset `gravityAccumMs` and set state to
    `spawnNext(lockPiece(this.state))`.
  - Import `lockPiece` from core (alongside existing imports).
  - _Requirements: 2.1, 4.1_

- [ ] 3. Verify build and existing tests
  - Run `SKIP_ENV_VALIDATION=1 NEXT_PUBLIC_TEST_MODE=1 pnpm build` — must pass.
  - Run `pnpm test` — core suite must stay green.
  - _Requirements: 4.2_

- [ ] 4. Commit
  - `git add -A && git commit -m "kiro brownfield f1: bottom-row clip fix"`
