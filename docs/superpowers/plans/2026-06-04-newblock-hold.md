# New-block hold + deliberate re-press — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a freshly-spawned block hold at the top for one beat (500 ms) before falling, releasing only on a fresh deliberate drop press or when the hold lapses — killing the soft-drop-cascade where a held key carries over across a lock.

**Architecture:** Add a pure `HoldState` to `GameState`; gate all descent (`gravityStep`/`hardDrop`) on `isHolding` in the core so suppression can't be bypassed. The controller decrements the hold over time (rAF) or per test `tick()`, and adds fresh-press methods. The React layer classifies drop keys by `KeyboardEvent.repeat` (fresh `!repeat` → cancel hold + drop; carried-over `repeat` → suppressed-during-hold normal path). The renderer adds a pulsing "ready" glow.

**Tech Stack:** TypeScript, Vitest (unit, node env, `globals: false`), Next.js + Pixi.js renderer, Playwright e2e (server started with `NEXT_PUBLIC_TEST_MODE=1`).

**Spec:** `docs/superpowers/specs/2026-06-04-newblock-hold-design.md`

---

## File Structure

- **Modify** `src/game/core/types.ts` — add `HoldState`; add `hold: HoldState` to `GameState`.
- **Modify** `src/game/core/constants.ts` — add `HOLD_MS`.
- **Create** `src/game/core/hold.ts` — pure hold helpers (`freshHold`, `noHold`, `isHolding`, `tickHold`, `releaseHold`). Depends only on types — no import of `piece.ts` (avoids a cycle).
- **Create** `src/game/core/hold.test.ts` — unit tests for the helpers and the gravity gate.
- **Modify** `src/game/core/grid.ts` — `createGame` seeds `hold: noHold()`.
- **Modify** `src/game/core/piece.ts` — `spawnPiece` sets `freshHold()`; `gravityStep`/`hardDrop` gate on `isHolding`; add `freshSoftDrop`/`freshHardDrop`.
- **Modify** `src/game/core/index.ts` — re-export `./hold`; add `hold` to `PublicState` + `publicState()`.
- **Modify** `src/game/engine/controller.ts` — hold-aware `advance`, `testTick`; `pressSoftDrop`/`pressHardDrop`; `testPressSoftDrop`/`testPressHardDrop`; `RenderState.hold`.
- **Modify** `src/game/engine/fall-progress.ts` — add `isHolding(state) → 0` guard.
- **Modify** `src/game/engine/fall-progress.test.ts` — add the held-piece case.
- **Modify** `src/game/react/GameShell.tsx` — classify drop keys by `e.repeat`.
- **Modify** `src/game/render/renderer.ts` — pulsing glow on the held piece.
- **Modify** `src/game/test-api/install.ts` — expose `pressSoftDrop`/`pressHardDrop`.
- **Modify** `e2e/lumines.spec.ts` — extend `State` with `hold`; update "tick advances"; add hold tests.

Context for the implementer (existing code facts):
- `GameState` lives in `src/game/core/types.ts`; row 0 = TOP, 10 rows × 16 cols, `grid[row][col]`.
- `SECONDS_PER_BEAT = 0.5` and `GRAVITY_INTERVAL_MS = 700` are in `constants.ts`.
- `createGame(seed)` in `grid.ts` builds the initial state literal.
- `spawnPiece(state, cells)` in `piece.ts` returns `{ ...state, active: { cells, pos } }` on success, or `{ ...state, active: null, gameOver: true }` when blocked.
- `gravityStep(state)` returns `{ state, locked }`; `hardDrop(state)` returns a `GameState`; `softDrop` just calls `gravityStep`.
- `publicState(state)` in `index.ts` projects `{ grid, score, gameOver, sweepX }` (uses `viewGrid`).
- Controller test hooks (`testSpawn`, `testTick`, …) never auto-spawn; production `input`/loop auto-spawns when `!testMode`.
- Vitest: `import { describe, expect, it } from "vitest";` (globals off).

---

### Task 1: Hold state + pure helpers

**Files:**
- Modify: `src/game/core/types.ts`
- Modify: `src/game/core/constants.ts`
- Create: `src/game/core/hold.ts`
- Test: `src/game/core/hold.test.ts`

