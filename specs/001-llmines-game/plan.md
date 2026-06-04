# Implementation Plan: LLMines Game

**Branch**: `cell/speckit-codex-greenfield` | **Date**: 2026-06-04 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/001-llmines-game/spec.md`

## Summary

Build LLMines as a browser-playable Lumines-style MVP inside the existing create-t3-app scaffold. The implementation will keep deterministic game rules in a pure TypeScript engine, render the playfield with PixiJS inside a client React component, use the provided looping backing track as the normal-play timing source, expose the exact deterministic test interface only when `NEXT_PUBLIC_TEST_MODE=1`, and cover rules with Vitest plus end-to-end gameplay flows with Playwright.

## Technical Context

**Language/Version**: TypeScript 5.8.2, React 19, Next.js 15.2.3 App Router

**Primary Dependencies**: Next.js, React, Tailwind CSS 4, PixiJS 8.18.1, tRPC scaffold retained but not required for MVP gameplay

**Storage**: N/A for MVP; game state is in memory only, with no accounts, persistence, high scores, or leaderboard

**Testing**: Vitest for pure game-engine logic; Playwright for browser flow, Pixi canvas presence, DOM hooks, audio element contract, and deterministic test API

**Target Platform**: Modern desktop browser with keyboard input

**Project Type**: Single web application

**Performance Goals**: Maintain smooth 60 fps rendering during normal play on a modern desktop browser; deterministic engine operations complete synchronously for the 16x10 grid; sweep timing completes 16 columns in 4.0 seconds with at most 50 ms normal-play tolerance and exact deterministic advancement

**Constraints**: One `<main>` landmark; PixiJS canvas mounted through a React ref; audio source must point to `/backing-track.mp3` and loop; no autoplay workaround; `NEXT_PUBLIC_TEST_MODE=1` disables audio-synced automation and exposes `window.__lumines`; normal builds expose no test interface

**Scale/Scope**: One game screen flow with start, in-game, and game-over states; one 16x10 playfield; one active 2x2 piece; two-color palette; local browser session only

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

The constitution file still contains placeholder principles and no enforceable project-specific gates. The plan applies the repository's explicit feature constraints instead:

- Keep implementation scoped to the greenfield MVP; no auth, accounts, leaderboard, multiplayer, mobile/touch controls, skins, themes, or settings menus.
- Keep gameplay logic independently testable outside the renderer.
- Keep deterministic test hooks absent from normal play.
- Preserve the fixed stack and package manager choices from the feature input.

Initial gate status: PASS. No constitution violations or unresolved clarifications.

Post-design gate status: PASS. The Phase 1 artifacts preserve the same constraints and introduce no extra scope.

## Project Structure

### Documentation (this feature)

```text
specs/001-llmines-game/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── deterministic-test-interface.md
├── checklists/
│   └── requirements.md
└── tasks.md
```

### Source Code (repository root)

```text
public/
└── backing-track.mp3

src/
├── app/
│   ├── layout.tsx
│   └── page.tsx
├── app/_components/
│   ├── LLMinesGame.tsx
│   ├── PixiBoard.tsx
│   ├── GameHud.tsx
│   └── ControlsPanel.tsx
├── lib/llmines/
│   ├── constants.ts
│   ├── types.ts
│   ├── rng.ts
│   ├── engine.ts
│   ├── square-detection.ts
│   ├── sweep.ts
│   ├── scoring.ts
│   ├── test-api.ts
│   └── audio.ts
└── styles/
    └── globals.css

tests/
├── unit/
│   ├── engine.test.ts
│   ├── square-detection.test.ts
│   ├── scoring.test.ts
│   └── sweep.test.ts
└── e2e/
    └── llmines.spec.ts
```

**Structure Decision**: Use the existing single Next.js application. Keep reusable game rules in `src/lib/llmines` so Vitest can verify the core without Pixi or React. Keep Pixi-specific rendering in `src/app/_components/PixiBoard.tsx` and keep the page shell in React components. Add test directories at repository root for Vitest and Playwright.

## Phase 0: Research

Research decisions are captured in [research.md](./research.md). All technical-context choices are resolved; no open clarification items remain.

## Phase 1: Design & Contracts

Design artifacts generated:

- [data-model.md](./data-model.md)
- [contracts/deterministic-test-interface.md](./contracts/deterministic-test-interface.md)
- [quickstart.md](./quickstart.md)

The agent context block in `AGENTS.md` must point to this plan so later commands read the active implementation plan.

## Complexity Tracking

No constitution violations require justification.

## Implementation Notes

- Implemented as planned with the pure engine in `src/lib/llmines`, browser shell in `src/app/_components`, and Pixi rendering isolated in `PixiBoard.tsx`.
- Playwright uses a single deterministic dev server with `NEXT_PUBLIC_TEST_MODE=1` to avoid two concurrent Next dev servers writing incompatible public environment values into the same `.next` cache.
- Normal-mode harness absence remains covered by production code gating on `NEXT_PUBLIC_TEST_MODE` plus a `?normalMode=1` e2e override for the shared deterministic test server.
