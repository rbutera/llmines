# Contract: Test-Mode Interface (`window.__lumines` + DOM hooks)

This is the **pinned external contract** the shared Playwright harness depends on. It is exposed **only** when `NEXT_PUBLIC_TEST_MODE=1`. In a normal build (flag unset) none of it exists and production behaviour (auto-gravity + music-synced sweep) is unchanged.

## Gating (MUST)

- Hooks present **iff** `process.env.NEXT_PUBLIC_TEST_MODE === "1"` at build time.
- When present, the audio-synced auto-loop is **paused**; the game is driven only through this interface.
- When absent, no `window.__lumines`, no extra behaviour; the `data-testid` attributes that double as production UI (`start-button`, `restart`, `score`, `controls-cheatsheet`) MAY still exist as ordinary UI, but the JS API and `game-over`-driving test affordances do not depend on them.

## JS API: `window.__lumines`

```ts
type Color = 0 | 1;                              // A=0, B=1; empty cell = null
type Cell  = Color | null;
type Grid  = Cell[][];                            // [row][col], row 0 = TOP, 16 cols × 10 rows
type Piece = [[Color, Color], [Color, Color]];    // 2×2, [topRow, bottomRow]

interface LuminesTestApi {
  seed(n: number): void;        // seed RNG → deterministic piece sequence
  state(): {
    grid: Grid;                 // settled stack + active falling piece overlaid
    score: number;
    gameOver: boolean;
    sweepX: number;             // current sweep column position, 0..16 (float ok)
  };
  marked(): { row: number; col: number }[];   // cells currently marked (square detection result)
  spawn(piece: Piece): void;    // place at top-centre now; if one is falling, lock it first
  tick(): void;                 // advance ONE gravity step; NEVER auto-spawns in test mode
  sweepNow(): void;             // run one full timeline sweep immediately + apply scoring
  sweepProgress(dtMs: number): void;  // advance the sweep deterministically by dtMs
}
```

### Method semantics (MUST)

| Method | Behaviour |
|--------|-----------|
| `seed(n)` | Resets RNG state; subsequent auto/`spawn`-less piece generation is deterministic and reproducible. |
| `state()` | Returns a snapshot. `grid` MUST reflect reality = settled stack **with the active falling piece overlaid** at its current position. `sweepX ∈ [0,16]`. |
| `marked()` | Square-detection result over the settled stack: every cell belonging to any monochrome 2×2-or-larger area. |
| `spawn(piece)` | If a piece is mid-fall, **lock it first**, then place `piece` at the top-centre spawn (cols 7–8, rows 0–1). Consecutive calls stack deterministically. If the spawn cells are occupied → game over. |
| `tick()` | Advance exactly one gravity step. **Never auto-spawns.** After a piece locks, the board stays quiescent (`active = null`) until the next `spawn()`. |
| `sweepNow()` | Perform a full instantaneous traversal: clear all currently-marked cells, apply scoring (`cells × distinctSquares`), run gravity collapse; reset `sweepX`. |
| `sweepProgress(dtMs)` | Advance `sweepX` by `dtMs / 250` columns (0.25 s/col). Crossing a column deletes that column's marked cells; completing the traversal applies scoring + gravity. Independent of real time/audio. |

### Pinned timing

- Full 16-column traversal = 8 beats = **4.0 s** at 120 BPM = **0.25 s/column** (`250 ms/col`).
- `sweepProgress(4000)` from `sweepX=0` ⇒ one complete traversal.
- `sweepProgress(250)` advances `sweepX` by exactly 1 column.

### Pinned scoring (for harness assertions)

`score += clearedCells × distinctSquares` per sweep that deletes cells:

| Cleared shape | cells | distinctSquares | score delta |
|---------------|-------|-----------------|-------------|
| one 2×2 | 4 | 1 | 4 |
| 2×3 region | 6 | 2 | 12 |
| 3×3 region | 9 | 4 | 36 |
| three separate 2×2 in one pass | 12 | 3 | 36 |

## DOM hooks (`data-testid`)

| testid | Where | Meaning |
|--------|-------|---------|
| `start-button` | start screen | begins a round on click |
| `restart` | game-over screen | starts a fresh round (empty grid, score 0) |
| `score` | in-game HUD | text content equals the current score number |
| `game-over` | game-over screen only | present **only** when `gameOver` is true |
| `controls-cheatsheet` | start screen + in-game | the visible controls legend |

## Accessibility hooks (MUST)

- Exactly one `<main>` landmark wraps the primary content.
- The game is fully operable by keyboard: `h`/`l` move, `j` soft-drop, `k` rotate, `space` hard-drop (arrow keys optional aliases).

## Non-goals for this contract

- No network/tRPC endpoints are part of this feature's contract (scaffold left unused).
- Live audio autoplay is **not** asserted; only that an audio source exists with `loop` enabled pointing at `/backing-track.mp3`.
