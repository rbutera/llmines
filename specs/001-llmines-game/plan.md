# Implementation Plan: LLMines — Browser Lumines Clone (MVP)

**Branch**: `cell/speckit-claude-greenfield` | **Date**: 2026-06-04 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-llmines-game/spec.md`

## Summary

Build a polished, single-player browser Lumines clone on the pre-scaffolded create-t3-app stack. The defining mechanic is *fall → settle → mark monochrome 2×2 areas → music-synced timeline sweep clears them → gravity collapse → score*. The technical approach separates concerns into three layers: (1) a **pure, framework-free TypeScript game core** (`src/game/core/`) that is fully unit-testable with vitest and contains all rules — RNG, piece movement/rotation/locking, square marking, distinct-square counting, sweep clearing, scoring, gravity, and game-over; (2) a **PixiJS renderer** that draws game state and animations onto a canvas; and (3) a **React orchestration layer** (screen state machine, keyboard input, HUD/legend, audio) that owns the production game loop and audio-tempo sweep sync. A single **driver** advances the core; in production it auto-ticks gravity and sync-sweeps to the 120 BPM track, and when `NEXT_PUBLIC_TEST_MODE=1` it instead pauses auto-loops and exposes a deterministic `window.__lumines` interface plus stable `data-testid` hooks for the external Playwright harness.

## Technical Context

**Language/Version**: TypeScript 5.8 (strict), React 19, Next.js 15 (App Router)

**Primary Dependencies**: PixiJS 8.18.1 (canvas rendering) — already installed; create-t3-app baseline (tRPC 11, TanStack Query 5, Tailwind v4, Zod) — present but largely unused by this feature (tRPC scaffold left intact, out of scope)

**Storage**: N/A — all state is in-memory per session; no persistence (high scores/accounts are out of scope, deferred to brownfield)

**Testing**: vitest (pure game-core logic + scoring/marking/timing unit tests) and Playwright (e2e via the test-mode interface). Neither is in `package.json` yet — adding them is the first implementation task.

**Target Platform**: Modern desktop browser (Chromium/Firefox/WebKit current)

**Project Type**: Web application (single Next.js app; client-rendered game mounted in the App Router)

**Performance Goals**: 60 fps rendering and sweep animation; input latency under one animation frame; sweep tempo accuracy of 0.25 s/column (4.0 s full traversal) held against the audio clock

**Constraints**: Test hooks (`window.__lumines`, the documented `data-testid`s) MUST exist only when `NEXT_PUBLIC_TEST_MODE=1` and MUST be entirely absent otherwise, with production auto-gravity + music-synced sweep unchanged. MUST NOT circumvent browser autoplay policies. Keyboard-operable; single `<main>` landmark.

**Scale/Scope**: One game screen, 3 UI states (start / playing / game-over), a 16×10 grid, ~8 pure-logic modules, ~6 React components, one Pixi renderer, one driver, one test-API bridge.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

The project constitution (`.specify/memory/constitution.md`) is an unpopulated template — no ratified, project-specific principles are defined. No explicit gates to enforce. The plan therefore applies widely-accepted defaults that the constitution template gestures at:

- **Logic/library separation (library-first spirit)**: All game rules live in a pure, dependency-free `src/game/core/` module, independently testable without React, Pixi, DOM, audio, or timers. ✅ Honoured by the layered architecture.
- **Test-first / testability**: A pinned external test contract drives the design; pure-core unit tests (vitest) and e2e (Playwright) are planned up front. The deterministic interface is a first-class requirement, not an afterthought. ✅
- **Simplicity / YAGNI**: No state library, no backend game logic, no persistence; reuse the existing scaffold; keep the tRPC scaffold untouched rather than ripping it out. ✅
- **Observability**: Game state is fully readable via `state()`/`marked()` in test mode; the production HUD surfaces score. ✅

**Result**: PASS (no violations; Complexity Tracking left empty).

## Project Structure

### Documentation (this feature)

```text
specs/001-llmines-game/
├── plan.md              # This file (/speckit-plan output)
├── research.md          # Phase 0 output — decisions & rationale
├── data-model.md        # Phase 1 output — entities, state shape, transitions
├── quickstart.md        # Phase 1 output — build/run/validate guide
├── contracts/
│   └── test-api.md      # Phase 1 output — window.__lumines + data-testid contract
└── tasks.md             # Phase 2 output (/speckit-tasks — NOT created here)
```

### Source Code (repository root)

```text
public/
└── backing-track.mp3            # provided 120 BPM track (already present; served at /backing-track.mp3)

