# Tasks — F2: New-block hold + deliberate re-press

- [x] 1. Core data model for hold
  - `constants.ts`: add `NEW_BLOCK_HOLD_MS = SECONDS_PER_BEAT * 1000`.
  - `types.ts`: add `hold: { active: boolean; remainingMs: number }` to `GameState`.
  - `grid.ts`: init `hold` in `createGame`.
  - `piece.ts`: `spawnPiece` arms hold on success / clears on game over;
    `lockPiece` clears hold.
  - `index.ts`: add `hold` to `PublicState` and copy it in `publicState`.
  - _Requirements: 1.1, 1.3, 4.1_

- [x] 2. Controller hold + soft-drop engagement
  - Add `softDropEngaged` field and `currentIntervalMs()` helper.
  - `advance()`: pause gravity + decrement hold while held; otherwise step
    gravity at the current interval; preserve F1 immediate-settle.
  - Centralised spawn-and-reset (resets `softDropEngaged`, `gravityAccumMs`).
  - `pressSoftDrop()`, `pressHardDrop()`, `releaseSoftDrop()`, `endHold()`.
  - Route `input("softDrop"/"hardDrop")` through the press methods.
  - `renderState()`: clamp `fallProgress` while held/resting; add `holdActive`.
  - `testSpawn` resets engagement/accumulator.
  - _Requirements: 1.2, 2.1, 2.2, 3.1, 3.2, 3.3, 5.2, 5.3_

- [x] 3. Test seam + keyboard
  - `install.ts`: add `pressSoftDrop()` / `pressHardDrop()` to the API + types.
  - `GameShell.tsx`: gate drop keydowns on `!e.repeat`; add keyup → release.
  - _Requirements: 3.1, 4.2, 4.3_

- [x] 4. Renderer polish
  - `renderer.ts`: stronger pulsing glow on the held piece ("ready to place").
  - _Requirements: 1.1_

- [x] 5. Tests + verification
  - Add core unit tests: spawn arms hold, lock clears hold, publicState exposes hold.
  - Run `pnpm test` (green) and `SKIP_ENV_VALIDATION=1 NEXT_PUBLIC_TEST_MODE=1 pnpm build`.
  - _Requirements: 5.1, 5.2, 5.3_

- [x] 6. Commit
  - `git add -A && git commit -m "kiro brownfield f2: new-block hold"`
