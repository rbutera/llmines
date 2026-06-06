## Why

The timeline sweep is the strategic and aesthetic core of Lumines, and our build has a confirmed correctness bug in it. In `core/sweep.ts`, `advanceSweep` deletes a column's marked cells as the bar crosses it, but it only calls `settle(grid)` when the **whole pass completes** (`if (sweepX >= COLS - 1e-9)`). So cleared cells vanish column-by-column, yet the stack above a swept column does not fall until the bar reaches the far edge. The real game drops the supported stack the instant its support is swept — that instant fall is what makes "stage squares, let the bar harvest them" feel right. Separately, the sweep is driven off an accumulated wall-clock delta rather than musical time, so clears never land on the beat. This change fixes the deferred-gravity bug with an incremental per-column settle, makes the sweep a pure function of audio-clock time (one column per eighth-note, 16 columns = two 4/4 bars), and locks in the confirmed 16x10 grid and overlap-counting square detection.

## What Changes

- **Incremental settle (the bug fix):** replace the pass-end `settle(grid)` with a per-column settle that runs the instant the bar clears each column, so cells above a swept column begin falling immediately rather than at pass-end. Process columns left-to-right, monotonically: for each column the leading edge crosses, delete its snapshot-marked cells, then settle that column (and any column to its left that lost support), so deletion and settle never race within a frame.
- **Snapshot race fix:** keep the existing snapshot-at-pass-start semantics for the partial-coverage rule, and make incremental settle safe against it — a cell that falls into a coordinate after the snapshot is taken is never wrongly deleted, and a column is never both settling and pending-deletion in the same step.
- **Cascades:** marks formed by an incremental settle are NOT added to the current pass's snapshot; they are picked up by the next `startPass`, so cascades are automatic and correct.
- **Beat-derived timing:** the controller derives sweep position from absolute audio-clock time (consuming `lumines-audio-clock`'s `Clock`): position = a pure function of `clock.now()`, BPM, and `COLS`, at one column per eighth-note, so a full 16-column pass takes exactly two 4/4 bars and a dropped frame/GC pause/tab-out cannot desync the bar from the music. The core stays a pure delta function; the controller computes the absolute target and feeds the (delta-based) core.
- **Grid 16x10 confirmed + render scale:** confirm `COLS=16, ROWS=10` and that no layer hard-codes a width of 10; the canvas derives from `COLS*ROWS` (render-scale fix so the board fits its container while staying derived from the constants).
- **Overlap-counting clears confirmed:** lock in (via tests) the existing whole-grid 2x2 scan that counts each square by its top-left corner (mono `WxH` -> `(W-1)(H-1)` squares) with no line-clear mechanic; expose `distinctSquares` on the test state so it is inspectable.
- Preserve the `window.__lumines` test seam and determinism as explicit requirements; add a beat-sync test driver helper additively.

## Capabilities

### New Capabilities
- `timeline-sweep`: The left-to-right timeline that advances at one column per eighth-note as a pure function of audio-clock time, clears squares only on the pass that fully covers them, and settles gravity incrementally per column the instant the bar clears it (the deferred-gravity bug fix), with automatic cascades on the next pass.
- `playfield-grid`: A fixed 16-column x 10-row playfield whose cell and canvas dimensions derive solely from the column/row constants, with no layer hard-coding a smaller width.
- `square-detection`: Whole-settled-grid 2x2 same-colour square detection counted by top-left corner (overlapping windows; mono `WxH` -> `(W-1)(H-1)` squares), with no line-clear mechanic, exposed for inspection via the test seam.

### Modified Capabilities
<!-- None — openspec/specs/ is empty; these are first-captured capabilities. -->

## Impact

- **Code**: `src/game/core/sweep.ts` (incremental per-column delete-then-settle in `advanceSweep`; remove the pass-end batch `settle`); a per-column settle variant extracted from `core/grid.ts` `settle()`; `src/game/engine/controller.ts` (derive sweep columns from `clock.now()` + BPM instead of the accumulated `dtMs`); `src/game/core/index.ts` + `test-api/install.ts` (expose `distinctSquares` on `state()`, additive); `src/game/render/renderer.ts` (confirm `seedCollapse` animates per-column-incremental settles; render-scale fit).
- **Depends on**: `lumines-audio-clock` (the `Clock` seam) for beat-derived timing. The pure-core settle fix can land first against the current driver, then the clock-derived timing layers on.
- **Tests**: red/green test for the deferred-gravity fix (clearable square in a column with a tall stack above; advance just past that column; assert the stack has already fallen without completing the pass); frame-rate-independence test (advance 3 eighths in one step vs three steps -> identical grid); partial-coverage matrix; overlap-counting parametric tests.
- **No impact** on: the `core/**` purity boundary, RNG/determinism, the per-pass scoring boundary (scoring stays banked per pass; only gravity becomes per-column — scoring correction itself is proposal B), or the `window.__lumines` method set (only `state()` grows additively).
