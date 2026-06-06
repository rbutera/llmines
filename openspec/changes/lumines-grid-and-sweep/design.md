## Context

`core/sweep.ts` drives the timeline. `advanceSweep(state, columns)` is a pure function of a column count: it advances `sweepX`, and as the leading edge crosses each column it deletes that column's snapshot-marked cells (`deleteColumn`), then at pass end it scores and calls `settle(grid)` once:

```ts
// pass complete: score, settle, wrap, re-snapshot
if (sweepX >= COLS - 1e-9) {
  score += passScore(pass);
  grid = settle(grid);          // <-- batch settle ONLY at pass end (the bug)
  sweepX = 0;
  pass = startPass(grid);
}
```

The marked set + `distinctSquares` are snapshotted at pass start (`startPass`), which is the correct mechanism for the partial-coverage rule (a square forming behind the bar waits for the next pass). The confirmed bug (see [[Lumines Faithfulness Research]] "CONFIRMED IN OUR CODE"): deletion is per-column but gravity is batched at pass-end, so cells above a swept column hang until the bar finishes the whole traversal instead of falling the instant their support is removed.

`core/grid.ts` already has `settle(grid)` that settles every column independently, so extracting a single-column variant is trivial. The controller currently advances the sweep from an accumulated `dtMs` (`advanceSweep(state, dtMs / SWEEP_MS_PER_COL)`), which drifts. `core/detect.ts` already implements the correct overlap-counting 2x2 scan. `COLS=16, ROWS=10` are already pinned in `constants.ts`, and the renderer derives `BOARD_W/H` from `COLS*CELL`/`ROWS*CELL` (no hard-coded 10).

This change fixes the gravity ordering, makes timing beat-derived off the `lumines-audio-clock` `Clock`, and locks the grid + detection behaviour with tests.

## Goals / Non-Goals

**Goals:**
- Cells above a swept column fall the instant the bar clears that column (incremental per-column settle), with no snapshot/settle race.
- Sweep position is a pure function of absolute audio-clock time at one column per eighth-note; 16 columns = two 4/4 bars; frame-rate independent (no accumulator drift).
- 16x10 grid confirmed and immune to any layer re-hardcoding a smaller width; canvas derives from the constants and fits its container.
- Overlap-counting square detection locked in by tests; `distinctSquares` inspectable via the test seam.
- Determinism and the `window.__lumines` seam preserved.

**Non-Goals:**
- Scoring correction (40/square + combo curve) — that is proposal B; this change keeps scoring banked per pass and does not alter the score formula.
- Specials, preview queue, skins — proposal B.
- Actual audio playback — proposal C; this change only consumes the `Clock`.

## Decisions

### Decision 1: Incremental per-column settle with a monotonic left-to-right delete-then-settle ordering

Replace the pass-end batch `settle` with: as the leading edge crosses each new column, **delete that column's snapshot-marked cells, then settle that column (and any column to its left that lost support)**, processed strictly left-to-right and monotonically (a column is processed exactly once, when the edge crosses it). Scoring stays banked per pass.

Pseudocode (replacing the pass-end settle):

```
advanceSweep(state, columns):
  pass = state.sweepPass ?? startPass(grid)   // snapshot markedByCol + distinctSquares
  newLeadingCol = min(COLS, floor(sweepX + columns))
  for col in [pass.processedCols .. newLeadingCol - 1]:
      deleteSnapshotCells(grid, pass, col)     // delete this column's snapshot cells
      settleColumn(grid, col)                  // NEW: this column falls immediately
  pass.processedCols = newLeadingCol
  sweepX += columns
  if sweepX >= COLS:                            // pass complete
      score += passScore(pass)                  // scoring still per-pass (unchanged here)
      sweepX -= COLS
      pass = startPass(grid)                     // re-mark -> cascades next pass
  return {...state, grid, sweepX, sweepPass: pass}
```

**Why this ordering:** deletion uses the **pass-start snapshot** keyed by (row, col). A cell that falls into a coordinate *after* the snapshot was taken is not in the snapshot, so it is never wrongly deleted. Processing each column fully (delete then settle) as the edge crosses it, left-to-right, guarantees a column is never simultaneously settling and pending-deletion in the same frame — the single subtlest correctness trap (§4.2 of the spike). This is the change to build test-first.

