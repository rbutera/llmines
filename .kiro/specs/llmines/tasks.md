# Implementation Plan: LLMines

## Overview

Implement a browser-based Lumines clone using Next.js App Router + TypeScript + PixiJS. The game features a 16x10 grid, 2x2 falling pieces with vim-style controls, music-synced sweep bar clearing, and a deterministic test mode API. Implementation proceeds from core data types through game logic, rendering, UI components, and test coverage.

## Tasks

- [x] 1. Set up project structure and core types
  - [x] 1.1 Create core type definitions and constants
    - Create `src/game/types.ts` with Color (0|1), Cell (Color|null), Grid (Cell[][]), PieceDef ([[Color,Color],[Color,Color]]), ActivePiece, MarkedCell, GameState, StateSnapshot, and LuminesTestApi interfaces
    - Create `src/game/constants.ts` with GRID_COLS=16, GRID_ROWS=10, SPAWN_COL=7, SPAWN_ROW=0, GRAVITY_INTERVAL=800, SWEEP_PERIOD=4000, MS_PER_COLUMN=250, SOFT_DROP_INTERVAL=50, DAS_DELAY=233, DAS_REPEAT=133, CELL_SIZE=40
    - Declare `window.__lumines` on global Window interface
    - _Requirements: 1.1, 2.1, 2.2, 3.1, 6.1, 14.1_

  - [x] 1.2 Implement seeded PRNG module
    - Create `src/game/rng.ts` with mulberry32 algorithm
    - Export `createRng(seed: number): () => number` returning values in [0,1)
    - Ensure deterministic output for a given seed
    - _Requirements: 2.2, 14.3_

  - [ ]* 1.3 Write property test for RNG determinism
    - **Property 18: Seeded RNG Determinism**
    - **Validates: Requirements 14.3**

- [x] 2. Implement game state and grid operations
  - [x] 2.1 Create game state module
    - Create `src/game/state.ts` with `createEmptyGrid()` and `createInitialState()` functions
    - Initial state: all cells null, no marked cells, score=0, sweepX=0, gameOver=false, activePiece=null
    - _Requirements: 9.6, 14.4_

  - [x] 2.2 Implement grid operations
    - Create `src/game/grid.ts` with `lockPiece(state)`, `scanSquares(grid)`, `applyGravityColumn(grid, col)`, `applyGravityAll(grid)`, `getFullGrid(state)`, `markSquares(state)`, `countDistinctSquaresInMarked(grid, markedCells)`
    - `scanSquares` returns markedKeys Set and distinctCount by scanning all valid 2x2 top-left positions
    - `applyGravityColumn` compacts cells downward preserving order
    - `getFullGrid` overlays active piece onto grid copy
    - _Requirements: 3.3, 5.1, 5.2, 5.3, 7.1, 7.2, 14.4_

  - [x] 2.3 Implement piece operations
    - Create `src/game/piece.ts` with `spawnPiece(rng)`, `spawnSpecificPiece(piece)`, `canPlace(grid, cells, row, col)`, `rotateCW(cells)`, `moveLeft(grid, piece)`, `moveRight(grid, piece)`, `moveDown(grid, piece)`, `hardDrop(grid, piece)`, `tryRotate(grid, piece)`
    - Rotation transform: [[a,b],[c,d]] → [[c,a],[d,b]]
    - All movement functions return new piece or null if blocked
    - _Requirements: 2.1, 2.2, 3.2, 3.4, 4.1, 4.2, 4.4, 4.5, 4.7_

  - [ ] 2.4 Write property tests for piece operations
    - **Property 1: Piece Structure Invariant**
    - **Property 2: Spawn Position Correctness**
    - **Property 6: Lateral Movement**
    - **Property 7: Clockwise Rotation Transform**
    - **Property 8: Hard Drop Lands at Lowest Valid Row**
    - **Validates: Requirements 2.1, 2.2, 4.1, 4.2, 4.4, 4.5, 4.7, 14.6**

  - [ ] 2.5 Write property tests for grid operations
    - **Property 3: Game Over on Blocked Spawn**
    - **Property 4: Gravity Advances Piece by Exactly One Row**
    - **Property 5: Piece Locks When Blocked Below**
    - **Property 9: Operations No-Op When Inactive**
    - **Property 10: Scanner Identifies All Monochrome 2×2 Squares**
    - **Property 14: Gravity Removes All Gaps Preserving Order**
    - **Property 17: Reset Produces Initial State**
    - **Validates: Requirements 2.3, 3.1, 3.2, 3.3, 3.4, 4.8, 5.1, 5.2, 5.3, 7.1, 7.2, 9.1, 9.6**

