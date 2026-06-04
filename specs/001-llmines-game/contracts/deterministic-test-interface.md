# Contract: Deterministic Test Interface

This contract is exposed only when `NEXT_PUBLIC_TEST_MODE=1`. When the flag is unset, no `window.__lumines` interface is present and normal audio-synced automation remains active.

## Global API

```ts
type Color = 0 | 1;
type Cell = Color | null;
type Grid = Cell[][];
type Piece = [[Color, Color], [Color, Color]];

interface LuminesTestApi {
  seed(n: number): void;
  state(): {
    grid: Grid;
    score: number;
    gameOver: boolean;
    sweepX: number;
  };
  marked(): { row: number; col: number }[];
  spawn(piece: Piece): void;
  tick(): void;
  sweepNow(): void;
  sweepProgress(dtMs: number): void;
}

declare global {
  interface Window {
    __lumines?: LuminesTestApi;
  }
}
```

## API Semantics

- `seed(n)` sets deterministic random generation for subsequent normal piece creation.
- `state().grid` returns a 10-row by 16-column matrix with row 0 at the top and includes both settled cells and the active falling piece.
- `state().score` returns the live score as a number.
- `state().gameOver` returns true only after spawn overflow ends the game.
- `state().sweepX` returns the current sweep position from 0 through 16; fractional values are allowed.
- `marked()` returns the cells currently marked by square detection.
- `spawn(piece)` locks any active falling piece first, then places the supplied 2x2 piece at columns 7-8 and rows 0-1.
- `tick()` advances exactly one gravity step and never auto-spawns after a lock in test mode.
- `sweepNow()` runs one complete sweep immediately, applying column clears, scoring, and gravity.
- `sweepProgress(dtMs)` advances deterministic sweep time by `dtMs`; 250 ms equals one column and 4000 ms equals one full traversal.

## DOM Hooks

The browser UI must expose these stable selectors:

| Selector | Required Element |
|----------|------------------|
| `data-testid="start-button"` | Start screen start control |
| `data-testid="restart"` | Game-over restart control |
| `data-testid="score"` | Live numeric score element; text content is only the number |
| `data-testid="game-over"` | Game-over screen container, present only on game over |
| `data-testid="controls-cheatsheet"` | Visible controls and how-to-play guidance |

## Audio Contract

- A backing audio element or source must point to `/backing-track.mp3`.
- The audio source must have looping enabled.
- Live autoplay is not required for test success.
- In test mode, sweep progression must not depend on audio decode or wall-clock time.

## Timing Contract

- Tempo is 120 BPM.
- One beat is 500 ms.
- One full sweep is 8 beats, or 4000 ms.
- The field is 16 columns wide, so deterministic sweep movement is 250 ms per column.
