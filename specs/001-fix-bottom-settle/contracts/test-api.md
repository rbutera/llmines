# Contract: LLMines Browser Test API

## Scope

This feature relies on the existing deterministic browser test API exposed in test mode. The contract is unchanged; this document defines the expected observations for bottom-row landing validation.

## Interface

```ts
window.__lumines = {
  seed(n: number): void;
  state(): {
    grid: (0 | 1 | null)[][];
    score: number;
    gameOver: boolean;
    sweepX: number;
  };
  marked(): { row: number; col: number }[];
  spawn(piece: [[0 | 1, 0 | 1], [0 | 1, 0 | 1]]): void;
  tick(): void;
  sweepNow(): void;
  sweepProgress(dtMs: number): void;
};
```

## Bottom-row Landing Expectations

### Hard Drop

1. Start the game in test mode.
2. Spawn a 2x2 piece.
3. Trigger a hard drop through the same input path used by players.
4. `state().grid` contains the piece on valid bottom rows and columns.
5. `state().grid` has no representation of cells outside the grid.
6. The canvas never displays any cell below the visible playfield during the transition.

### Natural Gravity

1. Start the game in test mode.
2. Spawn a 2x2 piece.
3. Advance deterministic ticks until the piece locks.
4. `state().grid` contains the piece on valid bottom rows and columns.
5. The final active-to-landed transition has no visible below-grid frame.

### Overhang Regression

1. Build or arrange an uneven stack near the bottom rows.
2. Spawn a piece that settles with uneven support.
3. Advance until it locks.
4. `state().grid` remains valid.
5. The visible per-column settle remains smooth and contained inside the playfield.

## Non-goals

- No new public test API methods are required for this feature.
- No production exposure of the test API is required.
- No changes to scoring, sweep, or marked-cell contracts are required.