- [ ] 3. Implement sweep logic and scoring
  - [x] 3.1 Create sweep module
    - Create `src/game/sweep.ts` with `advanceSweep(state, dtMs)`, `clearColumn(state, col)`, `completeSweep(state)`, `sweepNow(state)`
    - `advanceSweep` advances sweepX by dtMs/4000*16, clears columns as bar passes, handles wrap-around and scoring on full traversal
    - `clearColumn` deletes marked cells in that column, applies gravity, re-scans for new squares
    - `completeSweep` applies scoring formula: cells_deleted × distinct_squares
    - `sweepNow` performs instant full sweep (test mode): deletes all marked, applies gravity, re-scans, resets sweep position
    - _Requirements: 6.1, 6.2, 6.3, 6.7, 7.1, 7.2, 7.3, 7.4, 8.1, 8.3, 8.4, 8.5_

  - [ ] 3.2 Write property tests for sweep and scoring
    - **Property 11: Marked Cells Persist Until Sweep Reaches Their Column**
    - **Property 12: Sweep Position Advances Correctly**
    - **Property 13: Sweep Clears Marked Cells When Crossing Column Boundary**
    - **Property 15: Score Formula**
    - **Property 16: Post-Gravity Marks Deferred to Next Traversal**
    - **Validates: Requirements 5.5, 6.1, 6.2, 6.3, 6.7, 7.3, 8.1, 8.4, 8.5, 10.3, 14.9**

- [x] 4. Checkpoint - Core game logic
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Implement input handler
  - [x] 5.1 Create keyboard input handler
    - Create `src/game/input.ts` with InputHandler class
    - Map keys: h=left, l=right, j=softDrop, k=rotate, space=hardDrop, plus arrow key equivalents (ArrowLeft, ArrowRight, ArrowDown, ArrowUp)
    - Implement DAS for lateral keys: initial delay 233ms, repeat at 133ms
    - Implement soft-drop repeat at 50ms interval (no initial delay)
    - Hard drop and rotate fire once only (no repeat)
    - Ignore all inputs when `setEnabled(false)` is called
    - Provide attach()/detach() to add/remove event listeners
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9_

- [ ] 6. Implement game engine
  - [x] 6.1 Create GameEngine orchestrator class
    - Create `src/game/engine.ts` with GameEngine class
    - Manages game loop via requestAnimationFrame
    - Integrates gravity tick at 800ms intervals
    - Integrates sweep advancement from audio time or wall-clock fallback
    - Connects InputHandler actions to piece operations
    - Handles piece spawning after lock, game over detection
    - Emits typed events: pieceMoved, pieceLocked, cellsCleared, gravityApplied, gameOver, scoreChanged
    - In test mode: disables auto-gravity and auto-sweep; tick() does NOT auto-spawn
    - Provides setAudio(), start(), stop(), reset(), seed(), getState(), getMarked(), spawnPiece(), tick(), sweepNow(), sweepProgress() methods
    - _Requirements: 2.1, 3.1, 3.2, 3.3, 3.4, 4.8, 6.4, 9.1, 9.2, 10.3, 10.4, 14.7, 14.8, 14.9_

  - [ ] 6.2 Write unit tests for game engine
    - Test gravity tick advances piece
    - Test locking triggers scan and spawn
    - Test game over when spawn blocked
    - Test event emissions
    - _Requirements: 2.1, 3.1, 3.2, 9.1_

