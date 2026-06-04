# Quickstart: LLMines — Build, Run & Validate

A run/validation guide proving the feature works end-to-end. Implementation details live in `tasks.md` and the code; this file is how you verify.

## Prerequisites

- Node 18+ and `pnpm` (repo pins `pnpm@10.32.1`).
- The provided backing track is already at `public/backing-track.mp3` (served at `/backing-track.mp3`).

## Install

```bash
pnpm install
# Test tooling is added during implementation:
# pnpm add -D vitest @playwright/test && pnpm exec playwright install
```

## Run the game (normal build)

```bash
pnpm dev            # http://localhost:3000
```

**Expected**: a start screen with a **Start** button, how-to-play text, and the controls cheatsheet (`h`/`l` move, `j` soft-drop, `k` rotate, `space` hard-drop). Click Start → the Pixi playfield (16×10) appears with a live score and a persistent in-game legend; pieces spawn at top-centre and fall; keyboard controls work; building a monochrome 2×2 marks it; the timeline bar sweeps left→right in time with the looping music, clearing marks and scoring; filling the spawn zone shows a game-over screen with the final score and a **Restart** button. No `window.__lumines` exists in this build.

## Validate logic (vitest)

```bash
pnpm test:unit
```

Covers (`tests/unit/`):
- **marking**: 2×2 marks 4 cells / 1 square; 2×3 → 2 squares; 3×3 → 4 squares; mixed-colour 2×2 unmarked.
- **scoring**: `cells × distinctSquares` (4, 12, 36, and 3-square = 36 cases).
- **piece**: move/rotate/collision/lock at bounds and at spawn; rotation rejected when it can't fit.
- **gravity**: cells collapse into gaps after deletion.
- **sweep**: `sweepProgress` advances 1 col per 250 ms; full traversal at 4000 ms.
- **rng**: same seed → identical piece sequence.

## Validate end-to-end (Playwright, test mode)

```bash
NEXT_PUBLIC_TEST_MODE=1 pnpm build && NEXT_PUBLIC_TEST_MODE=1 pnpm start &
pnpm test:e2e
```

The harness drives the game via `window.__lumines` and `data-testid` hooks. Reference: [contracts/test-api.md](./contracts/test-api.md).

### Scenario A — flow (`flow.spec.ts`)
1. Load page → `start-button` visible, `controls-cheatsheet` visible, no `game-over`.
2. Click `start-button` → in-game; `score` reads `0`.
3. Repeatedly `spawn()` to fill the spawn zone → `game-over` appears; `restart` visible.
4. Click `restart` → grid empty, `score` = `0` again.

### Scenario B — clear & score (`clear-and-score.spec.ts`)
1. `seed(1)`; `spawn()` pieces to construct a monochrome 2×2 (assert via `marked()` it has 4 entries / `state().grid`).
2. `sweepNow()` → the 4 cells are gone from `state().grid`; `score` increased by **4**.
3. Build a 3×3 monochrome region → `sweepNow()` → `score` delta **36**; cells above collapse by gravity.

### Scenario C — sweep timing (`sweep-timing.spec.ts`)
1. From `state().sweepX === 0`, `sweepProgress(250)` → `sweepX ≈ 1`.
2. `sweepProgress(4000)` from 0 → exactly one full traversal (wrap to 0).

## Manual polish check (subjective, required)

- Pieces fall with easing and settle with a small bounce; sub-blocks read as 4 distinct cells.
- Sweep bar has a glow/trail and visibly sweeps in time with the music loop.
- Marked squares pulse/highlight; cleared cells flash then collapse smoothly.
- Start / HUD / game-over screens are cohesive and pleasant (not default-looking).

## Acceptance ↔ artifact map

| Acceptance criterion | Where verified |
|----------------------|----------------|
| Loads to start, starts on input | Scenario A1–A2 |
| Spawn/fall/move/rotate/soft/hard-drop/lock | unit `piece` + manual |
| Square cleared on sweep + scoring | Scenario B + unit `marking`/`scoring` |
| Gravity settle after deletion | Scenario B3 + unit `gravity` |
| Sweep traversal = 8 beats | Scenario C + unit `sweep` |
| Game-over + restart | Scenario A3–A4 |
| Audio source loops, points at `/backing-track.mp3` | DOM/audio assertion in e2e + manual |
| Cheatsheet visible (start + in-game) | Scenario A + manual |