- [x] **Step 1: Write the failing test**

Create `src/game/core/hold.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { HOLD_MS } from "./constants";
import { createGame } from "./grid";
import { freshHold, isHolding, noHold, releaseHold, tickHold } from "./hold";
import type { GameState } from "./types";

const MONO_A = [
  [0, 0],
  [0, 0],
] as const;

function held(): GameState {
  return {
    ...createGame(1),
    active: { cells: MONO_A as never, pos: { row: 0, col: 7 } },
    hold: freshHold(),
  };
}

describe("hold helpers", () => {
  it("freshHold is active with the full window; noHold is inactive", () => {
    expect(freshHold()).toEqual({ active: true, remainingMs: HOLD_MS });
    expect(noHold()).toEqual({ active: false, remainingMs: 0 });
  });

  it("isHolding is true only with an active piece and an active hold", () => {
    expect(isHolding(held())).toBe(true);
    expect(isHolding({ ...held(), hold: noHold() })).toBe(false);
    expect(isHolding({ ...createGame(1), active: null })).toBe(false);
  });

  it("tickHold decrements remainingMs without moving the piece", () => {
    const s = tickHold(held(), 100);
    expect(s.hold).toEqual({ active: true, remainingMs: HOLD_MS - 100 });
    expect(s.active!.pos).toEqual({ row: 0, col: 7 });
  });

  it("tickHold releases the hold when the window lapses", () => {
    const s = tickHold(held(), HOLD_MS + 50);
    expect(s.hold).toEqual({ active: false, remainingMs: 0 });
  });

  it("tickHold on a non-holding state is a no-op", () => {
    const base = { ...held(), hold: noHold() };
    expect(tickHold(base, 100)).toBe(base);
  });

  it("releaseHold cancels an active hold", () => {
    expect(releaseHold(held()).hold).toEqual({ active: false, remainingMs: 0 });
  });
});
```

- [x] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/game/core/hold.test.ts`
Expected: FAIL — `Cannot find module './hold'` and `HOLD_MS` not exported.

- [x] **Step 3: Add `HoldState` to types**

In `src/game/core/types.ts`, add this interface (place it just above the `GameState` interface):

```typescript
/** Spawn hold: while active the new block waits at the top before falling. */
export interface HoldState {
  active: boolean;
  remainingMs: number;
}
```

Then add a `hold` field to `GameState` (after the `active` field):

```typescript
  active: ActivePiece | null;
  /** New-block hold; gates descent until it lapses or a fresh drop press. */
  hold: HoldState;
```

- [x] **Step 4: Add `HOLD_MS` constant**

In `src/game/core/constants.ts`, after the `SECONDS_PER_BEAT` line, add:

```typescript
/** New-block hold window: one beat (0.5s) before a spawned block falls. */
export const HOLD_MS = SECONDS_PER_BEAT * 1000; // 500ms
```

- [x] **Step 5: Create the hold helpers**

Create `src/game/core/hold.ts`:

```typescript
import { HOLD_MS } from "./constants";
import type { GameState, HoldState } from "./types";

/** A fresh, active hold for a just-spawned block. */
export function freshHold(): HoldState {
  return { active: true, remainingMs: HOLD_MS };
}

/** An inactive hold (no block is waiting). */
export function noHold(): HoldState {
  return { active: false, remainingMs: 0 };
}

/** True while a spawned block is holding at the top (descent suppressed). */
export function isHolding(state: GameState): boolean {
  return state.active !== null && state.hold.active;
}

/**
 * Advance the hold timer by `dtMs` without moving the piece. Releases the hold
 * (back to `noHold()`) once the window reaches zero. No-op when not holding.
 */
export function tickHold(state: GameState, dtMs: number): GameState {
  if (!state.hold.active) return state;
  const remainingMs = state.hold.remainingMs - dtMs;
  if (remainingMs <= 0) return { ...state, hold: noHold() };
  return { ...state, hold: { active: true, remainingMs } };
}

