# Bottom-row clip/delay fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop a piece settling onto the bottom row (or atop the stack) from rendering below the playfield canvas and snapping up — make the settle in-bounds, immediate, and smooth.

**Architecture:** The active falling piece is drawn separately from the settled stack and offset vertically by `fallProgress * CELL` so it descends smoothly. The bug is that `fallProgress` is computed unconditionally from the accumulating gravity timer, so a *resting* piece (one whose next gravity row is illegal) gets dragged below its row before the gravity tick locks it. The fix gates that interpolation on whether the piece can actually descend: extract a pure `computeFallProgress()` that returns 0 when the active piece is resting, and have the controller call it.

**Tech Stack:** TypeScript, Vitest (unit, node env), Next.js + Pixi.js renderer (untouched), Playwright (existing e2e, must stay green).

**Spec:** `docs/superpowers/specs/2026-06-04-bottom-row-clip-delay-design.md`

---

## File Structure

- **Create** `src/game/engine/fall-progress.ts` — single responsibility: decide how far (0..1) the active piece is visually interpolated toward its next gravity row. Pure, no DOM/Pixi/time. Depends only on `../core` (`isResting`, `GameState`).
- **Create** `src/game/engine/fall-progress.test.ts` — unit tests for the helper (the regression guard).
- **Modify** `src/game/engine/controller.ts` — `renderState()` calls the helper instead of computing `fallProgress` inline; add the import.

No other files change. The Pixi renderer (`src/game/render/renderer.ts`) already consumes `RenderState.fallProgress` correctly — once the value is right, `drawPiece` draws in-bounds. The pure game core (`src/game/core/**`) is already correct (`settle()` bounds the grid to `ROWS`).

Why a new file rather than an inline guard: the computation was previously inline in a private method driven by a private `gravityAccumMs` and the rAF loop, making it impossible to unit-test. Extracting a pure function with explicit parameters makes the resting-piece invariant testable in isolation and keeps `renderState()` declarative.

---

### Task 1: Extract and test `computeFallProgress`

**Files:**
- Create: `src/game/engine/fall-progress.ts`
- Test: `src/game/engine/fall-progress.test.ts`

Context for the implementer:
- `GRAVITY_INTERVAL_MS`, `createGame`, `emptyGrid`, `spawnPiece`, `isResting`, `ROWS`, and the `GameState` / `Piece` types are all exported from `../core` (re-exported through `src/game/core/index.ts`).
- `isResting(state)` returns `true` when `state.active` exists and cannot descend one row (the core predicate already used by gravity).
- The grid is `grid[row][col]`, row 0 = TOP, `ROWS` (10) rows × 16 cols. A 2x2 piece's top-left is `pos`; its bottom cells are at `pos.row + 1`. So a piece whose bottom cells sit on the last row has `pos.row === ROWS - 2` and is resting.
- Vitest here uses `globals: false`, so import `{ describe, expect, it }` from `"vitest"`.

- [ ] **Step 1: Write the failing test**

Create `src/game/engine/fall-progress.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import {
  createGame,
  emptyGrid,
  GRAVITY_INTERVAL_MS,
  ROWS,
  spawnPiece,
  type GameState,
  type Piece,
} from "../core";
import { computeFallProgress } from "./fall-progress";

const MONO_A: Piece = [
  [0, 0],
  [0, 0],
];

/** A game with the active piece resting with its bottom cells on the floor. */
function restingOnFloor(): GameState {
  const base = createGame(1);
  // place the 2x2 so its bottom row is the last grid row (cannot descend)
  return {
    ...base,
    active: { cells: MONO_A, pos: { row: ROWS - 2, col: 7 } },
  };
}

/** A game with the active piece mid-air with clear space below. */
function midAir(): GameState {
  return spawnPiece(createGame(1), MONO_A); // spawns at top, can descend
}

describe("computeFallProgress", () => {
  const interval = GRAVITY_INTERVAL_MS;

  it("is 0 for a piece resting on the bottom row even at near-full accum", () => {
    // The bug: a resting piece must NOT be offset below its row.
    const p = computeFallProgress(
      restingOnFloor(),
      interval - 1,
      interval,
      false,
    );
    expect(p).toBe(0);
  });

  it("is 0 for a piece resting atop the stack mid-board", () => {
    const grid = emptyGrid();
    grid[5]![7] = 0; // a block at row 5, col 7
    grid[5]![8] = 0;
    const state: GameState = {
      ...createGame(1),
      grid,
      // 2x2 sitting on rows 3-4 above the row-5 blocks: next row illegal
      active: { cells: MONO_A, pos: { row: 3, col: 7 } },
    };
    expect(computeFallProgress(state, interval - 1, interval, false)).toBe(0);
  });

  it("interpolates for a mid-air piece that can still descend", () => {
    const p = computeFallProgress(midAir(), interval / 2, interval, false);
    expect(p).toBeCloseTo(0.5, 5);
  });

  it("clamps to [0,1] for a mid-air piece", () => {
    expect(computeFallProgress(midAir(), interval * 5, interval, false)).toBe(
      1,
    );
    expect(computeFallProgress(midAir(), -100, interval, false)).toBe(0);
  });

  it("is 0 in test mode regardless of accum", () => {
    expect(computeFallProgress(midAir(), interval / 2, interval, true)).toBe(0);
  });

  it("is 0 when there is no active piece", () => {
    expect(
      computeFallProgress(createGame(1), interval / 2, interval, false),
    ).toBe(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/game/engine/fall-progress.test.ts`
Expected: FAIL — `Cannot find module './fall-progress'` (the module does not exist yet).

- [ ] **Step 3: Write the minimal implementation**

Create `src/game/engine/fall-progress.ts`:

