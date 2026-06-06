# Technical Design Document

## Overview

LLMines is a Lumines clone built as a client-side game within a Next.js App Router application. The game engine runs entirely in the browser using PixiJS 8 for rendering, with game logic separated into pure TypeScript modules. The architecture separates concerns into: game state management, input handling, rendering, audio synchronization, and a test mode API layer.

## Architecture

```
src/
├── app/
│   ├── page.tsx                    # Game page (client component)
│   └── layout.tsx                  # Root layout with <main> landmark
├── game/
│   ├── engine.ts                   # GameEngine class - orchestrates game loop
│   ├── state.ts                    # GameState - pure data + mutations
│   ├── grid.ts                     # Grid operations (lock, gravity, scan)
│   ├── piece.ts                    # Piece type, spawn, rotate, move
│   ├── sweep.ts                    # Sweep bar logic + scoring
│   ├── rng.ts                      # Seeded PRNG (mulberry32)
│   ├── constants.ts                # Grid dimensions, timing constants
│   ├── types.ts                    # Shared types (Cell, Color, Piece, Grid)
│   ├── input.ts                    # Keyboard handler with repeat logic
│   ├── test-api.ts                 # window.__lumines implementation
│   └── renderer/
│       ├── index.ts                # PixiRenderer class
│       ├── grid-view.ts            # Grid cell sprites + animations
│       ├── piece-view.ts           # Active piece rendering
│       ├── sweep-view.ts           # Sweep bar + glow effect
│       └── effects.ts              # Lock flash, dissolve, gravity anims
├── components/
│   ├── Game.tsx                    # Main game component (canvas + HUD)
│   ├── StartScreen.tsx             # Start screen UI
│   ├── GameOverScreen.tsx          # Game over screen UI
│   └── ControlsCheatsheet.tsx      # Reusable controls legend
└── styles/
    └── globals.css                 # Tailwind + game-specific styles
```

## Components and Interfaces

### GameEngine (src/game/engine.ts)

The central orchestrator. Manages the game loop via `requestAnimationFrame`, coordinates state updates, input processing, sweep advancement, and renderer updates.

```typescript
class GameEngine {
  private state: GameState;
  private renderer: PixiRenderer;
  private input: InputHandler;
  private audio: HTMLAudioElement | null;
  private running: boolean;
  private testMode: boolean;
  private lastGravityTick: number;
  private gameStartTime: number;

  start(): void;           // Begin game loop
  stop(): void;            // Halt game loop (game over)
  reset(): void;           // Return to initial state
  tick(): void;            // Single gravity step (test mode)
  update(dt: number): void; // Frame update
}
```

### GameState (src/game/state.ts)

Pure state container. No rendering logic. Holds the grid, active piece, score, marked cells, sweep position, and game-over flag.

```typescript
interface GameState {
  grid: Cell[][];              // 10 rows × 16 cols, settled cells only
  activePiece: ActivePiece | null;
  markedCells: Set<string>;    // "row,col" keys for O(1) lookup
  score: number;
  sweepX: number;              // 0–16 float
  gameOver: boolean;
  sweepCellsDeleted: number;   // accumulator for current sweep pass
  sweepSquaresCleared: number; // accumulator for current sweep pass
}

interface ActivePiece {
  cells: [[Color, Color], [Color, Color]]; // [top-row][left,right]
  row: number;  // top-left row position
  col: number;  // top-left col position
}
```

### Grid Operations (src/game/grid.ts)

Pure functions for grid manipulation:

- `lockPiece(state): void` — writes active piece cells into grid
- `scanSquares(grid): MarkedCell[]` — finds all monochrome 2×2 squares
- `applyGravity(grid, col): boolean` — drops cells down, returns true if anything moved
- `getFullGrid(state): Cell[][]` — merges grid + active piece for state() API
- `canPlace(grid, piece, row, col): boolean` — collision detection

### Piece Operations (src/game/piece.ts)

- `spawnPiece(rng): ActivePiece` — generates random 2×2 at spawn position
- `rotateCW(piece): [[Color,Color],[Color,Color]]` — 90° clockwise rotation
- `moveLeft/moveRight/moveDown(piece): ActivePiece`
- `hardDrop(state): number` — returns final row

