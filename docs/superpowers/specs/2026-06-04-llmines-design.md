# LLMines — Design Spec

**Status:** Approved (design phase)
**Date:** 2026-06-04

## Goal

A playable, browser-based clone of **Lumines**: 2×2 colour blocks fall onto a
16×10 grid, monochrome 2×2 squares form in the settled stack, and a music-synced
vertical timeline bar sweeps left→right clearing the marked squares and scoring.
Built on the existing create-t3-app scaffold with PixiJS rendering and a
deterministic `window.__lumines` test interface.

## Architecture

A **pure, framework-free game engine** (`src/game/`) holds all deterministic
game logic and is unit-tested with vitest. A thin **React layer** owns screen
flow and the HUD and mounts a **PixiJS canvas** via a ref. A **driver** runs the
production loop (rAF gravity ticks, music-synced sweep, auto-spawn, audio) and is
**fully gated off** when `NEXT_PUBLIC_TEST_MODE=1`, where the engine is instead
driven through `window.__lumines`.

The engine is the single source of truth for game state. It **never auto-spawns**:
spawning is the driver's job in production and the harness's job in test mode.
The renderer, audio, input, and React are purely presentational/wiring — they
hold no game rules.

```
React (Game.tsx)  ──screen flow, HUD, legend, screens
   └─ GameCanvas.tsx ──mounts Pixi + GameDriver via ref
        ├─ GameDriver ──prod loop (rAF) | installs window.__lumines in test mode
        │     ├─ LuminesEngine ──pure state + ops (the testable core)
        │     ├─ Renderer (Pixi) ──draws merged grid, marks, sweep bar, animations
        │     ├─ AudioController ──looping /backing-track.mp3
        │     └─ keyboard input ──vim keys → engine ops
        └─ window.__lumines (test mode only) ──wraps the engine
```

## Pinned constants

- Grid: `COLS = 16`, `ROWS = 10`, `grid[row][col]`, row 0 = TOP.
- Colours: `0 | 1`; empty cell = `null`. (A = 0, B = 1.)
- Piece: 2×2 `[[Color, Color], [Color, Color]]` = `[topRow, bottomRow]`, each
  cell independently coloured, randomised per piece.
- Spawn: top-left of the piece at **row 0, col 7** (occupies rows 0–1, cols 7–8).
- Sweep: full 16-col traversal = 8 beats = 4.0 s at 120 BPM ⇒ **250 ms/col**,
  `sweepX ∈ [0, 16]`.
- Scoring per sweep: `score += (cells deleted that sweep) × (distinct monochrome
  2×2 squares cleared that sweep)`.
- Distinct squares: count **every aligned 2×2 whose top-left corner is
  monochrome** (a 2×3 block ⇒ 2 squares, 3×3 ⇒ 4).
- Square marking: any cell that is part of **any** aligned monochrome 2×2 is
  marked for deletion.
- Audio acceptance: an audio source must exist, `loop` enabled, `src` pointing to
  `/backing-track.mp3`. Live autoplay is not required.

## Modules (`src/game/`)

| Module | Responsibility |
|---|---|
| `constants.ts` | `COLS`, `ROWS`, spawn position, timing (BPM/beat/sweep/ms-per-col), gravity cadence, audio src. |
| `types.ts` | `Color`, `Cell`, `Grid`, `Piece`, `ActivePiece`, `MarkedCell`, `GameState`. |
| `rng.ts` | Seedable mulberry32 `nextRandom`; `nextPiece` → deterministic 2×2. Pure. |
| `board.ts` | `createGrid`, `cloneGrid`, **column-wise `applyGravity`**, `footprintValid`, `stampPiece`, `mergeActive`. |
| `squares.ts` | `computeMarkedGrid`, `countSquares`, `markedList` (pinned semantics). |
| `piece.ts` | `rotateCW`, `canFall`. |
| `engine.ts` | `LuminesEngine`: owns `GameState` and every op. Exactly what `window.__lumines` wraps. |
| `testApi.ts` | `buildTestApi` / `installTestApi` / `uninstallTestApi`; gated by `TEST_MODE`. |
| `testMode.ts` | `TEST_MODE = process.env.NEXT_PUBLIC_TEST_MODE === "1"`. |
| `audio.ts` | `AudioController` — `HTMLAudioElement`, `loop = true`, `/backing-track.mp3`. |
| `input.ts` | Keyboard handler → engine ops (`h`/`l`/`j`/`k`/`space` + arrow aliases). |
| `driver.ts` | Production loop: rAF, gravity, sweep clock, auto-spawn, audio. Renders every frame. Gated off in test mode. |
| `render/renderer.ts` | Pixi scene: grid, active piece (eased), sweep bar, marked highlight, clear/collapse animation. Stateless about rules. |
| `render/theme.ts` | Palette + visual constants. |

### React layer (`src/components/`)

| Component | Responsibility |
|---|---|
| `Game.tsx` | `'use client'` screen state machine (start / playing / over) + HUD (score) + persistent legend + screens. |
| `GameCanvas.tsx` | `'use client'` mounts the Pixi app + `GameDriver` via a ref; tears down on unmount. |
| `Cheatsheet.tsx` | Controls legend, shared by the start screen and the in-game panel. |
| `src/app/page.tsx` | Renders `<Game/>` inside a single `<main>` landmark. |