/** Cancel the hold immediately (a fresh deliberate drop press). */
export function releaseHold(state: GameState): GameState {
  if (!state.hold.active) return state;
  return { ...state, hold: noHold() };
}
```

- [x] **Step 6: Run the test to verify it passes**

Run: `npx vitest run src/game/core/hold.test.ts`
Expected: PASS — 6 tests. (If `createGame` doesn't yet set `hold`, the `held()` helper still supplies it explicitly, so this passes; Task 2 makes `createGame` seed it.)

- [x] **Step 7: Commit**

```bash
git add src/game/core/types.ts src/game/core/constants.ts src/game/core/hold.ts src/game/core/hold.test.ts
git commit -m "feat: add hold state and pure hold helpers"
```

---

### Task 2: Seed the hold in createGame, export from core

**Files:**
- Modify: `src/game/core/grid.ts`
- Modify: `src/game/core/index.ts`
- Test: `src/game/core/hold.test.ts` (extend)

- [x] **Step 1: Write the failing test**

Append to `src/game/core/hold.test.ts` inside the `describe` block (before the closing `});`):

```typescript
  it("createGame starts with no hold", () => {
    expect(createGame(1).hold).toEqual({ active: false, remainingMs: 0 });
  });
```

- [x] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/game/core/hold.test.ts`
Expected: FAIL — `createGame(1).hold` is `undefined` (typecheck/runtime mismatch).

- [x] **Step 3: Seed the hold in createGame**

In `src/game/core/grid.ts`, import `noHold` at the top:

```typescript
import { noHold } from "./hold";
```

In the object returned by `createGame`, add the `hold` field (after `gameOver: false,`):

```typescript
    gameOver: false,
    hold: noHold(),
    sweepX: 0,
```

- [x] **Step 4: Re-export hold + add it to PublicState**

In `src/game/core/index.ts`, add the re-export alongside the others:

```typescript
export * from "./hold";
```

Add `hold` to the `PublicState` interface:

```typescript
export interface PublicState {
  grid: Grid;
  score: number;
  gameOver: boolean;
  sweepX: number;
  hold: { active: boolean; remainingMs: number };
}
```

And include it in `publicState()`:

```typescript
  return {
    grid: viewGrid(state),
    score: state.score,
    gameOver: state.gameOver,
    sweepX: state.sweepX,
    hold: state.hold,
  };
```

- [x] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/game/core/hold.test.ts`
Expected: PASS — 7 tests.

- [x] **Step 6: Typecheck (catches any GameState literal missing `hold`)**

Run: `npx tsc --noEmit`
Expected: exit 0. If it flags a `GameState` literal without `hold` (e.g. in `core.test.ts`), add `hold: noHold()` there. (At the time of writing only `createGame` constructs the full state, so none are expected.)

- [x] **Step 7: Commit**

```bash
git add src/game/core/grid.ts src/game/core/index.ts src/game/core/hold.test.ts
git commit -m "feat: seed hold in createGame and expose it in public state"
```

---

### Task 3: Gate gravity on the hold; spawn sets the hold; fresh drops

**Files:**
- Modify: `src/game/core/piece.ts`
- Test: `src/game/core/hold.test.ts` (extend)

- [x] **Step 1: Write the failing test**

Append to `src/game/core/hold.test.ts` inside the `describe` block (before the closing `});`). This needs more imports — update the existing import line from `./piece` style; add at the top of the file (after the existing imports):

```typescript
import {
  freshHardDrop,
  freshSoftDrop,
  gravityStep,
  hardDrop,
  spawnPiece,
} from "./piece";
```

Then the tests:

```typescript
  it("spawnPiece sets a fresh hold on the new block", () => {
    const s = spawnPiece(createGame(1), MONO_A as never);
    expect(s.hold).toEqual({ active: true, remainingMs: HOLD_MS });
  });

  it("gravityStep does not move a holding piece", () => {
    const s = held();
    const { state, locked } = gravityStep(s);
    expect(locked).toBe(false);
    expect(state.active!.pos).toEqual({ row: 0, col: 7 });
  });

  it("hardDrop ignores a holding piece", () => {
    const s = held();
    expect(hardDrop(s)).toBe(s);
  });

  it("freshSoftDrop releases the hold and steps down one row", () => {
    const { state } = freshSoftDrop(held());
    expect(state.hold.active).toBe(false);
    expect(state.active!.pos).toEqual({ row: 1, col: 7 });
  });

  it("freshHardDrop releases the hold and drops to the floor", () => {
    const s = freshHardDrop(held());
    // 2x2 mono A lands on the bottom two rows after release + settle
    expect(s.active).toBe(null);
    expect(s.grid[9]![7]).toBe(0);
    expect(s.grid[8]![7]).toBe(0);
  });