- [x] 7. Implement PixiJS renderer
  - [x] 7.1 Create renderer core and grid view
    - Create `src/game/renderer/index.ts` with PixiRenderer class using PixiJS 8 Application
    - Create `src/game/renderer/grid-view.ts` rendering 16x10 grid background with distinct cell colours per type
    - Render filled cells with solid fill (Colour_A vs Colour_B clearly distinguishable hues)
    - Render empty cells with background-only fill
    - Render marked cells with pulsing overlay visual distinction
    - Canvas sized so each cell is CELL_SIZE square and full grid visible without scrolling
    - Canvas container element has `data-testid="grid"`
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 5.4_

  - [x] 7.2 Create piece view with movement animation
    - Create `src/game/renderer/piece-view.ts` for active piece rendering
    - Implement position interpolation: eased transition from previous to new position (≤100ms)
    - Use lerp-based animation targeting current state positions each frame
    - _Requirements: 1.5, 15.1_

  - [x] 7.3 Create sweep bar view with glow effect
    - Create `src/game/renderer/sweep-view.ts` rendering sweep bar as vertical line ≥1px wide
    - Visually distinct from grid lines
    - Update horizontal position every animation frame based on sweepX
    - Render glow/highlight effect extending ≥1 column width around bar position
    - _Requirements: 6.5, 15.5_

  - [x] 7.4 Create effects system
    - Create `src/game/renderer/effects.ts` with EffectsManager class
    - Lock effect: brief flash/scale pulse on locked piece (80-200ms)
    - Deletion effect: dissolve/particle when sweep passes marked cells (≤250ms)
    - Gravity settle animation: eased fall per row (≤150ms per row traveled)
    - All animations are purely visual and do not block game state or input
    - _Requirements: 15.2, 15.3, 15.4, 15.6_

- [x] 8. Checkpoint - Renderer integration
  - Ensure all tests pass, ask the user if questions arise.

- [x] 9. Implement React components
  - [x] 9.1 Create StartScreen component
    - Create `src/components/StartScreen.tsx`
    - Display game title, start button (`data-testid="start-button"`), controls cheatsheet (`data-testid="controls-cheatsheet"`), instructions (`data-testid="instructions"`)
    - Instructions state: manipulate falling 2x2 blocks to form same-colour 2x2 squares, cleared by sweep bar to earn points
    - Show all key mappings including arrow-key equivalents
    - Centered layout, single-column vertical stack, ≥16px spacing between elements
    - Single font family, ≤3 distinct font sizes
    - Fade-in/out transitions (200-500ms)
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 16.1, 16.3, 16.4, 16.5_

  - [x] 9.2 Create GameOverScreen component
    - Create `src/components/GameOverScreen.tsx`
    - Element with `data-testid="game-over"`
    - Final score in `data-testid="final-score"`
    - Restart button with `data-testid="restart"`
    - Centered layout, single-column vertical stack, ≥16px spacing
    - Fade-in/out transitions (200-500ms)
    - _Requirements: 9.3, 9.4, 9.5, 9.6, 16.2, 16.3, 16.4, 16.5_

  - [x] 9.3 Create ControlsCheatsheet component
    - Create `src/components/ControlsCheatsheet.tsx`
    - Shows all 5 key mappings: h=left, l=right, j=soft-drop, k=rotate, space=hard-drop
    - Shared between start screen and in-game legend
    - In-game version has `data-testid="controls-cheatsheet"`, compact layout
    - _Requirements: 12.1, 12.2, 12.3_

  - [x] 9.4 Create Game component with screen management
    - Create `src/components/Game.tsx` as client component
    - Manage screen states: start → playing → gameover
    - Create GameEngine on start, provide canvas ref to PixiJS
    - Score display with `data-testid="score"` starting at 0
    - Persistent controls legend during gameplay (not overlapping grid)
    - Audio element with src="/backing-track.mp3" and loop=true
    - All screens within `<main>` landmark element
    - Handle autoplay errors silently, suppress error display
    - On game over: stop engine, stop audio, transition to game over screen
    - On restart: reset state, return to start screen
    - _Requirements: 1.4, 8.2, 8.3, 9.2, 9.3, 9.6, 10.1, 10.2, 10.5, 10.6, 12.1, 12.2, 12.3, 13.1_

- [x] 10. Implement audio sync and sweep integration
  - [x] 10.1 Integrate audio-driven sweep position
    - In GameEngine.update, derive sweep position from audio.currentTime: `sweepX = (currentTime % 4.0) / 4.0 * 16`
    - Fallback to wall-clock elapsed time when audio is not playing
    - Maintain ≤±20ms drift between sweep bar and beat-aligned position
    - Pause sweep when audio paused; resume from same position
    - _Requirements: 6.1, 6.4, 6.6, 10.3, 10.4_