## Key behavioural decisions

- **Column-wise cell gravity (authentic Lumines).** After a piece locks and after
  each sweep clear, every column independently compacts its non-null cells to the
  floor, preserving order. Locked pieces decompose into individual cells — there
  are no rigid multi-cell bodies in the settled stack. This is how real Lumines
  feels and is what the spec's "cells above deleted ones fall to fill the gaps"
  describes.

- **Production sweep is locked to the track.** `sweepX = (audioTime mod 4.0s) /
  0.25s`. If autoplay is blocked, the driver falls back to a `performance.now()`
  clock at the same tempo, so the sweep never depends on audio decode. The sweep
  is continuous and wraps from the left. Under test mode the audio auto-loop is
  paused and the sweep advances **only** via `sweepProgress` / `sweepNow`.

- **Per-pass scoring snapshot.** When a sweep pass begins, the marked-cells grid
  and the distinct-square count are frozen for that pass. Each column deletes its
  marked cells and accrues `deleted × squares`. Gravity collapses once the pass
  completes. This makes `sweepNow()` (atomic) and `sweepProgress()`
  (column-by-column) accrue to the same total.

- **Game over** triggers when a newly spawned piece's footprint (rows 0–1, cols
  7–8) is blocked. The driver stops the loop and React shows the game-over screen.

## Test mode (`NEXT_PUBLIC_TEST_MODE=1`)

When set:
- No auto-gravity, no auto-sweep, no auto-spawn, no audio loop driving the sweep.
- `window.__lumines` is installed, exposing the pinned API.
- `tick()` advances exactly one gravity step and **never** auto-spawns; after a
  piece locks the board stays quiescent until `spawn()` is called.
- `spawn(piece)` locks any falling piece first, then places the new piece at the
  top-centre spawn position; consecutive calls stack deterministically. Called
  with no piece, it draws from the seeded RNG.
- `state().grid` reflects reality (settled stack + active falling piece merged).
- `sweepProgress(dtMs)` advances the sweep deterministically (250 ms/col,
  wrapping at 4000 ms); `sweepNow()` runs one full pass + scoring atomically.

When unset (default): **none** of these hooks exist and production behaviour
(auto-gravity + music-synced sweep + auto-spawn) is unchanged.

### `window.__lumines` surface

```ts
interface LuminesTestApi {
  seed(n: number): void;
  state(): { grid: Grid; score: number; gameOver: boolean; sweepX: number };
  marked(): { row: number; col: number }[];
  spawn(piece?: Piece): void;
  tick(): void;
  sweepNow(): void;
  sweepProgress(dtMs: number): void;
}
```

## Controls

Vim-style, with arrow aliases: `h` / `←` move left, `l` / `→` move right,
`j` / `↓` soft-drop, `k` / `↑` rotate 90° CW, `space` hard-drop (instant lock).
The piece locks onto the stack or floor when it can fall no further.

## Visual / polish direction

Neon-on-dark Lumines aesthetic:
- Deep slate board (`~#0b0f1a`) with subtle grid lines.
- Two-colour palette: **A = cyan, B = magenta**, drawn as rounded tiles with a
  bevel highlight.
- Marked squares: pulsing white ring overlay.
- Sweep: a bright vertical bar with a trailing glow.
- Clears: cells **pop + fade**, then columns **ease-collapse** via the Pixi ticker
  (interpolated, never snapped).
- Falling pieces ease toward their target row each tick so falling and settling
  feel physical, not stepped.
- Surrounding screens (start / in-game HUD + legend / game-over) share the same
  neon theme via Tailwind — cohesive and considered, not wired-up defaults.

The on-screen controls cheatsheet + a brief how-to-play are visible on the start
screen **and** as a persistent in-game legend panel.

## Accessibility

Keyboard-operable; a single `<main>` landmark; the start button and restart
control are real focusable buttons.

## Testing strategy

- **vitest** (logic, TDD — failing test first): `rng`, `board`, `squares`,
  `piece`, `engine`, `testApi`.
- **Playwright e2e**: drives `window.__lumines` and asserts the DOM testids
  (`start-button`, `restart`, `score`, `game-over`, `controls-cheatsheet`)
  against every acceptance criterion:
  - loads to start screen, starts on input;
  - pieces spawn/fall/move/rotate/soft-drop/hard-drop and lock;
  - a constructed 2×2 is deleted on sweep and the score increases per the pinned
    rule;
  - cells settle by gravity after deletions;
  - sweep traversal = 8 beats (250 ms/col) via `sweepProgress`;
  - game-over on stack overflow + restart;
  - audio source exists with `loop` enabled pointing to `/backing-track.mp3`;
  - cheatsheet visible on start screen and in-game.

## Tooling additions

- Dev deps: `vitest`, `@vitest/coverage-v8`, `@playwright/test` (+ chromium).
- `package.json` scripts: `test`, `test:watch`, `test:e2e`.
- `vitest.config.ts` (node env, `src/**/*.test.ts`).
- `playwright.config.ts` (webServer runs `NEXT_PUBLIC_TEST_MODE=1 pnpm dev`).
- `src/env.js`: declare `NEXT_PUBLIC_TEST_MODE` as an optional client var.

## Out of scope (greenfield)

Auth, accounts, high scores, leaderboards, multiplayer, mobile/touch controls,
skins/themes, settings menus.