### Sweep Logic (src/game/sweep.ts)

- `advanceSweep(state, dtMs): void` — moves sweepX, triggers column clears
- `clearColumn(state, col): void` — deletes marked cells in column, applies gravity
- `completeSweep(state): void` — calculates score at end of traversal
- `sweepNow(state): void` — instant full sweep for test mode

### Input Handler (src/game/input.ts)

Handles keydown/keyup with DAS (Delayed Auto Shift):
- Initial delay: 200ms
- Repeat interval: 133ms
- Soft-drop repeat: 50ms

### Renderer (src/game/renderer/)

PixiJS 8 Application with Container hierarchy:
- Root Container
  - Grid Background (Graphics — grid lines)
  - Cell Layer (Container of Sprites — one per filled cell)
  - Marked Overlay (Container — pulsing highlight on marked cells)
  - Active Piece Layer (Container — 4 sprites for falling piece)
  - Sweep Bar Layer (Graphics + filters for glow)

Animations use PixiJS ticker with lerp-based easing. State changes set animation targets; the renderer interpolates toward them each frame.

### Audio Sync

The sweep position is derived from audio `currentTime`:
```
sweepX = (audio.currentTime % 4.0) / 4.0 * 16
```

Fallback to `performance.now()` elapsed time if audio isn't playing.

### Test Mode (src/game/test-api.ts)

Conditionally instantiated when `process.env.NEXT_PUBLIC_TEST_MODE === '1'`. Exposes `window.__lumines` with direct access to the engine's state and control methods. In test mode, the game loop does NOT auto-advance gravity or sweep — all advancement is manual via `tick()` and `sweepProgress()`.

### React Components

- **Game.tsx**: Client component. Manages screen state (start/playing/gameover). Creates GameEngine on mount, provides canvas ref to PixiJS. Renders HUD overlay (score, controls legend) as DOM elements positioned over the canvas.
- **StartScreen.tsx**: Fade-in/out with Tailwind transitions. Contains start button, controls, instructions.
- **GameOverScreen.tsx**: Fade-in/out overlay. Shows final score and restart button.
- **ControlsCheatsheet.tsx**: Shared between start screen and in-game legend.

## Data Models

### Data Flow

1. User presses key → InputHandler maps to action → Engine processes action → State mutates → Renderer updates
2. Each frame: Engine.update(dt) → advance sweep if playing → check gravity tick → Renderer.render(state)
3. Piece locks → Grid.lockPiece → Grid.scanSquares → mark cells → spawn next piece (or game over)
4. Sweep passes column → clear marked cells → apply gravity → re-scan → mark new cells

### Key Design Decisions

1. **Pure state + renderer separation**: Game logic is testable without PixiJS. The renderer observes state and animates toward it.
2. **Test mode disables auto-advance**: In test mode, gravity and sweep only advance via explicit API calls. This makes tests deterministic.
3. **Score calculated per full sweep**: The score formula applies once per complete traversal, not per-column. This matches the requirement that score = cells × squares for the whole sweep.
4. **Sweep position from audio time**: Ensures perfect sync. Wall-clock fallback ensures gameplay continues if audio fails.
5. **No lock delay**: Pieces lock immediately when they can't fall further. Simpler and matches the spec.
6. **Animations don't block state**: All animations are visual interpolation toward the current true state. The game state is always authoritative.

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Piece Structure Invariant

*For any* spawned piece, it SHALL be a 2×2 array where every cell value is either 0 or 1 (never null or any other value).

**Validates: Requirements 2.2**

### Property 2: Spawn Position Correctness

*For any* game state where a piece is spawned (either at game start, after locking, or via the test API `spawn()`), the active piece's top-left position SHALL be at row 0, column 7 (occupying columns 7–8, rows 0–1).

**Validates: Requirements 2.1, 14.6**

### Property 3: Game Over on Blocked Spawn

*For any* grid state where one or more cells at the spawn position (columns 7–8, rows 0–1) are occupied by the stack, attempting to spawn a new piece SHALL set `gameOver` to true.

**Validates: Requirements 2.3, 9.1**

### Property 4: Gravity Advances Piece by Exactly One Row