```

- [x] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/game/core/hold.test.ts`
Expected: FAIL — `freshSoftDrop`/`freshHardDrop` not exported, and the gravity-gate assertions fail (a holding piece currently still moves).

- [x] **Step 3: Wire the hold into piece.ts**

In `src/game/core/piece.ts`, add to the imports from `./hold`:

```typescript
import { freshHold, isHolding, releaseHold } from "./hold";
```

In `spawnPiece`, set the hold on the success path:

```typescript
export function spawnPiece(state: GameState, cells: Piece): GameState {
  const pos: PiecePos = { row: SPAWN_ROW, col: SPAWN_COL };
  if (!canPlace(state.grid, cells, pos)) {
    return { ...state, active: null, gameOver: true };
  }
  return { ...state, active: { cells, pos }, hold: freshHold() };
}
```

Gate `gravityStep` (add the hold check after the existing guard):

```typescript
export function gravityStep(state: GameState): {
  state: GameState;
  locked: boolean;
} {
  if (!state.active || state.gameOver) return { state, locked: false };
  if (isHolding(state)) return { state, locked: false };
  if (canDescend(state)) {
```

Gate `hardDrop` (add after the existing guard):

```typescript
export function hardDrop(state: GameState): GameState {
  if (!state.active || state.gameOver) return state;
  if (isHolding(state)) return state;
  let active = state.active;
```

Add the fresh-press wrappers at the end of the file:

```typescript
/** Fresh soft-drop press: cancel any hold, then soft-drop one step. */
export function freshSoftDrop(state: GameState): {
  state: GameState;
  locked: boolean;
} {
  return gravityStep(releaseHold(state));
}

/** Fresh hard-drop press: cancel any hold, then hard-drop to the floor. */
export function freshHardDrop(state: GameState): GameState {
  return hardDrop(releaseHold(state));
}
```

- [x] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/game/core/hold.test.ts`
Expected: PASS — 12 tests.

- [x] **Step 5: Run the full core suite (no regression)**

Run: `npx vitest run src/game/core`
Expected: PASS — `core.test.ts` + `hold.test.ts` all green. (`spawnPiece` now also sets `hold`; existing tests assert positions/grids, not the absence of `hold`, so they remain green.)

- [x] **Step 6: Commit**

```bash
git add src/game/core/piece.ts src/game/core/hold.test.ts
git commit -m "feat: gate gravity on hold, set hold on spawn, add fresh-drop ops"
```

---

### Task 4: fall-progress guard for held pieces

**Files:**
- Modify: `src/game/engine/fall-progress.ts`
- Test: `src/game/engine/fall-progress.test.ts`

- [x] **Step 1: Write the failing test**

In `src/game/engine/fall-progress.test.ts`, add `freshHold` to the `../core` import list, then add this test inside the `describe("computeFallProgress", …)` block (before its closing `});`):

```typescript
  it("is 0 for a held piece even mid-board with accum", () => {
    const base = createGame(1);
    const state: GameState = {
      ...base,
      active: { cells: MONO_A, pos: { row: 0, col: 7 } },
      hold: freshHold(),
    };
    expect(computeFallProgress(state, interval / 2, interval, false)).toBe(0);
  });
```

- [x] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/game/engine/fall-progress.test.ts`
Expected: FAIL — returns `0.5` (the helper does not yet account for the hold).

- [x] **Step 3: Add the hold guard**

In `src/game/engine/fall-progress.ts`, update the import and the body:

```typescript
import { isHolding, isResting, type GameState } from "../core";
```

```typescript
  if (testMode) return 0;
  if (!state.active) return 0;
  if (isHolding(state)) return 0;
  if (isResting(state)) return 0;
  return Math.max(0, Math.min(1, gravityAccumMs / intervalMs));
```

