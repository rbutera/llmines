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

- [ ] 4.1 In `src/game/engine/controller.ts`, compute the absolute target sweep position from `clock.now()`: `beats = (t - trackStartT) * (bpm/60)`, `columns = beats * 2` (one col per eighth-note), `targetSweepX = columns % COLS`.
- [ ] 4.2 Derive the forward column delta from `state.sweepX` to `targetSweepX` (handling wrap) and feed it to `advanceSweep` (core signature unchanged).
- [ ] 4.3 Remove the accumulated-`dtMs` sweep source (`advanceSweep(state, dtMs / SWEEP_MS_PER_COL)`); the sweep now derives from absolute clock time only.
- [ ] 4.4 Add an additive beat-sync test helper that advances the (fake) clock and runs one logical frame, WITHOUT removing `sweepNow`/`sweepProgress`.

## 5. Timing tests

- [ ] 5.1 FakeClock at known BPM: advance one eighth-note -> assert `sweepX` advanced exactly one column.
- [ ] 5.2 Advance two full 4/4 bars -> assert exactly one full pass wrapped to the left edge.
- [ ] 5.3 Frame-rate independence: advance 3 eighths in one step vs three steps -> identical final grid and `sweepX`.
- [ ] 5.4 Dropped-frame: a large gap between clock readings -> next frame's position matches absolute time with no cumulative drift.

## 6. Grid 16x10 + render scale

- [ ] 6.1 Confirm `COLS=16, ROWS=10` in `constants.ts`; add a test asserting `state().grid` is 10 rows x 16 cols.
- [ ] 6.2 Confirm the renderer derives `BOARD_W=COLS*CELL`, `BOARD_H=ROWS*CELL`; add a guard test/assertion that no layer uses a literal width other than the constant.
- [ ] 6.3 Apply the render-scale fit (CSS/transform only) so the board fits its container; assert the logical grid and cell coordinates are unchanged.

## 7. Square detection lock-in + test-state extension

- [ ] 7.1 Add parametric tests over rectangle dims asserting `(W-1)(H-1)` distinct squares and the marked-cell union (2x2->1, 2x3->2, 3x3->4, 4x4->9).
- [ ] 7.2 Add a cross-piece square test and a no-line-clear test.
- [ ] 7.3 Expose `distinctSquares` additively on the public `state()` (in `src/game/core/index.ts` `publicState` + `test-api/install.ts` type); assert existing fields (grid/score/gameOver/sweepX) unchanged.

## 8. Render regression

- [ ] 8.1 Confirm `seedCollapse` in `renderer.ts` animates per-column-incremental settles (it diffs old vs new grid per column); add/confirm a regression that an overhang/incremental collapse still animates smoothly.

## 9. Verify

- [ ] 9.1 Run the unit suite — all green (including the previously-red 1.2 test).
- [ ] 9.2 Run lint/typecheck — no new warnings.
- [ ] 9.3 Manually run a normal build: stage a square with a stack above it, watch the stack fall the instant the bar clears its column (not at pass end); confirm the bar tracks the music.