```typescript
import { isResting, type GameState } from "../core";

/**
 * How far (0..1) the active piece should be visually interpolated toward the
 * next gravity row, for smooth descent in the renderer.
 *
 * The active piece is drawn separately from the settled stack and offset by
 * `fallProgress * CELL`. That offset is only meaningful while the piece can
 * actually descend. When the piece is **resting** (its next row is illegal —
 * the bottom row, or atop the stack), there is no row to fall into, so the
 * progress must be 0; otherwise the accumulating gravity timer would drag the
 * resting piece below its row and past the canvas bottom before it locks.
 */
export function computeFallProgress(
  state: GameState,
  gravityAccumMs: number,
  intervalMs: number,
  testMode: boolean,
): number {
  if (testMode) return 0;
  if (!state.active) return 0;
  if (isResting(state)) return 0;
  return Math.max(0, Math.min(1, gravityAccumMs / intervalMs));
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/game/engine/fall-progress.test.ts`
Expected: PASS — 6 tests passed.

- [ ] **Step 5: Commit**

```bash
git add src/game/engine/fall-progress.ts src/game/engine/fall-progress.test.ts
git commit -m "feat: add computeFallProgress with resting-piece guard"
```

---

### Task 2: Wire the controller to the helper

**Files:**
- Modify: `src/game/engine/controller.ts` (import + `renderState()` body)

This task has no new test of its own — it is a behaviour-preserving substitution covered by the existing unit suite, the existing Playwright e2e suite, and `tsc`. The verification steps are the existing suites going green.

- [ ] **Step 1: Add the import**

In `src/game/engine/controller.ts`, immediately after the closing `} from "../core";` of the existing core import block, add:

```typescript
import { computeFallProgress } from "./fall-progress";
```

- [ ] **Step 2: Replace the inline `fallProgress` computation**

In the private `renderState()` method, replace this:

```typescript
  private renderState(): RenderState {
    const interval = GRAVITY_INTERVAL_MS;
    return {
      grid: this.state.grid,
      active: this.state.active,
      fallProgress: this.testMode
        ? 0
        : Math.max(0, Math.min(1, this.gravityAccumMs / interval)),
      score: this.state.score,
      gameOver: this.state.gameOver,
      sweepX: this.state.sweepX,
      marked: computeMarked(this.state.grid).marked,
    };
  }
```

with this:

```typescript
  private renderState(): RenderState {
    return {
      grid: this.state.grid,
      active: this.state.active,
      fallProgress: computeFallProgress(
        this.state,
        this.gravityAccumMs,
        GRAVITY_INTERVAL_MS,
        this.testMode,
      ),
      score: this.state.score,
      gameOver: this.state.gameOver,
      sweepX: this.state.sweepX,
      marked: computeMarked(this.state.grid).marked,
    };
  }
```

Note: `GRAVITY_INTERVAL_MS` is already imported in `controller.ts`; the local `interval` const is removed because it is no longer used.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0, no output (no unused-variable or type errors).

- [ ] **Step 4: Run the full unit suite**

Run: `npx vitest run`
Expected: PASS — all test files (core + fall-progress) green, 31 tests.

- [ ] **Step 5: Format and lint**

Run: `npx prettier --write src/game/engine/fall-progress.ts src/game/engine/fall-progress.test.ts src/game/engine/controller.ts`
Run: `npx next lint`
Expected: prettier reports the files; `next lint` prints "No ESLint warnings or errors".

- [ ] **Step 6: Run the e2e suite (regression gate)**

Run: `npx playwright install chromium` (first time only), then `npx playwright test`
Expected: PASS — 9 tests passed. (E2E runs in test mode where `fallProgress` is already 0, so this proves the substitution did not regress existing deterministic behaviour; the resting-piece invariant itself is proven by the Task 1 unit tests.)

- [ ] **Step 7: Commit**

```bash
git add src/game/engine/controller.ts
git commit -m "fix: keep settling pieces in-bounds on the bottom row"
```

---

## Acceptance mapping

- **"renders entirely within bounds, no cells below grid"** → resting piece → `computeFallProgress` returns 0 → `drawPiece` applies no downward offset → nothing drawn below `BOARD_H`. (Task 1 tests: resting-on-floor, resting-on-stack.)
- **"no delay/clip artifact before lock; immediate + smooth"** → the piece no longer hangs below then snaps up; it renders at its final row on arrival and stays there until the normal gravity tick converts it to settled cells. (Covered by the same resting → 0 behaviour.)
- **"must not regress the smooth per-column overhang settle"** → that animation is the renderer's `seedCollapse`/`fallOffsets` over the *settled* grid, independent of `fallProgress`; untouched here. (Task 2 leaves the renderer unchanged; e2e stays green.)
- **Testability `window.__lumines.state().grid`** → already correct (`settle()` bounds the grid); existing e2e "spawn places … tick to floor" asserts landed cells on rows 8–9 of a fixed 10-row grid. (Task 2 Step 6.)

---

## Self-Review

- **Spec coverage:** Root cause (unconditional `fallProgress` on a resting piece) → Task 1 helper + Task 2 wiring. Fix rules (testMode/no-active/resting → 0, else clamp) → Task 1 Step 3 + tests. No-regression items (mid-air descent, overhang settle, lock timing, hard drop) → preserved by leaving the renderer/core/lock paths untouched and verified by Task 2 Steps 4 & 6. No gaps.
- **Placeholder scan:** No TBD/TODO/"handle edge cases"; every code step shows complete code and exact commands with expected output.
- **Type consistency:** `computeFallProgress(state, gravityAccumMs, intervalMs, testMode)` signature is identical in the helper (Task 1 Step 3), its tests (Task 1 Step 1), and the call site (Task 2 Step 2). `isResting`, `GameState`, `GRAVITY_INTERVAL_MS` names match their `../core` exports.
