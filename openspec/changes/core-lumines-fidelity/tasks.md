## 1. Wave 1 — Quick wins: gem-through-hard-drop + per-game seed

- [x] 1.1 `src/game/core/piece.ts` `hardDrop`: carry `active.special` through every rebuilt `active`
  in the descent loop (mirror `gravityStep`/`movePiece`). Verify: a forced-gem piece hard-dropped
  lands with its coord in `specials`.
- [x] 1.2 `src/game/core/rng.ts`: add `randomSeed(): number` returning a uint32 from
  `crypto.getRandomValues(new Uint32Array(1))[0]`, fallback `(Date.now() ^ (Math.random()*2**32)) >>> 0`.
  Verify: returns a uint32; two calls differ with overwhelming probability.
- [x] 1.3 `src/game/core/types.ts` + `grid.ts`: add `seed: number` to `GameState`; `createGame(seed)`
  records `seed` and sets `rngState = seedState(seed)`. Keep the explicit-seed signature for tests.
  Verify: `createGame(7).seed === 7`.
- [x] 1.4 `src/game/engine/controller.ts`: constructor uses `opts.seed ?? randomSeed()`;
  `restart(seed?)` uses `seed ?? randomSeed()` (NOT `?? 1`). Re-arm gesture-resume unchanged.
  Verify: `restart()` with no arg yields a non-1 seed; two restarts differ.
- [x] 1.5 `src/game/components/GameShell.tsx` (out-of-core, one line): drop the `restart(1)` arg in
  `handleRestart` so the controller's random default applies. Verify: deployed restart reseeds.
- [x] 1.6 Expose `seed` on `RenderState` (`controller.ts`) and `PublicState` (`core/index.ts`) as a
  pure projection. Verify: render-state + public-state carry the seed.
- [x] 1.7 Run gates: `pnpm test` · `pnpm typecheck` · `pnpm lint` · `pnpm build`. Fix the determinism
  test families that assumed `createGame(1)` identical sequences (pass an explicit seed; add a
  `randomSeed()`-varies test).

## 2. Wave 2 — Sweep rewrite: mark-as-pass + per-group batch erase + deferred gravity

- [x] 2.1 `src/game/core/detect.ts`: factor a reusable predicate `isSquareAt(grid, row, col): boolean`
  (the 2×2 all-same-colour test) used by both `computeMarked` and the new incremental marker. Verify:
  predicate matches `computeMarked` corner counts.
- [x] 2.2 `src/game/core/sweep.ts`: add `markColumn(grid, marks, col)` implementing the pinned rule:
  a square marks ALL FOUR cells when the edge reaches its LEFT (anchor) column `c` (the `c+1` cells
  are marked ahead of the bar); a square whose left column was already passed waits for the next
  pass. Accumulate distinct newly-marked squares into the pass `distinctSquares` (deduped). Verify: a square completed ahead of
  the bar is marked when the edge reaches it (sweep-clear-mechanics scenario 1).
- [x] 2.3 `src/game/core/sweep.ts`: replace `processColumn` with run-tracking — extend the current
  contiguous marked run as marked columns are crossed; on a gap column (no marks) or the right edge,
  call `eraseGroup`. Verify: a contiguous run erases as one batch at the gap/right edge
  (sweep-clear-mechanics group scenarios).
- [x] 2.4 `src/game/core/sweep.ts`: generalise `deleteColumn` → `eraseGroup(grid, pass, runCols,
  specials, record)` that deletes all marked cells across `runCols` in one batch, fires `chainFlood`
  for any special in the batch, then settles the touched columns ONCE via `settleColumnWithMarks`.
  Preserve identity-based marks. Verify: no per-column settle within a group; chain extras score 0.
- [x] 2.5 `src/game/core/sweep.ts` `advanceSweep`: drive the new mark→run→eraseGroup loop as the edge
  crosses columns; bank scoring at the right edge using accumulated `distinctSquares`; keep combo/skin
  advance + board-state bonus at the boundary; wrap and re-init the next pass. Verify: scoring banks
  only at the right edge (challenge-scoring scenario).