**Alternative considered — settle the whole grid every time any column is deleted:** rejected; it is O(COLS) extra work per frame and risks pulling cells down into columns the bar has not yet processed, muddying the snapshot semantics. Per-column settle of only the affected columns is both correct and cheaper.

### Decision 2: Cascades fall out of the snapshot model for free

After an incremental settle, the collapsed grid may form new mono 2x2 squares. Those are **not** added to the current pass's snapshot (partial-coverage rule); they are detected by the next `startPass`. So a cascade square in a column the bar has already crossed correctly waits a full extra pass. No special cascade code is needed — just incremental settle plus re-snapshot at the pass boundary.

### Decision 3: Sweep position from absolute audio-clock time (consume `lumines-audio-clock`)

The controller (the only time-toucher) computes the **absolute** sweep position from absolute clock time, then derives the **delta** to feed the delta-based core:

```
const t = clock.now();                          // seconds (AudioClock or FakeClock)
const beats = (t - trackStartT) * (bpm / 60);
const columns = beats * COLS_PER_BEAT;          // 1 col per eighth-note = 2 cols/beat
const targetSweepX = columns % COLS;
const delta = forwardDelta(state.sweepX, targetSweepX, COLS); // handles wrap
state = advanceSweep(state, delta);
```

Because position is recomputed from `currentTime` every frame, a dropped frame/GC/tab-out never desyncs the bar — the next frame catches up. This replaces the drifting `dtMs` accumulator. The core's `advanceSweep(state, columns)` signature is unchanged (still a pure delta function).

**Alternative considered — keep accumulating dtMs but reset on drift:** rejected; absolute-time-from-clock is simpler and is the only thing that makes "advance 3 eighths in one big step == three small steps" hold (the frame-rate-independence test).

### Decision 4: Confirm 16x10 and guard against re-hardcoding; render-scale fit

`COLS=16, ROWS=10` stay in `constants.ts`. Add a test asserting `state().grid` is 10 rows x 16 cols and that the renderer's board dimensions derive from the constants (no literal `10` width). For display the canvas keeps deriving `BOARD_W=COLS*CELL`, `BOARD_H=ROWS*CELL`; the render-scale fix scales the canvas to fit its container (CSS max-width already present) without changing the logical grid. Width is fixed, not configurable below 16 (the beat-sync math assumes 16).

### Decision 5: Lock overlap-counting detection; expose `distinctSquares` additively

`computeMarked` already scans the whole settled grid for every aligned mono 2x2, counts by top-left corner, and marks the union — already faithful (mono 2x2 -> 1, 2x3 -> 2, 3x3 -> 4, 4x4 -> 9). No logic change; add parametric tests over rectangle dims and expose `distinctSquares` on the public `state()` (additive field) so the eval can assert it. There is no line-clear mechanic and none is added.

## Risks / Trade-offs

- **Incremental-settle vs pending-deletion race** → The single subtlest change. Mitigation: build the left-to-right delete-then-settle ordering test-first; the snapshot is keyed by (row, col) so a post-snapshot fall is never deleted; assert the spike's race scenarios explicitly.
- **Cascade-into-already-passed-column timing** → A cascade square in a column the bar already crossed must wait a full next pass. Mitigation: this is the snapshot model's natural behaviour; add an explicit test asserting it.
- **Beat-sync coupling to the clock landing order** → Proposal A depends on `lumines-audio-clock`. Mitigation: the settle fix is pure-core and can land first against the existing driver; the clock-derived timing layers on once the seam exists.
- **Render-scale change touching the renderer** → Mitigation: scale is CSS/transform only; logical grid and `seedCollapse` per-column diffing are untouched (already diff old vs new grid per column, so per-column-incremental settles animate without renderer logic changes — verify in a regression test).

## Migration Plan

In-place. The settle fix is a localized change to `advanceSweep` plus a `settleColumn` helper; the timing change swaps the controller's sweep-column source from `dtMs` to `clock.now()`. No data/state migration. Rollback = restore the pass-end batch `settle` and the `dtMs` accumulator; the `Clock` seam (proposal 0) is unaffected.

## Open Questions

- **Partial-coverage edge (formed-ahead-of-bar mid-pass):** confirm a square completed mid-pass *ahead* of the bar's current column also waits for the next pass under snapshot-at-pass-start (the spike believes it does; pin with the explicit partial-coverage test matrix). Resolved by choosing snapshot-at-pass-start as canonical; the matrix documents each position (behind/at/ahead).
