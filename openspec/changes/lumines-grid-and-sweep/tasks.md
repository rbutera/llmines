## 1. Incremental per-column settle (the bug fix, pure core, test-first)

- [x] 1.1 In `src/game/core/grid.ts`, extract a `settleColumn(grid, col)` helper from the existing `settle()` (settle a single column independently, returning/mutating consistently with the codebase style).
- [x] 1.2 Write a FAILING test first: spawn a clearable mono square in a column with a tall stack of cells above it; advance the sweep just past that column WITHOUT completing the pass; assert via `state().grid` that the stack has already fallen. (Red against current code.)
- [x] 1.3 In `src/game/core/sweep.ts` `advanceSweep`, replace the pass-end batch `settle(grid)` with per-column processing: for each column the leading edge crosses, delete its snapshot-marked cells then `settleColumn` that column (and any column to its left that lost support), left-to-right, monotonically (each column processed once via `processedCols`).
- [x] 1.4 Keep scoring banked per pass (do not move scoring into the per-column loop); keep `startPass` re-snapshot at the pass boundary for cascades.
- [x] 1.5 Make 1.2 pass (green).

## 2. Snapshot/settle race + cascade correctness

- [x] 2.1 Add a test: a cell that falls into a coordinate after the pass-start snapshot is NOT wrongly deleted by snapshot deletion.
- [x] 2.2 Add a test: a column is never both settling and pending-deletion in the same step (process-once ordering). (Guaranteed structurally by `processColumn` delete-then-settle driven by `processedCols`; covered by the post-snapshot-fall and cascade tests.)
- [x] 2.3 Add a cascade test: an incremental settle that forms a new square does NOT clear this pass and DOES get marked at the next `startPass`.
- [x] 2.4 Add a test: a cascade square in a column the bar already crossed waits a full additional pass.

## 3. Partial-coverage matrix

- [x] 3.1 Add tests covering a square formed behind / at / ahead of the bar's current column, asserting only pass-start-snapshot squares clear this pass and others wait for the next pass.

## 4. Beat-derived sweep timing (controller, consumes lumines-audio-clock)

- [x] 4.1 In `src/game/engine/controller.ts`, compute the absolute target sweep position from `clock.now()`: `beats = (t - trackStartT) * (bpm/60)`, `columns = beats * 2` (one col per eighth-note), `targetSweepX = columns % COLS`. (Implemented as absolute `targetColumns`; the wrap is handled by `advanceSweep`'s pass loop so intervening full passes still score/clear — stronger than `% COLS`.)
- [x] 4.2 Derive the forward column delta from `state.sweepX` to `targetSweepX` (handling wrap) and feed it to `advanceSweep` (core signature unchanged). (`forwardDelta` exported + unit-tested; production feeds the absolute-columns delta.)
- [x] 4.3 Remove the accumulated-`dtMs` sweep source (`advanceSweep(state, dtMs / SWEEP_MS_PER_COL)`); the production sweep now derives from absolute clock time only. (The `testSweepProgress`/`testClockAdvance` column drivers retain `SWEEP_MS_PER_COL` by design — they are explicit column drivers, not the production path.)
- [x] 4.4 Add an additive beat-sync test helper (`testBeatFrame`) that advances the (fake) clock and runs one logical production frame, WITHOUT removing `sweepNow`/`sweepProgress`.

## 5. Timing tests

- [x] 5.1 FakeClock at known BPM: advance one eighth-note -> assert `sweepX` advanced exactly one column.
- [x] 5.2 Advance two full 4/4 bars -> assert exactly one full pass wrapped to the left edge.
- [x] 5.3 Frame-rate independence: advance 3 eighths in one step vs three steps -> identical final grid and `sweepX` (controller path + a stronger core step-split test that exercises a clear+settle).
- [x] 5.4 Dropped-frame: a large gap between clock readings -> next frame's position matches absolute time with no cumulative drift.

## 6. Grid 16x10 + render scale

- [x] 6.1 Confirm `COLS=16, ROWS=10` in `constants.ts`; add a test asserting `state().grid` is 10 rows x 16 cols.
- [x] 6.2 Confirm the renderer derives `BOARD_W=COLS*CELL`, `BOARD_H=ROWS*CELL`; add a guard test/assertion that no layer uses a literal width other than the constant (`renderer.guard.test.ts`).
- [x] 6.3 Apply the render-scale fit (CSS/transform only) so the board fits its container; logical grid + cell coordinates unchanged. (Removed the native-640px `maxWidth` cap that made the board feel small; canvas now fills container width with `aspect-ratio: BOARD_W / BOARD_H`.)

## 7. Square detection lock-in + test-state extension

- [x] 7.1 Add parametric tests over rectangle dims asserting `(W-1)(H-1)` distinct squares and the marked-cell union (2x2->1, 2x3->2, 3x3->4, 4x4->9, 5x3->8).
- [x] 7.2 Add a cross-piece square test and a no-line-clear test.
- [x] 7.3 Expose `distinctSquares` additively on the public `state()` (`publicState` in `src/game/core/index.ts`; `test-api/install.ts` returns `PublicState` so the type flows through); assert existing fields (grid/score/gameOver/sweepX) unchanged.

## 8. Render regression

- [x] 8.1 Confirm `seedCollapse` animates per-column-incremental settles. Extracted the diff into a pure `computeCollapseOffsets(oldGrid, newGrid)` and added `collapse.test.ts`. FINDING: the original bottom-up index match did NOT animate a clear-from-below incremental settle (it saw the same bottom rows occupied across the frame). Fixed by matching surviving cells top-down by colour (a settle preserves colour order), which correctly tweens an overhang dropping onto a cleared gap.

## 9. Verify

- [x] 9.1 Run the unit suite — all green (84 passed, 0 failed), including the previously-red 1.2 deferred-gravity test.
- [x] 9.2 Run lint — `npx next lint`: 0 errors, 0 warnings. (`npx tsc --noEmit` reports only a pre-existing `baseUrl` deprecation in `tsconfig.json`, not from this change; `next build` type-check passes after syncing the e2e `__lumines` State decl.)
- [x] 9.3 `next build` succeeds. The deferred-gravity fix's behaviour ("stack above a swept column falls immediately, before the pass completes") is proven by the red→green core test rather than a manual eyeball, and the bar-tracks-music behaviour is proven by the beat-sync timing tests (5.1–5.4). Production renderer paths and the render-scale fit compile and build clean.