src/
├── game/
│   ├── core/                    # PURE logic — no React/Pixi/DOM/timer imports (vitest target)
│   │   ├── types.ts             # Color, Cell, Grid, Piece, GameState, Phase, config constants
│   │   ├── rng.ts               # seedable PRNG (mulberry32) → deterministic piece sequence
│   │   ├── grid.ts              # create/clone/get/set, in-bounds, occupancy helpers
│   │   ├── piece.ts             # spawn at cols 7-8/rows 0-1, move, rotate90, collision, lock-to-grid
│   │   ├── marking.ts           # detect monochrome 2x2+ areas → marked cells; distinct-square count
│   │   ├── sweep.ts             # sweep position math (0.25s/col), per-column clear, traversal model
│   │   ├── scoring.ts           # score += clearedCells × distinctSquares (per traversal)
│   │   ├── gravity.ts           # collapse settled cells into gaps after deletion
│   │   └── engine.ts            # reducer/state-machine: tick, spawn, hardDrop, move, rotate, sweepStep, sweepNow, gameOver
│   ├── render/
│   │   └── PixiRenderer.ts      # owns a PIXI.Application; draws grid/piece/marks/sweep + animations from GameState
│   ├── audio/
│   │   └── audioClock.ts        # HTMLAudioElement (loop, src=/backing-track.mp3) + beat/tempo clock for sweep sync
│   ├── driver/
│   │   └── gameDriver.ts        # rAF loop: production auto-gravity + audio-synced sweep; test-mode = manual only
│   ├── test/
│   │   └── testApi.ts           # installs window.__lumines (seed/state/marked/spawn/tick/sweepNow/sweepProgress); test-mode only
│   └── constants.ts             # GRID_COLS=16, GRID_ROWS=10, SPAWN_COL=7, BEAT_MS=500, SWEEP_MS_PER_COL=250, etc.
│
├── app/
│   ├── _components/
│   │   ├── Game.tsx             # 'use client' root: screen state machine (start/playing/gameover), wires driver + input + HUD
│   │   ├── GameCanvas.tsx       # mounts PixiRenderer into a ref'd container; lifecycle (init/destroy/resize)
│   │   ├── StartScreen.tsx      # start-button + how-to-play + controls cheatsheet
│   │   ├── GameOverScreen.tsx   # final score + restart
│   │   ├── Hud.tsx              # live score (data-testid="score")
│   │   └── ControlsCheatsheet.tsx # persistent legend (data-testid="controls-cheatsheet"); reused on start screen
│   ├── page.tsx                 # renders <Game /> (replaces the T3 demo content)
│   └── layout.tsx               # metadata/title update (kept minimal)
│
└── (existing scaffold: src/server/**, src/trpc/**, src/env.js — left intact, unused by this feature)

tests/
├── unit/                        # vitest — core logic
│   ├── marking.test.ts          # 2x2 / 2x3(=2) / 3x3(=4) distinct-square counting
│   ├── scoring.test.ts          # cells × squares rule
│   ├── piece.test.ts            # move/rotate/collision/lock at bounds & spawn
│   ├── gravity.test.ts          # collapse after deletion
│   ├── sweep.test.ts            # 0.25s/col timing math, per-traversal clears
│   └── rng.test.ts              # deterministic sequence from seed
└── e2e/                         # Playwright — drives via window.__lumines + data-testid (NEXT_PUBLIC_TEST_MODE=1)
    ├── flow.spec.ts             # start → play → game-over → restart
    ├── clear-and-score.spec.ts  # build square, sweepNow, assert clear + score + gravity
    └── sweep-timing.spec.ts     # sweepProgress timing assertions
```

**Structure Decision**: Single Next.js web application (the create-t3-app scaffold). The decisive choice is the **three-layer split** — pure `src/game/core/` (rules), `src/game/render/` (Pixi), and `src/app/_components/` (React/UI/audio/driver) — so that 100% of the rules are unit-testable in isolation and the same core powers both the production driver and the test-mode `window.__lumines` bridge. The existing tRPC/server scaffold is left untouched (unused) rather than removed, per simplicity/YAGNI and to avoid scope creep.

## Complexity Tracking

> No constitution violations to justify. Section intentionally empty.