*For any* active piece that is not blocked below (neither at row 9 floor nor above occupied stack cells), applying a gravity tick SHALL move the piece's row position down by exactly 1 and leave the column and shape unchanged.

**Validates: Requirements 3.1, 4.3**

### Property 5: Piece Locks When Blocked Below

*For any* active piece where the row immediately below its bottom edge is either occupied or is the floor boundary, applying a gravity tick (or soft drop or hard drop reaching that position) SHALL lock the piece into the grid, setting `activePiece` to null and placing the piece's cells into the grid array.

**Validates: Requirements 3.2, 3.4**

### Property 6: Lateral Movement

*For any* active piece, moving left SHALL decrease its column by 1 if the destination cells are within bounds (col ≥ 0) and unoccupied, otherwise the state SHALL remain unchanged. Symmetrically, moving right SHALL increase its column by 1 if within bounds (col ≤ 14) and unoccupied, otherwise unchanged.

**Validates: Requirements 4.1, 4.2, 4.7**

### Property 7: Clockwise Rotation Transform

*For any* active piece with shape `[[a,b],[c,d]]`, rotation SHALL produce shape `[[c,a],[d,b]]` if the rotated piece at the current position does not overlap occupied cells or exceed bounds, otherwise the state SHALL remain unchanged.

**Validates: Requirements 4.4, 4.7**

### Property 8: Hard Drop Lands at Lowest Valid Row

*For any* active piece, hard-dropping SHALL place the piece at the lowest row where no cell of the piece overlaps an occupied cell or exceeds row 9, and SHALL then lock the piece immediately. The column and shape SHALL remain unchanged from before the drop.

**Validates: Requirements 4.5, 3.4**

### Property 9: Operations No-Op When Inactive

*For any* game state where `activePiece` is null or `gameOver` is true, calling `movePiece`, `rotatePiece`, `gravityTick`, or `hardDrop` SHALL return the state unchanged (same grid, same score, same marked set, same sweepX).

**Validates: Requirements 4.8, 9.2**

### Property 10: Scanner Identifies All Monochrome 2×2 Squares

*For any* grid state, the scanner SHALL mark exactly those cells that belong to at least one aligned 2×2 area where all four cells share the same colour. The distinct square count SHALL equal the number of valid top-left corner positions (row, col) where `grid[row][col] == grid[row][col+1] == grid[row+1][col] == grid[row+1][col+1]` and all are non-null.

**Validates: Requirements 3.3, 5.1, 5.2, 5.3, 7.2**

### Property 11: Marked Cells Persist Until Sweep Reaches Their Column

*For any* game state with marked cells, if the sweep bar has not yet reached a marked cell's column in the current traversal (or has already passed it), those marked cells SHALL remain in the marked set through gravity ticks, piece movements, rotations, and piece locks—only the sweep bar crossing their column SHALL remove them.

**Validates: Requirements 5.5, 6.7, 7.3**

### Property 12: Sweep Position Advances Correctly

*For any* positive dtMs value, advancing the sweep SHALL increase sweepX by `dtMs / 4000 * 16` (modulo 16). Equivalently, a full 4000ms advance SHALL move sweepX by exactly 16 (one full cycle), wrapping back to 0.

**Validates: Requirements 6.1, 6.3, 10.3, 14.9**

### Property 13: Sweep Clears Marked Cells When Crossing Column Boundary

*For any* game state with marked cells in column N, when the sweep bar advances past the integer boundary N+1 (crossing out of column N), all marked cells in column N SHALL be deleted from the grid and removed from the marked set.

**Validates: Requirements 6.2**

### Property 14: Gravity Removes All Gaps Preserving Order

*For any* column after cells are deleted, applying gravity SHALL result in a column where all filled cells are contiguous at the bottom with no null gaps below any filled cell, and the top-to-bottom relative order of the remaining cells SHALL be preserved.

**Validates: Requirements 7.1**

### Property 15: Score Formula

*For any* sweep traversal that deletes N marked cells across D distinct monochrome squares, the score increment SHALL equal N × D. If N = 0, the score SHALL not change.

**Validates: Requirements 8.1, 8.5**

### Property 16: Post-Gravity Marks Deferred to Next Traversal