- [x] 2.6 `src/game/core/sweep.ts` `runFullSweep`: rewrite to the same group-batch model (mark all
  columns, erase contiguous groups, settle once per group). Verify: `testSweepNow` matches incremental
  result on static boards.
- [x] 2.7 Cascade timing: ensure a cascade under unpassed columns is marked this pass and a cascade
  behind the bar waits the next pass; never re-enter an erased column. Verify: both cascade scenarios.
- [x] 2.8 `src/game/core/types.ts`: update `SweepPass` doc/comments (no longer snapshot-at-start;
  `distinctSquares` accumulates; `marks` set incrementally). Verify: typecheck.
- [x] 2.9 Run gates. Rewrite stale `core.test.ts` + `chain.test.ts` families: snapshot/per-column
  assertions → mark-as-pass + group-batch; mid-pass-ahead-of-bar clears same pass; chain-flood timing
  at group-erase. Verify: `pnpm test` · `typecheck` · `lint` · `build` all green.

## 3. Wave 3 — Faithful scoring + single-sweep ×4 package

- [x] 3.1 `src/game/core/constants.ts`: add `BIG_CLEAR_THRESHOLD = 4`, `BIG_CLEAR_BASE = 640`,
  `BIG_CLEAR_STEP = 160`; REPLACE `COMBO_CURVE = [4,8,12,16]` with `STREAK_CURVE = [1,2,3,4]` (the
  package already contains the ×4; the old curve double-counts). Keep `SQUARE_BASE_SCORE = 40`,
  `COMBO_MIN_SQUARES = 4`.
- [x] 3.2 `src/game/core/scoring.ts` `passScore`: 1-3 squares → `squares*40`; ≥4 → `640 + (squares-4)*160`;
  then multiply the WHOLE package by `qualifies ? STREAK_CURVE[min(combo, 3)] : 1`. Integer-only.
  Verify: 4→640, 5→800, 6→960; FIRST qualifying pass with no streak → 640 (not 2560); 4 squares at
  streak entry ×2 → 1280 (challenge-scoring).
- [x] 3.3 Confirm `nextCombo`, soft-drop bank-on-lock, and `boardStateBonus` (house) are unchanged and
  still gated on a clear-happened pass. Verify: board-state bonus only on clearing passes.
- [x] 3.4 Run gates. Rewrite `scoring.test.ts`: add big-clear package cases, multiplier-on-package
  cases; keep board-state bonus + soft-drop cases. Verify: all gates green.

## 4. Wave 4 — Spawn staging above the field + top-out game over

- [x] 4.1 `src/game/core/constants.ts`: `SPAWN_ROW = -2` (2×2 staged above row 0). Keep `SPAWN_COL`.
- [x] 4.2 `src/game/core/piece.ts`: verify `canPlace` already treats `row < 0` as free and `row >= ROWS`
  as out of bounds; keep. Spawn places the piece above the field without false game over.
- [x] 4.3 `src/game/core/piece.ts` `spawnGeneratedPiece`/`spawnPiece`: change the game-over test from
  "spawn cells occupied" to "the piece cannot enter the field" — i.e. the cells at the top in-field
  rows (rows 0-1 of the spawn columns) are occupied. Verify: piece-lifecycle game-over scenarios.
- [x] 4.3b `src/game/core/piece.ts` `lockPiece`: locking with ANY cell above row 0 sets `gameOver`
  (the lateral-shift-onto-a-full-column top-out; above-field cells must never vanish with play
  continuing). Verify: piece-lifecycle "Lateral shift onto a full column tops out" scenario.
- [x] 4.4 Confirm `pieceCells`/`viewGrid`/`inBounds` handle negative spawn rows (composite only
  `row >= 0`); no renderer/grid blast radius. Verify: above-field cells are not drawn into the board
  grid; the descending piece enters from the top.
