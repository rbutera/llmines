# Phase 0 Research: LLMines

All Technical Context items were resolvable from the pinned input and the pre-scaffolded repo; there were no open `NEEDS CLARIFICATION` markers. This document records the key design decisions, their rationale, and rejected alternatives.

## R1. Layering: pure core vs. rendering vs. orchestration

- **Decision**: Three layers — `src/game/core/` (pure, dependency-free rules), `src/game/render/` (PixiJS), `src/app/_components/` (React + audio + driver). Core never imports React, Pixi, DOM, audio, or timers.
- **Rationale**: The pinned `window.__lumines` API (`seed`, `state`, `marked`, `spawn`, `tick`, `sweepNow`, `sweepProgress`) and the vitest logic-test requirement both demand rules that run without a browser, canvas, or wall-clock. A pure core makes both trivial and lets production and test-mode share identical rule code (no divergence risk).
- **Alternatives rejected**: (a) Logic embedded in React components/hooks — untestable headlessly, couples rules to render cycles. (b) Logic inside the Pixi renderer — couples rules to GPU/canvas, can't unit-test, hard to expose deterministically.

## R2. Game state representation

- **Decision**: A single immutable-by-convention `GameState` object holding `grid` (settled cells), the active `piece` + its position, `score`, `phase` (`start|playing|gameover`), `sweepX` (float 0..16), RNG state, and per-traversal clear accumulators. Engine functions take a state and return the next state.
- **Rationale**: A serializable snapshot is exactly what `state()` must return; a reducer model makes `tick()`/`spawn()`/`sweepNow()` pure and deterministic, and makes React re-render and Pixi redraw off one source of truth.
- **Alternatives rejected**: Mutable OOP entity graph with internal timers — harder to snapshot, easy to leak nondeterminism.

## R3. Deterministic RNG

- **Decision**: `mulberry32` (or equivalent 32-bit seedable PRNG) seeded by `seed(n)`. Each piece draws 4 independent bits for its 4 cells.
- **Rationale**: Tiny, fast, fully deterministic and reproducible from a seed — satisfies "seed the RNG → deterministic piece sequence." `Math.random` is non-seedable and forbidden by determinism.
- **Alternatives rejected**: `Math.random` (non-deterministic); crypto RNG (non-seedable, overkill).

## R4. Square marking & distinct-square counting (pinned semantics)

- **Decision**: A cell is *marked* if it belongs to **any** aligned monochrome 2×2 (i.e. for cell `(r,c)`, it is marked if it is part of a 2×2 block — checking the four 2×2 windows it can belong to — where all four cells share its colour). `distinctSquares` = count of grid positions `(r,c)` with `r≤rows-2, c≤cols-2` whose 2×2 window (`(r,c),(r,c+1),(r+1,c),(r+1,c+1)`) is monochrome (all non-empty, equal colour). This yields 2×2→1, 2×3→2, 3×3→4 exactly as pinned.
- **Rationale**: Directly encodes the pinned rule ("every aligned 2×2 whose top-left corner is monochrome counts as one distinct square"). Marking-by-membership ensures the whole monochrome region (≥2×2) is cleared, while counting-by-top-left drives the multiplier.
- **Alternatives rejected**: Connected-component flood fill counted as one square (contradicts the pinned 2×3=2, 3×3=4); counting only exact 2×2 non-overlapping tilings (wrong totals).

## R5. Sweep timing & traversal model

- **Decision**: `sweepX` advances at **0.25 s/column** (`SWEEP_MS_PER_COL = 250`), full 16-col traversal = 4.0 s = 8 beats at 120 BPM (beat = 500 ms). `sweepProgress(dtMs)` advances `sweepX += dtMs/250`. As `sweepX` crosses an integer boundary `k`, column `k` is "passed": its currently-marked cells are deleted and added to the traversal's cleared set. On wrap (`sweepX ≥ 16`), the traversal completes: scoring is applied for the accumulated cleared set and gravity collapse runs, then `sweepX` wraps to `0`. `sweepNow()` performs a full instantaneous traversal (clear all currently-marked cells + score + collapse) and resets `sweepX`.
- **Rationale**: Decouples sweep advancement from real time/audio (required for deterministic timing assertions), while preserving the "deletes column by column as it passes" feel. Per-traversal accumulation matches the pinned scoring multiplier semantics ("distinct squares cleared in that sweep").
- **Alternatives rejected**: Scoring per-column-crossing (breaks the per-sweep multiplier); tying sweep purely to audio `currentTime` (non-deterministic under test, fragile against decode/autoplay).