*For any* marked cells created by a post-gravity re-scan in a column that the sweep bar has already passed in the current traversal, those cells SHALL NOT be included in the current traversal's score calculation and SHALL persist until the sweep bar reaches their column on the next cycle.

**Validates: Requirements 8.4, 7.3**

### Property 17: Reset Produces Initial State

*For any* game state (regardless of score, grid contents, or game-over status), triggering reset SHALL produce a state identical to `createInitialState()`: all grid cells null, no marked cells, score = 0, sweepX = 0, gameOver = false, activePiece = null.

**Validates: Requirements 9.6**

### Property 18: Seeded RNG Determinism

*For any* seed value N, calling `seed(N)` and then generating a sequence of K pieces SHALL always produce the same sequence of pieces. Calling `seed(N)` again and generating K pieces SHALL produce an identical sequence.

**Validates: Requirements 14.3**

## Error Handling

### Audio Autoplay Blocked

- **Trigger**: Browser blocks autoplay due to missing user gesture
- **Behavior**: Suppress the playback error silently; fall back to wall-clock time for sweep position calculation using the same formula `(elapsed % 4.0) / 4.0 * 16`
- **User Impact**: Game plays normally without audio; sweep bar continues in sync with wall-clock time
- **Recovery**: On next user interaction (click/keypress), attempt to resume audio playback

### PixiJS Initialization Failure

- **Trigger**: WebGL/WebGPU context unavailable
- **Behavior**: Display a fallback message in the canvas container indicating the browser does not support the required graphics capabilities
- **User Impact**: Game cannot start; user sees a clear, accessible error message
- **Recovery**: None automatic; user must use a capable browser

### Invalid Test API Calls

- **Trigger**: Calling test API methods with invalid arguments (e.g., `spawn` with non-2×2 array, `seed` with non-number)
- **Behavior**: Throw a descriptive `TypeError` with context about the expected format
- **User Impact**: Test developer sees clear error in test output
- **Recovery**: Fix the test code

### Game State Boundary Guard

- **Trigger**: Any internal state that would place a piece outside grid bounds (defensive)
- **Behavior**: Clamp piece position to valid grid range; log a console warning in development
- **User Impact**: No visible disruption; game continues
- **Recovery**: Automatic via clamping

### Focus Management on Screen Transitions

- **Trigger**: Target focus element not yet in DOM after React state change triggers screen transition
- **Behavior**: Use `requestAnimationFrame` to retry focus; if still unavailable after 2 frames, focus the `<main>` element
- **User Impact**: No visible error; keyboard navigation remains functional
- **Recovery**: Automatic retry with fallback

### Audio Looping Gap

- **Trigger**: Browser audio implementation introduces a tiny gap on loop restart
- **Behavior**: The `loop` property handles this natively. The sweep bar position derives from `currentTime % 4.0`, which is continuous regardless of loop boundaries
- **User Impact**: Minimal/no audible gap (browser-dependent); sweep bar position remains mathematically correct
- **Recovery**: None needed; sweep formula is loop-boundary-agnostic

## Testing Strategy

### Overview

The testing approach uses a dual strategy: **property-based tests** validate universal game logic invariants across thousands of random inputs, while **example-based tests** cover specific scenarios, edge cases, and integration points. Playwright handles end-to-end UI and accessibility testing.

### Property-Based Testing