- [x] 4.5 Run gates. Rewrite `core.test.ts` spawn/game-over families to the new top-out condition; add
  "top rows usable" + "one free in-field row admits the piece" scenarios. Verify: all gates green.

## 5. Wave 5 — Telemetry: pass-completion + lock events

- [ ] 5.1 `src/game/core/types.ts`: add record-only `lastPassComplete?: { id; squares; comboMultiplier;
  groupErases: { cells: number[]; hadChain: boolean }[] }` and `lastLock?: { id; cause:
  "gravity"|"soft"|"hard" }` to `GameState`. Document as record-only (no gameplay effect).
- [ ] 5.2 `src/game/core/sweep.ts` `eraseGroup`: accumulate `{cells, hadChain}` per batch into the
  pass; at right-edge completion attach the pass's `groupErases`, `squares`, applied
  `comboMultiplier`, and bump `lastPassComplete.id`. Verify: telemetry scenario (4 squares, ×8, two
  groups, one chain).
- [ ] 5.3 `src/game/core/piece.ts`: thread a `cause` into the lock path — `lockPiece(state, cause =
  "gravity")` stamps `lastLock` with a bumped `id`; `gravityStep` → "gravity", `softDrop` → "soft",
  `hardDrop` → "hard". Verify: lock-cause scenarios for all three.
- [ ] 5.4 `src/game/engine/controller.ts` + `src/game/core/index.ts`: pass `lastPassComplete` and
  `lastLock` through `RenderState` and `PublicState` as pure projections. Verify: projections carry
  the events; unchanged `id` never re-fires.
- [ ] 5.5 Run gates. Add telemetry assertions to `core.test.ts`/`scoring.test.ts`; assert
  record-only-ness in `purity.test.ts` (deletion/scoring identical with/without reading the fields).
  Verify: all gates green.

## 6. Wave 6 — Replay record + export seam

- [ ] 6.1 `src/game/engine/controller.ts`: define `ReplayRecord { schemaVersion: 1; seed: number;
  inputs: { t: number; action: InputAction }[] }`; add private `replayInputs` + `replayStartT` (set on
  `start()`). Verify: structure compiles.
- [ ] 6.2 Append `{ t: clock.now()*1000 - replayStartT, action }` on every `input()` /
  `pressSoftDrop()` / `pressHardDrop()`. Verify: inputs recorded in order with non-decreasing `t`
  (run-identity-replay scenario).
- [ ] 6.3 `controller.getReplay(): ReplayRecord` exposing `{ schemaVersion, seed, inputs }`. Verify:
  `getReplay().seed === state.seed`; inputs match the driven sequence.
- [ ] 6.4 Export seam: `window.__lumines.downloadReplay()` (dev seam, same pattern as existing
  `window.__lumines` hooks) serialises `getReplay()` to a Blob and triggers a download; browser-only,
  no-op under SSR/test. Optionally a game-over screen affordance. Verify: seam present and guarded.
- [ ] 6.5 Run gates. Add `src/game/engine/replay.test.ts`: record shape, append order, monotonic
  timestamps, seed captured. Verify: all gates green.

## 7. Wave 7 — Full-suite sweep + final gates

- [ ] 7.1 Audit remaining stale tests (`determinism.test.ts`, `purity.test.ts`, `preview.test.ts`,
  `softdrop.test.ts`, `skins.test.ts`, `controller.test.ts`, `controller.v2.test.ts`) for assumptions
  the new semantics break; rewrite to the new behaviour (not skip). Verify: no skipped/xfail tests.
- [ ] 7.2 Cross-check every spec scenario across the four capabilities has a backing test. Verify: each
  `#### Scenario` maps to an assertion.
- [ ] 7.3 Final full gates: `pnpm test` · `pnpm typecheck` · `pnpm lint` · `pnpm build` all green.
  Verify: clean run, no regressions.
- [ ] 7.4 Smoke the production-start audio probe is unbroken (telemetry is additive): `pnpm
  test:e2e:production-start`. Verify: passes (this change does not touch audio, only emits fields).
