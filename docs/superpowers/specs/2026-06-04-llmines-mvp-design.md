# LLMines MVP Design

## Context

LLMines is a greenfield game built inside the existing create-t3-app shell. The repo currently contains the default App Router page, Tailwind globals, tRPC wiring, PixiJS, and the required audio fixture at `public/backing-track.mp3`.

The MVP is a browser-based Lumines-style puzzle game. A 2x2 two-colour piece falls into a 16x10 grid, same-colour aligned 2x2 squares are marked, and a music-synced vertical sweep clears marked cells column by column.

## Selected Approach

Use a pure TypeScript engine for rules, a React shell for screens and input, and a PixiJS renderer for the board.

Alternatives considered:

- Rules inside the Pixi/React component: fast to start, but hard to test and awkward for the deterministic `window.__lumines` API.
- React reducer as the full engine: inspectable, but less natural for sweep timing and repeated physics-style commands.
- Pure engine with adapters: best fit because grid rules, scoring, gravity, and test-mode semantics can be tested without rendering.

## Architecture

The app has four units:

- `game/constants`: pinned board, spawn, BPM, sweep, colour, and timing constants.
- `game/engine`: authoritative game state and commands. It owns settled cells, active piece position, square detection, locking, gravity, sweep progression, scoring, RNG, and game-over checks.
- `GameClient`: React client component for start/game-over flow, keyboard controls, audio lifecycle, normal-mode loop, test-mode API exposure, score display, controls cheatsheet, and credits.
- `PixiBoard`: PixiJS canvas component mounted through a React ref. It renders the current engine snapshot and presentation effects without changing game rules.

The Next page renders one `<main>` landmark containing the game. The default T3 starter content is removed, but existing project setup, Tailwind, and tRPC infrastructure remain available.

## Game Rules

The grid is 16 columns by 10 rows. Rows are indexed from the top. A cell is colour `0`, colour `1`, or empty.

Pieces are 2x2 matrices with independently randomized colours. Normal play auto-spawns the next piece after a lock. Test mode never auto-spawns from `tick()`.

The spawn position is fixed at columns 7-8 and rows 0-1. If any spawn cell is occupied, the game enters game over.

Movement supports `h`/left, `l`/right, `j`/down soft-drop, `k`/up rotate, and space hard-drop. Rotation is clockwise around the 2x2 matrix. A piece locks when it cannot move down.

Square detection scans every aligned 2x2 top-left position in the settled stack. Each monochrome 2x2 counts as one distinct square. Larger monochrome regions naturally count multiple aligned 2x2 squares. Marked cells are the union of all cells belonging to at least one counted square.

The sweep crosses the 16-column field every 4.0 seconds, which is 8 beats at 120 BPM. When the sweep passes a column, marked cells in that column are deleted. After each deletion column, gravity compacts cells in that column downward. Scoring for a sweep is:

`deleted cell count * distinct completed 2x2 squares cleared in that sweep`

Distinct squares cleared in a sweep are counted by top-left corner before the sweep removes their marked cells.

## Test Mode

When `NEXT_PUBLIC_TEST_MODE=1`, `window.__lumines` is exposed and normal audio-synced auto-loop progression is paused. The API provides:

- `seed(n)`: deterministic RNG seed.
- `state()`: grid including settled stack and active falling piece, score, game-over status, and sweep position.
- `marked()`: current marked cells from square detection.
- `spawn(piece)`: lock an active piece if present, then place the provided piece at the pinned spawn.
- `tick()`: advance one gravity step and never auto-spawn after lock.
- `sweepNow()`: run a complete deterministic sweep and apply scoring/gravity.
- `sweepProgress(dtMs)`: advance the deterministic sweep by elapsed milliseconds.

The API exists only in test mode. Normal builds do not attach `window.__lumines`.

## UI And Rendering

The start screen includes a start button with `data-testid="start-button"`, the controls cheatsheet with `data-testid="controls-cheatsheet"`, and concise how-to-play text.

The in-game screen includes the Pixi board, live score with `data-testid="score"`, and a persistent controls/instructions panel.

The game-over screen includes `data-testid="game-over"`, final score, restart button with `data-testid="restart"`, and the controls cheatsheet.

Visual polish comes from a high-contrast arcade interface, animated piece movement/settle easing, marked-square glow, sweep trail, clear flashes, and column collapse motion. Rendering effects are presentation-only and never mutate game state.

An audio element is created with `src="/backing-track.mp3"` and `loop` enabled. User-initiated start attempts playback, but autoplay success is not required.

The required music credit appears in the UI footer.

## Error Handling

Invalid movement commands become no-ops. Spawning onto occupied cells sets game over. Test API methods are stable no-ops after game over unless `spawn()` is explicitly used by a harness to construct a board; restart creates a new engine instance.

Pixi setup and teardown are isolated inside the renderer component. If the canvas cannot initialize, the React UI still provides the score, controls, and screen flow.

## Testing

Vitest covers:

- piece movement, rotation, lock, and spawn semantics;
- square detection for exact 2x2 and larger monochrome regions;
- sweep scoring with the pinned multiplier;
- column gravity after clear;
- deterministic sweep timing;
- test-mode `tick()` not auto-spawning.

Playwright covers:

- start screen and start button;
- visible controls cheatsheet on start and in game;
- audio element source and loop attribute;
- `window.__lumines` availability in test mode;
- deterministic spawn/tick/sweep flows;
- score DOM update;
- game-over and restart hooks.

## Implementation Plan

1. Add Vitest and Playwright configuration and scripts.
2. Replace the default page with the LLMines shell and metadata.
3. Implement the pure engine modules and unit tests.
4. Implement the React game client, audio element, keyboard controls, and test API exposure.
5. Implement the Pixi board renderer and animation effects.
6. Implement E2E tests using `NEXT_PUBLIC_TEST_MODE=1`.
7. Run formatting, typecheck, unit tests, E2E tests, and production build.
