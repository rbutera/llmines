# Contract: Render & Test-API Invariants

The feature's only external surface is the deterministic test interface
`window.__lumines` (installed in `NEXT_PUBLIC_TEST_MODE=1`). No method signatures change.
This contract pins the behavioural invariants the fix must satisfy and preserve.

## Test API surface (unchanged)

`window.__lumines` — see `src/game/test-api/install.ts`:

```ts
interface LuminesTestApi {
  seed(n: number): void;
  state(): PublicState;                 // { grid, score, gameOver, sweepX }
  marked(): { row: number; col: number }[];
  spawn(piece: Piece): void;
  tick(): void;                         // one gravity step; never auto-spawns
  sweepNow(): void;
  sweepProgress(dtMs: number): void;
}
```

No additions or removals. `PublicState.grid` is `ROWS × COLS` of `Cell` (`0 | 1 | null`).

## Invariants (must hold after the fix)

### INV-1 — Landed cells are in bounds (FR-003, SC-001, SC-003)
After a piece reaches and locks on the bottom row, every non-null cell in
`state().grid` lies at a valid coordinate `0 ≤ row < ROWS`, `0 ≤ col < COLS`. There is
no representation of a cell below the grid (the model cannot express one), and the
landed block occupies the correct bottom rows for the dropped shape/columns.

### INV-2 — Resting piece does not render below its row (FR-001, FR-002)
For any state where an active piece exists and `isResting(state)` is true, the derived
`RenderState.fallProgress` is exactly `0`. Consequently the renderer draws the active
piece at `row * CELL` (no downward offset), so no active cell is drawn below `BOARD_H`
on the bottom row, and there is no upward "snap" when it subsequently locks.

### INV-3 — Falling piece still interpolates (no regression to smooth fall)
For an active piece that can descend, `fallProgress` continues to range within `(0, 1]`
across a gravity interval (production mode), preserving smooth descent.

### INV-4 — Per-column overhang settle preserved (FR-004, SC-004)
The settled-cell collapse animation (`seedCollapse` → `fallOffsets`, eased in `frame()`)
is unaffected: a multi-column landing where columns rest at different heights still
animates each column easing into place exactly as before.

### INV-5 — No behavioural drift (FR-005)
Score, sweep cadence, marking, game-over, and movement/rotation/drop semantics are
unchanged. The full existing Vitest and Playwright suites pass without modification.

## How each invariant is checked

| Invariant | Check |
|-----------|-------|
| INV-1 | Playwright: spawn + drop/tick to floor, assert bottom-row cells via `state().grid` |
| INV-2 | Vitest: drive `GameController` to a resting-on-floor state, assert `getRenderState().fallProgress === 0` |
| INV-3 | Vitest: mid-fall state asserts `fallProgress > 0` accumulates over time in production mode |
| INV-4 | Existing collapse e2e/unit behaviour stays green; manual visual check in quickstart |
| INV-5 | `pnpm test` + `pnpm test:e2e` (existing suites) remain green |
