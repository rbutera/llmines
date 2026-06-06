# Implementation Plan: Fix Bottom Settle

**Branch**: `cell/speckit-codex-brownfield` | **Date**: 2026-06-04 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/001-fix-bottom-settle/spec.md`

## Summary

Fix the bottom-row landing artifact in the existing LLMines build so active pieces never render below the Pixi canvas/playfield during hard-drop or gravity-based landings. The implementation should preserve the current core landing rules and per-column collapse animation, while constraining the active-piece visual fall interpolation and lock timing at the last valid row.

## Technical Context

**Language/Version**: TypeScript 5.8 on Node.js 20 type definitions

**Primary Dependencies**: Next.js 15, React 19, Pixi.js 8.18, tRPC support libraries

**Storage**: In-memory game state only; no persistent storage for this feature

**Testing**: Vitest for core/unit coverage, Playwright for browser/e2e validation

**Target Platform**: Browser-rendered web app served by Next.js

**Project Type**: Web application with a deterministic browser test API

**Performance Goals**: Maintain smooth 60 fps-feeling canvas rendering; landing correction must not add visible input or render latency

**Constraints**: Keep all visible active, settling, and landed cells inside the 16 by 10 playfield; preserve current scoring, sweep, controls, RNG, and per-column collapse behavior

**Scale/Scope**: Single brownfield bug fix scoped to active-piece landing visualization, lock transition, and tests around bottom-row landings

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

The constitution file currently contains placeholder principles only and defines no enforceable project-specific gates. The plan therefore applies the local brownfield constraints from the feature specification:

- Preserve existing behavior outside the bottom-row clip/delay artifact.
- Keep the change narrow to the existing game/render/test surfaces.
- Validate both observable game state and rendered playfield bounds.

Gate status before Phase 0: PASS. No violations identified.

## Project Structure

### Documentation (this feature)

```text
specs/001-fix-bottom-settle/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── test-api.md
└── tasks.md
```

### Source Code (repository root)

```text
src/
├── app/
│   └── page.tsx
├── game/
│   ├── core/
│   │   ├── constants.ts
│   │   ├── core.test.ts
│   │   ├── grid.ts
│   │   ├── piece.ts
│   │   └── types.ts
│   ├── engine/
│   │   └── controller.ts
│   ├── react/
│   │   ├── GameCanvas.tsx
│   │   └── GameShell.tsx
│   ├── render/
│   │   └── renderer.ts
│   └── test-api/
│       └── install.ts
└── styles/
    └── globals.css

e2e/
└── lumines.spec.ts
```

**Structure Decision**: Use the existing Next.js web app structure. The likely implementation surface is `src/game/render/renderer.ts` and, only if needed, `src/game/engine/controller.ts` for render snapshots. Core landing rules in `src/game/core/piece.ts` already cover hard-drop and gravity locking and should remain unchanged unless tests expose a model-level mismatch.

## Phase 0: Research Summary

See [research.md](research.md). Key decisions:

- Treat the artifact as an active-piece render/interpolation boundary issue unless implementation tests prove otherwise.
- Clamp or suppress active-piece fall interpolation at the last legal visible row so no drawn cell crosses the playfield bottom.
- Preserve the settled-grid collapse animation path, since that is the existing per-column overhang polish called out by the spec.

## Phase 1: Design Summary

See [data-model.md](data-model.md), [contracts/test-api.md](contracts/test-api.md), and [quickstart.md](quickstart.md).

Design outputs cover:

- Playfield, falling piece, landed grid, and settle motion entities.
- Test API contract expectations for bottom-row landed state.
- End-to-end validation steps for hard-drop, natural gravity settling, and overhang polish regression.

## Constitution Check After Design

Gate status after Phase 1: PASS.

The design remains a narrow brownfield fix, adds no new storage or external interfaces, preserves the existing deterministic test API, and includes validation for both state correctness and visible canvas bounds.