**Library**: [fast-check](https://github.com/dubzzz/fast-check) with vitest

**Configuration**:
- Minimum 100 iterations per property test
- Each test tagged with comment: `// Feature: llmines, Property {N}: {title}`
- Tests target pure game engine functions only (no PixiJS, no DOM, no timers)

**Properties to implement** (18 properties from Correctness Properties section):

| Property | Target Module | Key Generator |
|----------|--------------|---------------|
| 1: Piece Structure | piece.ts | arbitraryPiece |
| 2: Spawn Position | grid.ts | arbitraryGameState |
| 3: Game Over Blocked | grid.ts | arbitraryBlockedGrid |
| 4: Gravity Down | grid.ts | arbitraryUnblockedPiece |
| 5: Lock When Blocked | grid.ts | arbitraryBlockedPiece |
| 6: Lateral Movement | piece.ts | arbitraryActivePiece + arbitraryGrid |
| 7: Rotation Transform | piece.ts | arbitraryActivePiece |
| 8: Hard Drop | grid.ts | arbitraryActivePiece + arbitraryGrid |
| 9: No-Op Inactive | grid.ts | arbitraryInactiveState |
| 10: Scanner | scanner.ts | arbitraryGrid |
| 11: Marks Persist | sweep.ts | arbitraryMarkedState |
| 12: Sweep Advance | sweep.ts | arbitraryDtMs |
| 13: Sweep Clears | sweep.ts | arbitraryMarkedState + arbitraryDtMs |
| 14: Gravity Gaps | gravity.ts | arbitraryColumn |
| 15: Score Formula | scoring.ts | arbitrarySweepResult |
| 16: Deferred Marks | sweep.ts | arbitraryPostGravityState |
| 17: Reset | grid.ts | arbitraryGameState |
| 18: RNG Determinism | rng.ts | arbitrarySeed |

**Generator strategy**:
- `arbitraryGrid`: 10×16 array with configurable fill density (fc.array of fc.array of fc.oneof(fc.constant(0), fc.constant(1), fc.constant(null)))
- `arbitraryPiece`: 2×2 array of fc.integer({min:0, max:1})
- `arbitraryPosition`: {row: fc.integer({min:0, max:8}), col: fc.integer({min:0, max:14})}
- `arbitraryActivePiece`: piece + valid position ensuring no overlap with grid
- `arbitraryDtMs`: fc.integer({min:1, max:16000})
- `arbitrarySeed`: fc.integer({min:1, max:2**32-1})

### Unit Tests (Example-Based)

**Library**: vitest

**Coverage areas**:
- Rotation: verify `[[0,1],[1,0]]` → `[[1,0],[0,1]]` and all 16 piece permutations
- Boundary: piece at col 0 cannot move left, piece at col 14 cannot move right
- Floor: piece at row 8 (bottom edge at row 9) locks on next tick
- Scoring: concrete scenario (e.g., 8 cells × 3 squares = 24 points)
- Square detection: 2×3 block → 2 distinct squares, 3×3 → 4, 4×4 → 9
- Gravity: specific column `[null, 1, null, 0, null]` → `[null, null, null, 1, 0]`
- Sweep wrapping: sweepX at 15.9 advancing by 250ms wraps correctly
- RNG: seed(42) produces known first 5 pieces

### Integration / E2E Tests

**Library**: Playwright

**Coverage areas**:
- Start screen renders all required `data-testid` elements
- Start button click → game screen transition
- Game over screen shows final score and restart button
- Restart → returns to start screen with fresh state
- Controls legend visible and non-overlapping during gameplay
- Accessibility: Tab navigation through buttons, visible focus indicators, Enter/Space activation
- Screen transitions move focus to correct element
- Audio element: correct `src` and `loop` attributes
- Test mode API: `window.__lumines` present when env set, absent when not
- Full game flow: seed → spawn → move → lock → scan → sweep → score update

### Test Organization

```
src/
├── engine/
│   ├── __tests__/
│   │   ├── grid.property.test.ts       # Properties 3, 4, 5, 9, 17
│   │   ├── piece.property.test.ts      # Properties 1, 2, 6, 7, 8
│   │   ├── scanner.property.test.ts    # Property 10
│   │   ├── sweep.property.test.ts      # Properties 11, 12, 13, 16
│   │   ├── scoring.property.test.ts    # Property 15
│   │   ├── rng.property.test.ts        # Property 18
│   │   ├── grid.test.ts               # Example-based unit tests
│   │   ├── piece.test.ts              # Example-based unit tests
│   │   ├── scanner.test.ts            # Example-based unit tests
│   │   └── sweep.test.ts              # Example-based unit tests
│   └── ...
tests/
├── e2e/
│   ├── start-screen.spec.ts
│   ├── gameplay.spec.ts
│   ├── game-over.spec.ts
│   ├── accessibility.spec.ts
│   └── test-mode.spec.ts
```

### Test Commands

```bash
# Run all unit + property tests (single execution, no watch)
pnpm vitest --run

# Run only property tests
pnpm vitest --run --grep "property"

# Run E2E tests
pnpm exec playwright test

# Type check
pnpm typecheck
```