## R6. Scoring (pinned)

- **Decision**: For each completed sweep that deletes cells, `score += clearedCellCount × distinctSquaresCleared`, where both are measured over the set of cells cleared during that traversal (`distinctSquares` recomputed against the pre-clear board restricted to the cleared region). Examples: one 2×2 → 4×1=4; 2×3 → 6×2=12; 3×3 → 9×4=36; clearing three separate 2×2s in one pass → 12×3=36.
- **Rationale**: Verbatim from the pinned rule; computed at traversal granularity to match "in that sweep."

## R7. Production loop & audio-tempo sync

- **Decision**: A `requestAnimationFrame` driver. Production: accumulate elapsed ms, advance gravity on a fixed gravity-tick interval, and advance `sweepX` from the audio clock (prefer `audioEl.currentTime` mapped to beats when audio is actually playing; fall back to rAF delta so the sweep runs even when autoplay is blocked). Audio element created with `loop=true`, `src="/backing-track.mp3"`, started on the start gesture. Test-mode: the driver does **not** auto-advance; all motion comes from `tick()`/`sweepProgress()`/`sweepNow()`.
- **Rationale**: rAF gives 60 fps; deriving sweep phase from `currentTime` keeps it locked to the music and self-correcting across loops; the rAF fallback honours "audio autoplay is not required to pass" without hacking autoplay.
- **Alternatives rejected**: WebAudio `AudioContext` scheduling — more accurate but heavier than needed and complicates the loop=true/`src` acceptance check; `setInterval` for gravity — drift-prone.

## R8. Test-mode gating (`NEXT_PUBLIC_TEST_MODE`)

- **Decision**: Read `process.env.NEXT_PUBLIC_TEST_MODE` (inlined at build by Next for `NEXT_PUBLIC_*`). When `=== "1"`: driver auto-loops are disabled and `installTestApi()` attaches `window.__lumines`. When unset: no test API is installed (the module's install call is guarded), and auto-gravity + audio-synced sweep run normally. Add `NEXT_PUBLIC_TEST_MODE` to `src/env.js` client schema (optional).
- **Rationale**: `NEXT_PUBLIC_` vars are statically replaced, so the guard is build-time and dead-code-eliminates the test bridge from normal builds — satisfying "none of these hooks may be present in a normal build."
- **Alternatives rejected**: Runtime-only flag without build gating (risk of shipping hooks); a separate entrypoint (unnecessary complexity).

## R9. PixiJS 8 integration in React 19 / App Router

- **Decision**: A `'use client'` `GameCanvas` component creates one `PIXI.Application` via `app.init({...})` inside a `useEffect`, appends `app.canvas` to a ref'd `<div>`, and destroys it on unmount (guarding React 18/19 StrictMode double-invoke). The renderer subscribes to state changes and tweens block fall/settle, square mark highlight, sweep bar, and clear/collapse animations.
- **Rationale**: Pixi v8 uses async `Application.init()` and `app.canvas`; mounting via ref is the standard canvas-in-React pattern and keeps Pixi off the server (App Router defaults to RSC).
- **Alternatives rejected**: `@pixi/react` reconciler — extra dependency and indirection for a single canvas; SSR of canvas — impossible.

## R10. UI / polish approach

- **Decision**: Tailwind v4 for the surrounding screens (start/HUD/game-over/legend); Pixi handles all in-grid animation (piece fall easing, sub-block settle, sweep-bar glow/trail, mark pulse, clear flash + collapse). Cohesive dark neon palette evoking Lumines.
- **Rationale**: Clear division — DOM/Tailwind for chrome, Pixi for the playfield — keeps each polished without fighting layout. Animation lives where the 60 fps loop already is.
- **Alternatives rejected**: CSS-grid playfield (can't hit the "feels like Lumines, not a static grid" bar); animating DOM cells (jank, no sub-frame control).

## R11. Testing tooling

- **Decision**: Add `vitest` (+ `@vitest/coverage` optional) for `tests/unit/` against `src/game/core/`, and `@playwright/test` for `tests/e2e/` run with `NEXT_PUBLIC_TEST_MODE=1`. Add `test`, `test:unit`, `test:e2e` scripts.
- **Rationale**: Matches the spec's pinned tooling (vitest logic + Playwright e2e). Pure core needs no DOM env (node environment), keeping unit tests fast.
- **Alternatives rejected**: Jest (heavier ESM config with this stack); testing logic only through Playwright (slow, indirect).