- [ ] 11. Implement test mode API
  - [x] 11.1 Create test mode API module
    - Create `src/game/test-api.ts` with `initTestApi(engine)` and `removeTestApi()` functions
    - Conditionally expose `window.__lumines` only when `NEXT_PUBLIC_TEST_MODE=1`
    - Implement: seed(n), state(), marked(), spawn(piece), tick(), sweepNow(), sweepProgress(dtMs)
    - In test mode: game loop does NOT auto-advance gravity or sweep
    - tick() advances gravity by one step, does NOT auto-spawn on lock
    - spawn(piece) locks active piece first, then places specified piece at spawn position
    - sweepProgress(dtMs) advances sweep bar by equivalent of dtMs milliseconds
    - Validate arguments: throw TypeError for invalid inputs
    - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.5, 14.6, 14.7, 14.8, 14.9_

  - [ ] 11.2 Write unit tests for test mode API
    - Test window.__lumines presence/absence based on env
    - Test seed produces deterministic sequences
    - Test state() returns correct grid with active piece overlaid
    - Test spawn → tick → lock flow
    - Test sweepNow clears all marked and applies scoring
    - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.5, 14.6, 14.7, 14.8, 14.9_

- [x] 12. Implement accessibility features
  - [x] 12.1 Add accessibility and focus management
    - Ensure all game screens render within single `<main>` landmark
    - All interactive elements (buttons) focusable via Tab, visible focus indicator, activatable via Enter and Space
    - On screen transitions: move focus to first interactive element or primary content container
    - Use requestAnimationFrame retry for focus if element not in DOM, fallback to `<main>` after 2 frames
    - _Requirements: 13.1, 13.2, 13.3, 13.4_

- [x] 13. Checkpoint - Full integration
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 14. End-to-end tests
  - [ ] 14.1 Write Playwright tests for start screen and navigation
    - Verify start screen renders all required data-testid elements
    - Verify start button click transitions to game screen
    - Verify controls cheatsheet content and visibility
    - Verify instructions element present with correct content
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5_

  - [ ] 14.2 Write Playwright tests for gameplay and game over
    - Verify game over screen shows data-testid="game-over", final-score, restart
    - Verify restart returns to start screen with fresh state
    - Verify score display updates during gameplay
    - Verify audio element has correct src and loop attributes
    - _Requirements: 8.2, 9.3, 9.4, 9.5, 9.6, 10.1, 10.2_

  - [ ] 14.3 Write Playwright tests for accessibility
    - Verify Tab navigation through all buttons with visible focus
    - Verify Enter and Space activate buttons
    - Verify focus moves to correct element on screen transitions
    - Verify main landmark wraps all content
    - _Requirements: 13.1, 13.2, 13.3, 13.4_

  - [ ] 14.4 Write Playwright tests for test mode API
    - Verify window.__lumines present when NEXT_PUBLIC_TEST_MODE=1
    - Verify window.__lumines absent when env not set
    - Test full flow: seed → spawn → tick → scan → sweepNow → verify score
    - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.5, 14.6, 14.7, 14.8, 14.9_

- [x] 15. Final checkpoint - Build and verify
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- The project uses pnpm, vitest for unit/property tests, and Playwright for E2E tests
- fast-check library is used for property-based testing with vitest
- All game logic modules are pure TypeScript (no DOM, no PixiJS) for easy testing
- Test commands: `pnpm vitest --run` (unit/property), `pnpm exec playwright test` (E2E)

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2"] },
    { "id": 1, "tasks": ["1.3", "2.1"] },
    { "id": 2, "tasks": ["2.2", "2.3"] },
    { "id": 3, "tasks": ["2.4", "2.5", "3.1"] },
    { "id": 4, "tasks": ["3.2", "5.1"] },
    { "id": 5, "tasks": ["6.1"] },
    { "id": 6, "tasks": ["6.2", "7.1"] },
    { "id": 7, "tasks": ["7.2", "7.3", "7.4"] },
    { "id": 8, "tasks": ["9.1", "9.2", "9.3"] },
    { "id": 9, "tasks": ["9.4", "10.1", "11.1"] },
    { "id": 10, "tasks": ["11.2", "12.1"] },
    { "id": 11, "tasks": ["14.1", "14.2", "14.3", "14.4"] }
  ]
}
```
