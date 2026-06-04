# Quickstart: LLMines Game

## Prerequisites

- Node.js compatible with the existing Next.js 15 scaffold
- pnpm 10.32.1 or compatible
- The provided backing track available at `public/backing-track.mp3`

## Setup

```bash
pnpm install
```

The implementation includes Vitest and Playwright scripts in `package.json`.

## Run Locally

```bash
pnpm dev
```

Open the local Next.js URL in a desktop browser. Expected result:

- The start screen appears first.
- The controls cheatsheet is visible.
- Starting the game shows a 16x10 playfield, score 0, and a falling 2x2 piece.
- `/backing-track.mp3` is configured as the looping round audio source.

## Deterministic Test Mode

```bash
NEXT_PUBLIC_TEST_MODE=1 pnpm dev
```

Expected result:

- `window.__lumines` is available after the game page loads.
- Normal audio-synced auto-loop behavior is paused for deterministic control.
- The harness can call `seed`, `state`, `marked`, `spawn`, `tick`, `sweepNow`, and `sweepProgress`.

With test mode unset:

- `window.__lumines` is absent.
- Normal gravity, auto-spawn, looping audio, and audio-synced sweep behavior are active.

## Unit Validation

```bash
pnpm test
```

Expected coverage:

- Piece spawn at columns 7-8 and rows 0-1
- Movement, rotation, collision, soft-drop, hard-drop, and lock behavior
- Game-over detection when spawn cells are blocked
- Square detection for 2x2, 2x3, and 3x3 same-color regions
- Marked-cell deletion by sweep column
- Gravity after deletion
- Score formula using deleted cells and distinct squares
- Sweep timing math for 250 ms per column and 4000 ms per traversal

Current validation result: 17 unit tests passing across 8 test files.

## Browser Validation

```bash
pnpm test:e2e
```

Expected coverage:

- Start screen and start button flow
- Visible controls cheatsheet on start and in-game screens
- Keyboard controls: `h`, `l`, `j`, `k`, and `space`
- Score element text is numeric
- Game-over screen and restart flow
- Audio source points to `/backing-track.mp3` and has looping enabled
- Test-mode API exists only when `NEXT_PUBLIC_TEST_MODE=1`
- Constructed 2x2 same-color square clears during sweep and scores correctly

The Playwright command starts the app with `NEXT_PUBLIC_TEST_MODE=1` on port 4310. The normal-mode absence check uses `?normalMode=1` to verify the production code path that removes `window.__lumines`; a production build with `NEXT_PUBLIC_TEST_MODE` unset also leaves the harness absent.

Current validation result: 9 Playwright tests passing.

## Production Validation

```bash
pnpm typecheck
pnpm lint
pnpm format:check
pnpm build
```

Current validation result: all commands pass.

## Manual Polish Check

Run a normal browser session and verify:

- Active pieces, settled cells, marked cells, sweep bar, clearing cells, and collapsing cells are visually distinct.
- Falling, locking, marking, clearing, and collapse have smooth animation.
- The interface has exactly one main landmark and remains keyboard operable.
- The surrounding screens feel cohesive with the in-game HUD and do not resemble the default scaffold.