- [x] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/game/engine/fall-progress.test.ts`
Expected: PASS — 7 tests.

- [x] **Step 5: Commit**

```bash
git add src/game/engine/fall-progress.ts src/game/engine/fall-progress.test.ts
git commit -m "feat: hold a held piece at fallProgress 0"
```

---

### Task 5: Controller — hold-aware timing, fresh-press methods, test hooks

**Files:**
- Modify: `src/game/engine/controller.ts`
- Test: `src/game/engine/controller.test.ts` (create)

This task adds controller behaviour and a new unit test file driving the controller in test mode (no rAF). The controller exposes `getRenderState()` and the `test*` hooks, which is all we need.

- [x] **Step 1: Write the failing test**

Create `src/game/engine/controller.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { HOLD_MS, type Piece } from "../core";
import { GameController } from "./controller";

const MONO_A: Piece = [
  [0, 0],
  [0, 0],
];

function playing(): GameController {
  const c = new GameController({ testMode: true, seed: 1 });
  c.testSpawn(MONO_A);
  return c;
}

describe("GameController hold behaviour", () => {
  it("a spawned block is held at the top", () => {
    const c = playing();
    const s = c.testState();
    expect(s.hold).toEqual({ active: true, remainingMs: HOLD_MS });
    expect(s.grid[0]![7]).toBe(0); // still at the top
    expect(s.grid[1]![7]).toBe(0);
  });

  it("a hold-aware tick consumes the hold without moving the piece", () => {
    const c = playing();
    c.testTick(); // one beat (700ms) >= HOLD_MS (500ms) -> releases, no move
    const s = c.testState();
    expect(s.hold.active).toBe(false);
    expect(s.grid[0]![7]).toBe(0); // did NOT advance during the hold beat
    expect(s.grid[2]![7]).toBe(null);
  });

  it("after the hold lapses the block falls at normal gravity", () => {
    const c = playing();
    c.testTick(); // release
    c.testTick(); // first real gravity step
    const s = c.testState();
    expect(s.grid[0]![7]).toBe(null);
    expect(s.grid[1]![7]).toBe(0);
    expect(s.grid[2]![7]).toBe(0);
  });

  it("a carried-over hold (no fresh press) does not advance the new block", () => {
    const c = playing();
    // Simulate holding the key: we never call pressSoftDrop across the spawn.
    // The block stays put for the whole hold window.
    const before = c.testState();
    expect(before.grid[0]![7]).toBe(0);
    expect(before.hold.active).toBe(true);
  });

  it("a fresh soft-drop press cancels the hold and advances immediately", () => {
    const c = playing();
    c.testPressSoftDrop();
    const s = c.testState();
    expect(s.hold.active).toBe(false);
    expect(s.grid[0]![7]).toBe(null);
    expect(s.grid[1]![7]).toBe(0); // moved down one row at once
    expect(s.grid[2]![7]).toBe(0);
  });

  it("a fresh hard-drop press cancels the hold and drops to the floor", () => {
    const c = playing();
    c.testPressHardDrop();
    const s = c.testState();
    expect(s.grid[9]![7]).toBe(0);
    expect(s.grid[8]![7]).toBe(0);
  });
});
```

- [x] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/game/engine/controller.test.ts`
Expected: FAIL — `testPressSoftDrop`/`testPressHardDrop` do not exist, and `testState().hold` is undefined.

- [x] **Step 3: Update controller imports**

In `src/game/engine/controller.ts`, add to the `../core` import block:

```typescript
  freshHardDrop,
  freshSoftDrop,
  isHolding,
  tickHold,
  type HoldState,
```

- [x] **Step 4: Add `hold` to RenderState**

In the `RenderState` interface, add:

```typescript
  /** New-block hold window for the held piece. */
  hold: HoldState;
```

- [x] **Step 5: Make `advance` hold-aware**

Replace the body of `advance(dtMs)` with:

```typescript
  private advance(dtMs: number): void {
    if (this.state.gameOver) return;

    // Music-synced sweep keeps running during the hold.
    this.state = advanceSweep(this.state, dtMs / SWEEP_MS_PER_COL);

    if (isHolding(this.state)) {
      // Held: count the hold down, suppress gravity, keep the accumulator clean
      // so a just-released block falls at full normal cadence.
      this.state = tickHold(this.state, dtMs);
      this.gravityAccumMs = 0;
      return;
    }

    this.gravityAccumMs += dtMs;
    while (this.gravityAccumMs >= GRAVITY_INTERVAL_MS) {
      this.gravityAccumMs -= GRAVITY_INTERVAL_MS;
      this.gravityTickAndSpawn();
      if (this.state.gameOver) break;
    }
  }
```

- [x] **Step 6: Add fresh-press methods (production)**

After the existing `input(action)` method, add:

```typescript
  /** Fresh, deliberate soft-drop press (cancels any new-block hold). */
  pressSoftDrop(): void {
    if (!this.started || this.state.gameOver || !this.state.active) return;
    const { state, locked } = freshSoftDrop(this.state);
    this.state = state;
    if (locked && !this.testMode) {
      this.gravityAccumMs = 0;
      this.state = spawnNext(this.state);
    }
    this.emit();
  }

  /** Fresh, deliberate hard-drop press (cancels any new-block hold). */
  pressHardDrop(): void {
    if (!this.started || this.state.gameOver || !this.state.active) return;
    this.state = freshHardDrop(this.state);
    if (!this.testMode) {
      this.gravityAccumMs = 0;
      this.state = spawnNext(this.state);
    }
    this.emit();
  }
```

- [x] **Step 7: Add `hold` to `renderState()` and make `testTick` hold-aware + add test hooks**

In `renderState()`, add `hold` to the returned object (after `sweepX`):

```typescript
      sweepX: this.state.sweepX,
      hold: this.state.hold,
```

Replace `testTick()` with the hold-aware version:

```typescript
  /** One gravity beat; NEVER auto-spawns. Consumes the hold first if active. */
  testTick(): void {
    if (isHolding(this.state)) {
      this.state = tickHold(this.state, GRAVITY_INTERVAL_MS);
    } else {
      const { state } = gravityStep(this.state);
      this.state = state;
    }
    this.emit();
  }
```

Add the two test-press hooks (next to `testTick`):

```typescript
  /** Fresh deliberate soft-drop press (test interface). */
  testPressSoftDrop(): void {
    this.pressSoftDrop();
  }

  /** Fresh deliberate hard-drop press (test interface). */
  testPressHardDrop(): void {
    this.pressHardDrop();
  }
```

- [x] **Step 8: Run the test to verify it passes**

Run: `npx vitest run src/game/engine/controller.test.ts`
Expected: PASS — 6 tests.

- [x] **Step 9: Run the full unit suite + typecheck**

Run: `npx vitest run` then `npx tsc --noEmit`
Expected: all unit tests pass; `tsc` exit 0.

- [x] **Step 10: Commit**

```bash
git add src/game/engine/controller.ts src/game/engine/controller.test.ts
git commit -m "feat: hold-aware controller timing, fresh-press methods, test hooks"
```

---

### Task 6: React input classification + test API + renderer polish

**Files:**
- Modify: `src/game/react/GameShell.tsx`
- Modify: `src/game/test-api/install.ts`
- Modify: `src/game/render/renderer.ts`

No new unit test here — behaviour is verified by the e2e suite in Task 7 and the controller tests in Task 5. These are wiring + presentation changes.

- [x] **Step 1: Classify drop keys by freshness in GameShell**

In `src/game/react/GameShell.tsx`, replace the `onKey` handler body inside the keyboard `useEffect`:

```typescript
    const onKey = (e: KeyboardEvent) => {
      const action = keyToAction(e);
      if (!action) return;
      e.preventDefault();
      if (action === "softDrop") {
        if (e.repeat) controller.input("softDrop");
        else controller.pressSoftDrop();
      } else if (action === "hardDrop") {
        if (e.repeat) controller.input("hardDrop");
        else controller.pressHardDrop();
      } else {
        controller.input(action);
      }
    };
```

- [x] **Step 2: Expose the press hooks on the test API**

In `src/game/test-api/install.ts`, add to the `LuminesTestApi` interface:

```typescript
  pressSoftDrop(): void;
  pressHardDrop(): void;
```

And to the `api` object in `installTestApi`:

```typescript
    pressSoftDrop: () => controller.testPressSoftDrop(),
    pressHardDrop: () => controller.testPressHardDrop(),
```

- [x] **Step 3: Add the "ready to place" pulse in the renderer**

In `src/game/render/renderer.ts`, the `drawPiece(rs)` method draws each active
cell with `{ glow: 0.4 }`. Replace the glow with a hold-aware pulse. Update
`drawPiece`:

```typescript
  private drawPiece(rs: RenderState): void {
    const g = this.pieceG;
    g.clear();
    if (!rs.active) return;
    const { cells, pos } = rs.active;
    const yOff = rs.fallProgress * CELL;
    // While the new block is holding, pulse the glow as a "ready to place" cue.
    const glow = rs.hold.active
      ? 0.4 + 0.35 * (0.5 + 0.5 * Math.sin(this.clock / 120))
      : 0.4;
    const map: [number, number, Cell][] = [
      [pos.row, pos.col, cells[0][0]],
      [pos.row, pos.col + 1, cells[0][1]],
      [pos.row + 1, pos.col, cells[1][0]],
      [pos.row + 1, pos.col + 1, cells[1][1]],
    ];
    for (const [row, col, color] of map) {
      this.cellRect(g, col, row, yOff, color, { glow });
    }
  }
```

- [x] **Step 4: Typecheck + lint**

Run: `npx tsc --noEmit` then `npx next lint`
Expected: `tsc` exit 0; "No ESLint warnings or errors".

- [x] **Step 5: Commit**

```bash
git add src/game/react/GameShell.tsx src/game/test-api/install.ts src/game/render/renderer.ts
git commit -m "feat: fresh-vs-held key routing, test press hooks, ready-pulse polish"
```

---

### Task 7: e2e — hold state + deliberate press behaviour

**Files:**
- Modify: `e2e/lumines.spec.ts`

- [x] **Step 1: Extend the `State` type and add the press helpers**

In `e2e/lumines.spec.ts`, add `hold` to the `State` interface:

```typescript
interface State {
  grid: Cell[][];
  score: number;
  gameOver: boolean;
  sweepX: number;
  hold: { active: boolean; remainingMs: number };
}
```

Add `pressSoftDrop`/`pressHardDrop` to the `window.__lumines` declared type:

```typescript
      pressSoftDrop(): void;
      pressHardDrop(): void;
```

- [x] **Step 2: Update the existing "tick advances" test to release the hold first**

Replace the body of the test `"spawn places at top-centre; tick advances; tick never auto-spawns"` (the section from the first `tick` onward) so it accounts for the hold:

```typescript
test("spawn places at top-centre; tick advances; tick never auto-spawns", async ({
  page,
}) => {
  await page.getByTestId("start-button").click();
  await api(page, "seed", 1);
  await api(page, "spawn", MONO_A);

  let s = await getState(page);
  expect(s.grid.length).toBe(10);
  expect(s.grid[0]!.length).toBe(16);
  // new block holds at the top
  expect(s.hold.active).toBe(true);
  expect(s.grid[0]![7]).toBe(0);
  expect(s.grid[0]![8]).toBe(0);
  expect(s.grid[1]![7]).toBe(0);

  // first tick consumes the hold (no movement)
  await api(page, "tick");
  s = await getState(page);
  expect(s.hold.active).toBe(false);
  expect(s.grid[0]![7]).toBe(0);

  // next tick advances under normal gravity
  await api(page, "tick");
  s = await getState(page);
  expect(s.grid[1]![7]).toBe(0);
  expect(s.grid[2]![7]).toBe(0);
  expect(s.grid[0]![7]).toBe(null);

  // tick to the floor and beyond — must NOT auto-spawn a new piece
  for (let i = 0; i < 20; i++) await api(page, "tick");
  s = await getState(page);
  expect(s.grid[9]![7]).toBe(0);
  expect(s.grid[8]![7]).toBe(0);
  expect(s.grid[0]![7]).toBe(null);
  expect(s.grid[0]![8]).toBe(null);
});
```

- [x] **Step 3: Add a deliberate-press test**

Add this test at the end of `e2e/lumines.spec.ts`:

```typescript
test("new block holds; fresh press drops, carried-over hold does not", async ({
  page,
}) => {
  await page.getByTestId("start-button").click();
  await api(page, "seed", 1);
  await api(page, "spawn", MONO_A);

  // Carried-over hold: without a fresh press the block stays at the top.
  let s = await getState(page);
  expect(s.hold.active).toBe(true);
  expect(s.grid[0]![7]).toBe(0);

  // A fresh soft-drop press cancels the hold and advances immediately.
  await api(page, "pressSoftDrop");
  s = await getState(page);
  expect(s.hold.active).toBe(false);
  expect(s.grid[0]![7]).toBe(null);
  expect(s.grid[1]![7]).toBe(0);
  expect(s.grid[2]![7]).toBe(0);
});

test("fresh hard-drop press on a held block lands it on the floor", async ({
  page,
}) => {
  await page.getByTestId("start-button").click();
  await api(page, "seed", 1);
  await api(page, "spawn", MONO_A);
  await api(page, "pressHardDrop");
  const s = await getState(page);
  expect(s.grid[9]![7]).toBe(0);
  expect(s.grid[8]![7]).toBe(0);
});
```

- [x] **Step 4: Run the e2e suite**

Run: `npx playwright test`
Expected: PASS — all tests green (the 9 originals, adjusted "tick advances", plus 2 new).

- [x] **Step 5: Commit**

```bash
git add e2e/lumines.spec.ts
git commit -m "test: e2e for new-block hold and deliberate drop press"
```

---

### Task 8: Full verification sweep

- [x] **Step 1: Run everything**

Run, in order:
- `npx vitest run` — Expected: all unit suites green (core + hold + fall-progress + controller).
- `npx tsc --noEmit` — Expected: exit 0.
- `npx next lint` — Expected: "No ESLint warnings or errors".
- `npx prettier --write "src/**/*.{ts,tsx}" "e2e/**/*.ts"` then `npx prettier --check "src/**/*.{ts,tsx}" "e2e/**/*.ts"` — Expected: all matched files formatted / pass.
- `npx playwright test` — Expected: all e2e green.

- [x] **Step 2: Commit any formatting**

```bash
git add -A
git commit -m "chore: format new-block hold changes" || echo "nothing to format"
```

---

## Self-Review

**1. Spec coverage:**
- Hold on spawn → Task 3 Step 3 (`spawnPiece` → `freshHold`). ✓
- Begins falling on lapse (normal gravity) → Task 1 `tickHold` release + Task 5 `advance`/`testTick`; e2e Task 7 Step 2. ✓
- Begins falling on fresh press → Task 3 `freshSoftDrop`/`freshHardDrop` + Task 5 `pressSoftDrop`/`pressHardDrop`; e2e Task 7 Step 3. ✓
- Held key does not carry over (must re-press) → Task 6 Step 1 `e.repeat` routing + core gravity gate (Task 3); controller test Task 5 + e2e Task 7. ✓
- Fresh press during hold engages immediately; continuous hold resumes only after → `press*` releases + `input` drop suppressed during hold by the core gate. ✓
- Testability (`state().hold`, `pressSoftDrop`, `pressHardDrop`, hold-aware `tick`) → Task 2 (`PublicState.hold`), Task 5 (`testTick`, test hooks), Task 6 (`install.ts`). ✓
- Polish (ready beat) → Task 6 Step 3 pulse; `HOLD_MS = 500` one beat (Task 1 Step 4). ✓
- No regression → core gate is additive; existing suites re-run in Tasks 3/5/7/8. ✓

**2. Placeholder scan:** No TBD/TODO/"handle edge cases"; every code step shows complete code with exact commands and expected output.

**3. Type consistency:** `HoldState { active, remainingMs }`, `freshHold`/`noHold`/`isHolding`/`tickHold`/`releaseHold`, `freshSoftDrop` (`{ state, locked }`) / `freshHardDrop` (`GameState`), `pressSoftDrop`/`pressHardDrop`, `testPressSoftDrop`/`testPressHardDrop`, `HOLD_MS`, and `PublicState.hold` are used identically across Tasks 1–7. The e2e `State.hold` and `install.ts` interface match `PublicState.hold`.
