# Phase 1 Data Model: LLMines

All types live in `src/game/core/types.ts`; constants in `src/game/constants.ts`. The model is framework-free and serializable so it doubles as the `state()` snapshot.

## Constants (pinned)

| Name | Value | Source |
|------|-------|--------|
| `GRID_COLS` | `16` | grid width |
| `GRID_ROWS` | `10` | grid height |
| `SPAWN_COL` | `7` | piece occupies cols 7–8 (0-indexed) |
| `SPAWN_ROW` | `0` | piece occupies rows 0–1 |
| `COLORS` | `2` | A=0, B=1 |
| `BEAT_MS` | `500` | 120 BPM → 0.5 s/beat |
| `SWEEP_BEATS` | `8` | beats per full traversal |
| `SWEEP_MS_PER_COL` | `250` | `(SWEEP_BEATS × BEAT_MS) / GRID_COLS` = 4000/16 |
| `SWEEP_FULL_MS` | `4000` | full 16-col traversal |
| `GRAVITY_TICK_MS` | tuned (e.g. `700`) | production auto-fall cadence (not asserted) |
| `SOFT_DROP_TICK_MS` | tuned (e.g. `60`) | faster fall while soft-dropping |

## Core types

```ts
type Color = 0 | 1;                 // A = 0, B = 1
type Cell  = Color | null;          // null = empty
type Grid  = Cell[][];              // [row][col]; row 0 = TOP; 10 rows × 16 cols
type Piece = [[Color, Color], [Color, Color]];   // 2×2, [topRow, bottomRow], [left,right]

type Phase = "start" | "playing" | "gameover";

interface ActivePiece {
  cells: Piece;     // current (post-rotation) colours
  row: number;      // top-left row of the 2×2 (origin)
  col: number;      // top-left col of the 2×2 (origin)
}

interface MarkedCell { row: number; col: number; }

interface GameState {
  phase: Phase;
  grid: Grid;                 // SETTLED cells only (no active piece)
  active: ActivePiece | null; // current falling piece (null between lock and next spawn)
  score: number;
  gameOver: boolean;          // mirror of phase === "gameover" for the API
  sweepX: number;             // 0..16 (float); current sweep column position
  rngState: number;           // mulberry32 state; advances per piece
  // per-traversal sweep bookkeeping (internal):
  sweepCleared: MarkedCell[]; // cells deleted so far in the in-progress traversal
}
```

## Derived / projected views

- **`renderGrid(state): Grid`** — settled `grid` with `active` overlaid at its position. This is what `state().grid` returns (settled + active, per the pinned semantics).
- **`marked(state): MarkedCell[]`** — square detection over the **settled** grid (see `marking.ts`); used by `marked()` and to drive sweep deletion + mark animations.

## Entities (spec → model mapping)

| Spec entity | Model |
|-------------|-------|
| Cell | `Cell` (`Color \| null`) |
| Grid / Playfield | `Grid` (settled) + `renderGrid` projection (settled+active) |
| Piece | `ActivePiece` wrapping `Piece` colours + origin row/col |
| Marked region | `marked(state)` → `MarkedCell[]` |
| Timeline bar / Sweep | `sweepX` + sweep functions |
| Score | `state.score` |
| Game session | `GameState` with `phase` lifecycle |

## Validation / rules

- **Spawn (FR-003)**: new `ActivePiece` at `row=0, col=7`. If any of its 4 target cells is already occupied in `grid` → `phase="gameover"`, `gameOver=true`, no piece placed (FR-017, edge: piece blocked at spawn).
- **Move (FR-005/006)**: `col±1` accepted only if all occupied piece cells stay in `[0, GRID_COLS)` and land on empty settled cells; otherwise no-op.
- **Rotate (FR-005/006)**: rotate the 2×2 colour matrix 90° clockwise; accept only if the rotated piece fits in-bounds and clear; otherwise no-op (no wall-kick — assumption).
- **Soft drop (FR-005)**: increases fall cadence; same collision rules.
- **Hard drop (FR-005)**: move down until the next step would collide, then lock.
- **Lock (FR-007)**: write the 4 active cells into `grid`; clear `active`. Production then auto-spawns; test-mode leaves `active=null` (quiescent) until `spawn()`.
- **Mark (FR-008/009)**: cell `(r,c)` is marked iff it belongs to at least one monochrome 2×2 window. `distinctSquares` = number of windows `(r,c)`, `0≤r≤ROWS-2`, `0≤c≤COLS-2`, that are monochrome.
- **Sweep clear (FR-010/011)**: as `sweepX` crosses integer `k`, delete `grid[r][k]` for every currently-marked cell in column `k`; record into `sweepCleared`.
- **Traversal complete**: when `sweepX` wraps past `GRID_COLS`: apply scoring over `sweepCleared`, run gravity, reset `sweepCleared=[]`, `sweepX -= GRID_COLS` (or 0).
- **Score (FR-013)**: `score += clearedCellCount × distinctSquaresClearedThisTraversal`.
- **Gravity (FR-012)**: per column, compact non-null cells downward (stable order) so empty cells rise to the top.

## State transitions

```text
        start ──(start gesture / API spawn)──▶ playing
        playing ──(spawn blocked at top)──▶ gameover
        gameover ──(restart)──▶ playing (fresh empty grid, score 0)
```

Within `playing`, the engine cycles: `spawn → (move/rotate/softdrop)* → lock → [auto-spawn | quiescent] ` while, in parallel, the sweep advances and periodically does `clear → score → gravity`.

## Determinism notes

- `rngState` fully determines the piece colour sequence after `seed(n)`.
- No `Date.now()`/`Math.random()` in core. All time arrives as explicit `dtMs` arguments (`tick` advances one logical gravity step; `sweepProgress(dtMs)` advances `sweepX`).
