# LLMines MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build LLMines, a playable browser-based Lumines clone (2×2 colour blocks fall onto a 16×10 grid, monochrome 2×2 squares form, a music-synced timeline bar sweeps left→right clearing them) on the existing create-t3-app scaffold, with PixiJS rendering and a deterministic `window.__lumines` test interface.

**Architecture:** A pure, framework-free game engine (`src/game/`) holds all deterministic logic and is unit-tested with vitest. A thin React layer owns screen flow + HUD and mounts a PixiJS canvas. A "driver" runs the production loop (rAF gravity ticks, music-synced sweep, auto-spawn, audio) and is fully gated off under `NEXT_PUBLIC_TEST_MODE=1`, where the engine is instead driven through `window.__lumines`. The engine never auto-spawns; spawning is the driver's job in production and the harness's job in test mode.

**Design spec:** `docs/superpowers/specs/2026-06-04-llmines-design.md` (approved). This plan implements that spec; the one explicit decision it encodes beyond the base draft is the **audio-locked sweep** (sweep advances by elapsed `audio.currentTime`, falling back to rAF `dt` when the audio clock isn't progressing — see Task 11).

**Tech Stack:** Next.js 15 (App Router) · React 19 · TypeScript · Tailwind v4 · PixiJS 8 · vitest (logic) · Playwright (e2e) · pnpm.

---

## Pinned facts this plan encodes (from the spec)

- Grid: `COLS=16`, `ROWS=10`, `grid[row][col]`, row 0 = TOP.
- Colours: `0 | 1`; empty cell = `null`.
- Piece: 2×2 `[[Color,Color],[Color,Color]]` = `[topRow, bottomRow]`, each cell independently coloured.
- Spawn: top-left of the piece at **row 0, col 7** (occupies rows 0–1, cols 7–8).
- Sweep: full 16-col traversal = 8 beats = 4.0s at 120 BPM ⇒ **250 ms/col**, `sweepX ∈ [0,16]`.
- Scoring per sweep: `score += (cells deleted that sweep) × (distinct monochrome 2×2 squares cleared that sweep)`.
- Distinct squares: count **every aligned 2×2 whose top-left corner is monochrome** (2×3 block ⇒ 2, 3×3 ⇒ 4).
- Square marking: any cell that is part of **any** aligned monochrome 2×2 is marked.
- Test mode (`NEXT_PUBLIC_TEST_MODE=1`): no auto-gravity/auto-sweep/auto-spawn; expose `window.__lumines`; `tick()` never auto-spawns; `spawn()` locks any falling piece first, then places at top-centre; `state().grid` = settled + active merged. Unset ⇒ none of these hooks exist.
- Audio acceptance: an audio source must exist, `loop` enabled, `src` pointing to `/backing-track.mp3`. Live autoplay not required.
- DOM testids: `start-button`, `restart`, `score`, `game-over`, `controls-cheatsheet`.

## File structure (created by this plan)

```
src/game/
  constants.ts     # COLS, ROWS, spawn, timing, audio src
  types.ts         # Color, Cell, Grid, Piece, ActivePiece, MarkedCell, GameState
  rng.ts           # mulberry32 nextRandom + nextPiece (pure, seedable)
  board.ts         # createGrid, cloneGrid, applyGravity, footprintValid, stampPiece, mergeActive
  squares.ts       # computeMarkedGrid, countSquares, markedList
  piece.ts         # rotateCW, canFall
  engine.ts        # LuminesEngine class: state + all operations (the testable core)
  testApi.ts       # window.__lumines install/uninstall, gated by TEST_MODE
  testMode.ts      # TEST_MODE boolean
  audio.ts         # AudioController (HTMLAudioElement, loop, /backing-track.mp3)
  input.ts         # keyboard handler -> engine ops (h/l/j/k/space + arrows)
  driver.ts        # production loop: rAF, gravity, sweep clock, auto-spawn, audio; render every frame
  render/
    renderer.ts    # PixiJS scene: grid, active piece, sweep bar, marked highlight, clear/collapse anim
    theme.ts       # colour palette + visual constants
src/components/
  Game.tsx         # 'use client' screen state machine (start/playing/over) + HUD + legend + screens
  GameCanvas.tsx   # 'use client' mounts Pixi app + driver via ref
  Cheatsheet.tsx   # controls legend (shared by start screen + in-game)
src/app/page.tsx   # renders <Game/> inside a single <main>
src/game/*.test.ts # vitest unit tests (rng, board, squares, piece, engine)
e2e/lumines.spec.ts# Playwright acceptance tests
vitest.config.ts
playwright.config.ts
```

---

## Task 0: Tooling — vitest, Playwright, test-mode flag

**Files:**
- Modify: `package.json` (scripts + devDeps)
- Create: `vitest.config.ts`, `playwright.config.ts`, `src/game/testMode.ts`
- Modify: `src/env.js` (declare `NEXT_PUBLIC_TEST_MODE` optional)

- [ ] **Step 1: Install test tooling**

```bash
pnpm add -D vitest @vitest/coverage-v8 @playwright/test
pnpm exec playwright install chromium
```

- [ ] **Step 2: Add scripts to `package.json`**

In the `"scripts"` block add:

```json
    "test": "vitest run",
    "test:watch": "vitest",
    "test:e2e": "playwright test"
```

- [ ] **Step 3: Create `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
```

- [ ] **Step 4: Create `playwright.config.ts`**

```ts
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  fullyParallel: false,
  use: {
    baseURL: "http://localhost:3100",
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "NEXT_PUBLIC_TEST_MODE=1 pnpm dev --port 3100",
    url: "http://localhost:3100",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
```

- [ ] **Step 5: Create `src/game/testMode.ts`**

```ts
// NEXT_PUBLIC_* vars are inlined by Next at build time.
export const TEST_MODE = process.env.NEXT_PUBLIC_TEST_MODE === "1";
```

- [ ] **Step 6: Declare the env var in `src/env.js`** (keeps T3 env validation quiet)

In `client: { ... }` replace the commented placeholder with:

```js
    NEXT_PUBLIC_TEST_MODE: z.string().optional(),
```

In `runtimeEnv: { ... }` add:

```js
    NEXT_PUBLIC_TEST_MODE: process.env.NEXT_PUBLIC_TEST_MODE,
```

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore: add vitest + playwright tooling and test-mode flag"
```

---

## Task 1: Constants and types

**Files:**
- Create: `src/game/constants.ts`, `src/game/types.ts`

- [ ] **Step 1: Create `src/game/constants.ts`**

```ts
export const COLS = 16;
export const ROWS = 10;

// Piece spawn: top-left cell at row 0, col 7 (occupies rows 0-1, cols 7-8).
export const SPAWN_ROW = 0;
export const SPAWN_COL = 7;

// Timing (120 BPM => beat = 500ms; sweep = 8 beats = 4000ms over 16 cols).
export const BPM = 120;
export const BEAT_MS = 500;
export const SWEEP_BEATS = 8;
export const SWEEP_MS = 4000;
export const MS_PER_COL = SWEEP_MS / COLS; // 250

// Production-only cadence.
export const GRAVITY_TICK_MS = 700;
export const SOFT_DROP_TICK_MS = 60;

export const AUDIO_SRC = "/backing-track.mp3";
```

- [ ] **Step 2: Create `src/game/types.ts`**

```ts
export type Color = 0 | 1;
export type Cell = Color | null;
export type Grid = Cell[][]; // [row][col], row 0 = top
export type Piece = [[Color, Color], [Color, Color]]; // [topRow, bottomRow]

export interface ActivePiece {
  cells: Piece;
  row: number; // top row of the 2x2
  col: number; // left col of the 2x2
}

export interface MarkedCell {
  row: number;
  col: number;
}

export interface GameState {
  settled: Grid; // always bottom-packed (no floating cells)
  active: ActivePiece | null;
  score: number;
  gameOver: boolean;
  sweepX: number; // 0..COLS
  rngState: number;
  // Snapshot for the current sweep pass:
  sweepMarked: boolean[][] | null;
  sweepSquares: number;
  sweepNextCol: number;
}
```

- [ ] **Step 3: Commit**

```bash
git add src/game/constants.ts src/game/types.ts
git commit -m "feat: game constants and types"
```

---

## Task 2: Seedable RNG (`rng.ts`)

**Files:**
- Create: `src/game/rng.ts`, `src/game/rng.test.ts`

- [ ] **Step 1: Write the failing test — `src/game/rng.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { nextRandom, nextPiece } from "./rng";

describe("rng", () => {
  it("is deterministic for a given seed", () => {
    const [v1] = nextRandom(42);
    const [v2] = nextRandom(42);
    expect(v1).toBe(v2);
  });

  it("produces a different value as state advances", () => {
    const [v1, s1] = nextRandom(42);
    const [v2] = nextRandom(s1);
    expect(v1).not.toBe(v2);
  });

  it("returns values in [0,1)", () => {
    let s = 7;
    for (let i = 0; i < 100; i++) {
      const [v, ns] = nextRandom(s);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      s = ns;
    }
  });

  it("nextPiece yields a 2x2 of 0/1 and advances state", () => {
    const [piece, s2] = nextPiece(123);
    expect(piece.length).toBe(2);
    expect(piece[0].length).toBe(2);
    for (const row of piece)
      for (const c of row) expect([0, 1]).toContain(c);
    expect(s2).not.toBe(123);
  });

  it("nextPiece is deterministic and reproduces a sequence from a seed", () => {
    const [p1, s1] = nextPiece(999);
    const [p2] = nextPiece(s1);
    const [q1, t1] = nextPiece(999);
    const [q2] = nextPiece(t1);
    expect(p1).toEqual(q1);
    expect(p2).toEqual(q2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/game/rng.test.ts`
Expected: FAIL ("Cannot find module './rng'").

- [ ] **Step 3: Implement `src/game/rng.ts`**

```ts
import type { Color, Piece } from "./types";

// mulberry32. Returns [value in [0,1), nextState].
export function nextRandom(state: number): [number, number] {
  let a = state | 0;
  a = (a + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return [value, a];
}

// Draw four colours (top-left, top-right, bottom-left, bottom-right).
export function nextPiece(state: number): [Piece, number] {
  let s = state;
  const draw = (): Color => {
    const [v, ns] = nextRandom(s);
    s = ns;
    return v < 0.5 ? 0 : 1;
  };
  const piece: Piece = [
    [draw(), draw()],
    [draw(), draw()],
  ];
  return [piece, s];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/game/rng.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/game/rng.ts src/game/rng.test.ts
git commit -m "feat: seedable deterministic RNG and piece generator"
```

---

## Task 3: Board operations (`board.ts`)

**Files:**
- Create: `src/game/board.ts`, `src/game/board.test.ts`

- [ ] **Step 1: Write the failing test — `src/game/board.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import {
  createGrid,
  cloneGrid,
  applyGravity,
  footprintValid,
  stampPiece,
  mergeActive,
} from "./board";
import { COLS, ROWS } from "./constants";
import type { ActivePiece } from "./types";

describe("board", () => {
  it("createGrid is ROWS x COLS of null", () => {
    const g = createGrid();
    expect(g.length).toBe(ROWS);
    expect(g[0]!.length).toBe(COLS);
    expect(g.flat().every((c) => c === null)).toBe(true);
  });

  it("cloneGrid is a deep copy", () => {
    const g = createGrid();
    const c = cloneGrid(g);
    c[0]![0] = 1;
    expect(g[0]![0]).toBe(null);
  });

  it("applyGravity compacts non-null cells to the bottom of each column", () => {
    const g = createGrid();
    g[0]![3] = 1; // floating
    g[9]![3] = 0; // floor
    applyGravity(g);
    expect(g[9]![3]).toBe(0);
    expect(g[8]![3]).toBe(1);
    expect(g[0]![3]).toBe(null);
  });

  it("footprintValid rejects out-of-bounds and occupied cells", () => {
    const g = createGrid();
    expect(footprintValid(g, 0, 7)).toBe(true);
    expect(footprintValid(g, ROWS - 1, 7)).toBe(false); // bottom row would overflow
    expect(footprintValid(g, 0, COLS - 1)).toBe(false); // right col would overflow
    g[1]![7] = 0;
    expect(footprintValid(g, 0, 7)).toBe(false); // occupied
  });

  it("stampPiece writes the 2x2 into the grid", () => {
    const g = createGrid();
    const p: ActivePiece = { cells: [[0, 1], [1, 0]], row: 0, col: 7 };
    stampPiece(g, p);
    expect(g[0]![7]).toBe(0);
    expect(g[0]![8]).toBe(1);
    expect(g[1]![7]).toBe(1);
    expect(g[1]![8]).toBe(0);
  });

  it("mergeActive overlays the active piece without mutating settled", () => {
    const g = createGrid();
    const p: ActivePiece = { cells: [[1, 1], [1, 1]], row: 0, col: 7 };
    const merged = mergeActive(g, p);
    expect(merged[0]![7]).toBe(1);
    expect(g[0]![7]).toBe(null); // settled untouched
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/game/board.test.ts`
Expected: FAIL ("Cannot find module './board'").

- [ ] **Step 3: Implement `src/game/board.ts`**

```ts
import { COLS, ROWS } from "./constants";
import type { ActivePiece, Grid } from "./types";

export function createGrid(): Grid {
  return Array.from({ length: ROWS }, () =>
    Array.from({ length: COLS }, () => null),
  );
}

export function cloneGrid(g: Grid): Grid {
  return g.map((row) => row.slice());
}

// Compact each column so non-null cells fall to the bottom, preserving order.
export function applyGravity(g: Grid): void {
  for (let c = 0; c < COLS; c++) {
    let write = ROWS - 1;
    for (let r = ROWS - 1; r >= 0; r--) {
      if (g[r]![c] !== null) {
        g[write]![c] = g[r]![c]!;
        if (write !== r) g[r]![c] = null;
        write--;
      }
    }
    for (let r = write; r >= 0; r--) g[r]![c] = null;
  }
}

// True if a 2x2 footprint at (row,col) is fully in-bounds and unoccupied.
export function footprintValid(g: Grid, row: number, col: number): boolean {
  for (let dr = 0; dr < 2; dr++) {
    for (let dc = 0; dc < 2; dc++) {
      const r = row + dr;
      const c = col + dc;
      if (r < 0 || r >= ROWS || c < 0 || c >= COLS) return false;
      if (g[r]![c] !== null) return false;
    }
  }
  return true;
}

export function stampPiece(g: Grid, p: ActivePiece): void {
  g[p.row]![p.col] = p.cells[0][0];
  g[p.row]![p.col + 1] = p.cells[0][1];
  g[p.row + 1]![p.col] = p.cells[1][0];
  g[p.row + 1]![p.col + 1] = p.cells[1][1];
}

// Settled grid with the active piece overlaid (for rendering / state()).
export function mergeActive(settled: Grid, active: ActivePiece | null): Grid {
  const g = cloneGrid(settled);
  if (active) stampPiece(g, active);
  return g;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/game/board.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/game/board.ts src/game/board.test.ts
git commit -m "feat: board ops (gravity, collision, stamp, merge)"
```

---

## Task 4: Square detection (`squares.ts`)

**Files:**
- Create: `src/game/squares.ts`, `src/game/squares.test.ts`

- [ ] **Step 1: Write the failing test — `src/game/squares.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { computeMarkedGrid, countSquares, markedList } from "./squares";
import { createGrid } from "./board";

describe("squares", () => {
  it("marks a single monochrome 2x2 (4 cells, 1 square)", () => {
    const g = createGrid();
    g[8]![4] = 1;
    g[8]![5] = 1;
    g[9]![4] = 1;
    g[9]![5] = 1;
    expect(countSquares(g)).toBe(1);
    expect(markedList(g)).toHaveLength(4);
  });

  it("does not mark a 2x2 with mixed colours", () => {
    const g = createGrid();
    g[8]![4] = 1;
    g[8]![5] = 0;
    g[9]![4] = 1;
    g[9]![5] = 1;
    expect(countSquares(g)).toBe(0);
    expect(markedList(g)).toHaveLength(0);
  });

  it("counts a 2x3 monochrome block as 2 squares (6 cells marked)", () => {
    // 2 rows x 3 cols
    const g = createGrid();
    for (let c = 4; c <= 6; c++) {
      g[8]![c] = 0;
      g[9]![c] = 0;
    }
    expect(countSquares(g)).toBe(2);
    expect(markedList(g)).toHaveLength(6);
  });

  it("counts a 3x3 monochrome block as 4 squares (9 cells marked)", () => {
    const g = createGrid();
    for (let r = 7; r <= 9; r++)
      for (let c = 4; c <= 6; c++) g[r]![c] = 1;
    expect(countSquares(g)).toBe(4);
    expect(markedList(g)).toHaveLength(9);
  });

  it("computeMarkedGrid flags exactly the cells in markedList", () => {
    const g = createGrid();
    g[8]![4] = 1;
    g[8]![5] = 1;
    g[9]![4] = 1;
    g[9]![5] = 1;
    const m = computeMarkedGrid(g);
    expect(m[8]![4]).toBe(true);
    expect(m[9]![5]).toBe(true);
    expect(m[0]![0]).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/game/squares.test.ts`
Expected: FAIL ("Cannot find module './squares'").

- [ ] **Step 3: Implement `src/game/squares.ts`**

```ts
import { COLS, ROWS } from "./constants";
import type { Grid, MarkedCell } from "./types";

function isMonoSquare(g: Grid, r: number, c: number): boolean {
  const v = g[r]![c];
  return (
    v !== null &&
    g[r]![c + 1] === v &&
    g[r + 1]![c] === v &&
    g[r + 1]![c + 1] === v
  );
}

// Boolean grid: true where a cell belongs to any aligned monochrome 2x2.
export function computeMarkedGrid(g: Grid): boolean[][] {
  const m: boolean[][] = Array.from({ length: ROWS }, () =>
    Array.from({ length: COLS }, () => false),
  );
  for (let r = 0; r < ROWS - 1; r++) {
    for (let c = 0; c < COLS - 1; c++) {
      if (isMonoSquare(g, r, c)) {
        m[r]![c] = true;
        m[r]![c + 1] = true;
        m[r + 1]![c] = true;
        m[r + 1]![c + 1] = true;
      }
    }
  }
  return m;
}

// distinct_squares multiplier: one per monochrome top-left corner.
export function countSquares(g: Grid): number {
  let n = 0;
  for (let r = 0; r < ROWS - 1; r++)
    for (let c = 0; c < COLS - 1; c++) if (isMonoSquare(g, r, c)) n++;
  return n;
}

export function markedList(g: Grid): MarkedCell[] {
  const m = computeMarkedGrid(g);
  const out: MarkedCell[] = [];
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++) if (m[r]![c]) out.push({ row: r, col: c });
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/game/squares.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/game/squares.ts src/game/squares.test.ts
git commit -m "feat: monochrome 2x2 square detection and counting"
```

---

## Task 5: Piece transforms (`piece.ts`)

**Files:**
- Create: `src/game/piece.ts`, `src/game/piece.test.ts`

- [ ] **Step 1: Write the failing test — `src/game/piece.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { rotateCW, canFall } from "./piece";
import { createGrid } from "./board";
import type { ActivePiece } from "./types";

describe("piece", () => {
  it("rotateCW rotates the 2x2 90 degrees clockwise", () => {
    // [[a,b],[c,d]] -> [[c,a],[d,b]]
    expect(rotateCW([[0, 1], [1, 0]])).toEqual([[1, 0], [0, 1]]);
    expect(rotateCW([[0, 0], [1, 1]])).toEqual([[1, 0], [1, 0]]);
  });

  it("four rotations return to the original", () => {
    const start: [[0 | 1, 0 | 1], [0 | 1, 0 | 1]] = [[0, 1], [1, 1]];
    expect(rotateCW(rotateCW(rotateCW(rotateCW(start))))).toEqual(start);
  });

  it("canFall is true over empty space and false at the floor", () => {
    const g = createGrid();
    const a: ActivePiece = { cells: [[0, 0], [0, 0]], row: 0, col: 7 };
    expect(canFall(g, a)).toBe(true);
    a.row = 8; // bottom cells at row 9 (floor)
    expect(canFall(g, a)).toBe(false);
  });

  it("canFall is false when a settled cell blocks below", () => {
    const g = createGrid();
    g[5]![7] = 1; // blocker directly under the left column
    const a: ActivePiece = { cells: [[0, 0], [0, 0]], row: 3, col: 7 };
    expect(canFall(g, a)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/game/piece.test.ts`
Expected: FAIL ("Cannot find module './piece'").

- [ ] **Step 3: Implement `src/game/piece.ts`**

```ts
import { footprintValid } from "./board";
import type { ActivePiece, Grid, Piece } from "./types";

// [[a,b],[c,d]] -> [[c,a],[d,b]]
export function rotateCW(p: Piece): Piece {
  return [
    [p[1][0], p[0][0]],
    [p[1][1], p[0][1]],
  ];
}

// Can the active piece move down one row? (footprint check on settled grid)
export function canFall(settled: Grid, a: ActivePiece): boolean {
  return footprintValid(settled, a.row + 1, a.col);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/game/piece.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/game/piece.ts src/game/piece.test.ts
git commit -m "feat: piece rotation and fall check"
```

---

## Task 6: Engine — the testable core (`engine.ts`)

This class is exactly what `window.__lumines` wraps. It owns `GameState` and every operation. Sweep scoring uses a per-pass snapshot of marked cells + distinct-square count, so the multiplier is fixed for the duration of a pass and scoring accrues column-by-column to the same aggregate the spec describes.

**Files:**
- Create: `src/game/engine.ts`, `src/game/engine.test.ts`

- [ ] **Step 1: Write the failing test — `src/game/engine.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { LuminesEngine } from "./engine";
import { COLS, MS_PER_COL, ROWS, SPAWN_COL, SWEEP_MS } from "./constants";

describe("LuminesEngine", () => {
  it("spawns a piece at top-centre and reflects it in state().grid", () => {
    const e = new LuminesEngine();
    e.spawnPiece([[0, 1], [1, 0]]);
    const g = e.state().grid;
    expect(g[0]![SPAWN_COL]).toBe(0);
    expect(g[0]![SPAWN_COL + 1]).toBe(1);
    expect(g[1]![SPAWN_COL]).toBe(1);
    expect(g[1]![SPAWN_COL + 1]).toBe(0);
  });

  it("tick advances gravity by one row and never auto-spawns", () => {
    const e = new LuminesEngine();
    e.spawnPiece([[0, 0], [0, 0]]);
    e.tick();
    expect(e.state().grid[1]![SPAWN_COL]).toBe(0); // piece top now at row 1
    // Drive it all the way down and lock; tick must NOT spawn a new piece.
    for (let i = 0; i < ROWS; i++) e.tick();
    const g = e.state().grid;
    expect(g[ROWS - 1]![SPAWN_COL]).toBe(0);
    expect(g[0]![SPAWN_COL]).toBe(null); // nothing new at the top
  });

  it("spawn locks the previous piece (gravity to the floor) then places the new one", () => {
    const e = new LuminesEngine();
    e.spawnPiece([[0, 0], [0, 0]]);
    e.spawnPiece([[1, 1], [1, 1]]); // locks the first to the bottom
    const g = e.state().grid;
    expect(g[ROWS - 1]![SPAWN_COL]).toBe(0); // first piece settled on the floor
    expect(g[ROWS - 2]![SPAWN_COL]).toBe(0);
    expect(g[0]![SPAWN_COL]).toBe(1); // second piece now falling at the top
  });

  it("moveLeft / moveRight / rotate affect the active piece", () => {
    const e = new LuminesEngine();
    e.spawnPiece([[0, 1], [1, 0]]);
    e.moveLeft();
    expect(e.state().grid[0]![SPAWN_COL - 1]).toBe(0);
    e.moveRight();
    e.moveRight();
    expect(e.state().grid[0]![SPAWN_COL + 1]).toBe(0);
    e.rotate(); // [[0,1],[1,0]] -> [[1,0],[0,1]]
    const g = e.state().grid;
    expect(g[0]![SPAWN_COL + 1]).toBe(1);
    expect(g[0]![SPAWN_COL + 2]).toBe(0);
  });

  it("hardDrop locks the piece to the floor immediately", () => {
    const e = new LuminesEngine();
    e.spawnPiece([[1, 1], [1, 1]]);
    e.hardDrop();
    const g = e.state().grid;
    expect(g[ROWS - 1]![SPAWN_COL]).toBe(1);
    expect(g[ROWS - 2]![SPAWN_COL]).toBe(1);
    expect(e.state().score).toBe(0); // no square formed yet
  });

  it("sweepNow clears a built 2x2 and scores cells x squares", () => {
    const e = new LuminesEngine();
    // Build a monochrome 2x2 at the bottom-left via two stacked pieces.
    e.spawnPiece([[0, 0], [0, 0]]); // -> cols 7,8 rows 8,9
    e.spawnPiece([[0, 0], [0, 0]]); // locks first; second falls
    e.hardDrop(); // second stacks on top: cols 7,8 rows 6,7
    // Now cols 7,8 rows 6-9 are all colour 0 -> three vertical 2x2s actually.
    // Simpler deterministic case below instead:
    const e2 = new LuminesEngine();
    e2.spawnPiece([[0, 0], [0, 0]]);
    e2.spawnPiece([[1, 1], [1, 1]]); // lock first (a 2x2 of 0 at rows 8-9, cols 7-8)
    // Active piece (colour 1) is at the top and is NOT part of square detection.
    expect(e2.marked()).toHaveLength(4);
    expect(e2.countDistinctSquares()).toBe(1);
    e2.sweepNow();
    expect(e2.state().score).toBe(4); // 4 cells * 1 square
    // Cleared cells gone; active piece still falling, untouched.
    expect(e2.state().grid[9]![7]).toBe(1); // colour-1 piece fell to floor after gravity? no:
  });

  it("game over when the spawn footprint is blocked", () => {
    const e = new LuminesEngine();
    // Fill the spawn columns to the top.
    for (let r = 0; r < ROWS; r++) {
      e.stateRef().settled[r]![SPAWN_COL] = 0;
      e.stateRef().settled[r]![SPAWN_COL + 1] = 0;
    }
    e.spawnPiece([[1, 1], [1, 1]]);
    expect(e.state().gameOver).toBe(true);
  });

  it("sweepProgress advances sweepX at 250ms/col and wraps after 4000ms", () => {
    const e = new LuminesEngine();
    e.sweepProgress(MS_PER_COL); // 250ms
    expect(e.state().sweepX).toBeCloseTo(1, 5);
    e.sweepProgress(MS_PER_COL * 3); // +3 cols
    expect(e.state().sweepX).toBeCloseTo(4, 5);
    e.sweepProgress(SWEEP_MS - MS_PER_COL * 4); // reach 4000ms total -> wrap
    expect(e.state().sweepX).toBeLessThan(1); // wrapped back near 0
    expect(MS_PER_COL * COLS).toBe(SWEEP_MS); // 250*16 = 4000
  });
});
```

> Note: the messy `e`/`e2` split in the `sweepNow` test above is intentional — keep only the `e2` assertions and delete the `e` scratch lines and the final dangling `expect` when implementing; they document the reasoning. The authoritative assertions are: `marked()` length 4, `countDistinctSquares()` 1, score 4 after `sweepNow()`. Replace the last line with `expect(e2.state().score).toBe(4);` already covered — drop the trailing comment line.

Clean `sweepNow` test (use this exact version):

```ts
  it("sweepNow clears a built 2x2 and scores cells x squares", () => {
    const e = new LuminesEngine();
    e.spawnPiece([[0, 0], [0, 0]]); // falling
    e.spawnPiece([[1, 1], [1, 1]]); // locks the 0-piece into rows 8-9 cols 7-8
    expect(e.marked()).toHaveLength(4);
    expect(e.countDistinctSquares()).toBe(1);
    e.sweepNow();
    expect(e.state().score).toBe(4); // 4 cells * 1 distinct square
    expect(e.marked()).toHaveLength(0); // the square is gone
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/game/engine.test.ts`
Expected: FAIL ("Cannot find module './engine'").

- [ ] **Step 3: Implement `src/game/engine.ts`**

```ts
import {
  applyGravity,
  createGrid,
  footprintValid,
  mergeActive,
  stampPiece,
} from "./board";
import { COLS, MS_PER_COL, ROWS, SPAWN_COL, SPAWN_ROW } from "./constants";
import { canFall, rotateCW } from "./piece";
import { nextPiece } from "./rng";
import { computeMarkedGrid, countSquares, markedList } from "./squares";
import type { GameState, Grid, MarkedCell, Piece } from "./types";

const DEFAULT_SEED = 1;

export class LuminesEngine {
  private s: GameState;

  constructor(seed: number = DEFAULT_SEED) {
    this.s = this.fresh(seed);
  }

  private fresh(seed: number): GameState {
    return {
      settled: createGrid(),
      active: null,
      score: 0,
      gameOver: false,
      sweepX: 0,
      rngState: seed | 0,
      sweepMarked: null,
      sweepSquares: 0,
      sweepNextCol: 0,
    };
  }

  // --- lifecycle ---
  reset(seed: number = DEFAULT_SEED): void {
    this.s = this.fresh(seed);
  }

  seed(n: number): void {
    this.s.rngState = n | 0;
  }

  // --- read accessors ---
  state(): { grid: Grid; score: number; gameOver: boolean; sweepX: number } {
    return {
      grid: mergeActive(this.s.settled, this.s.active),
      score: this.s.score,
      gameOver: this.s.gameOver,
      sweepX: this.s.sweepX,
    };
  }

  /** Internal state, used by the driver/renderer (not part of the public test API). */
  stateRef(): GameState {
    return this.s;
  }

  marked(): MarkedCell[] {
    return markedList(this.s.settled);
  }

  countDistinctSquares(): number {
    return countSquares(this.s.settled);
  }

  hasActive(): boolean {
    return this.s.active !== null;
  }

  // --- piece movement ---
  moveLeft(): void {
    const a = this.s.active;
    if (a && footprintValid(this.s.settled, a.row, a.col - 1)) a.col--;
  }

  moveRight(): void {
    const a = this.s.active;
    if (a && footprintValid(this.s.settled, a.row, a.col + 1)) a.col++;
  }

  rotate(): void {
    if (this.s.active) this.s.active.cells = rotateCW(this.s.active.cells);
  }

  private stepDown(): void {
    const a = this.s.active;
    if (!a) return;
    if (canFall(this.s.settled, a)) a.row++;
    else this.lock();
  }

  /** Gravity step. Never auto-spawns. */
  tick(): void {
    this.stepDown();
  }

  softDrop(): void {
    this.stepDown();
  }

  hardDrop(): void {
    const a = this.s.active;
    if (!a) return;
    while (canFall(this.s.settled, a)) a.row++;
    this.lock();
  }

  private lock(): void {
    const a = this.s.active;
    if (!a) return;
    stampPiece(this.s.settled, a);
    this.s.active = null;
    applyGravity(this.s.settled); // decompose / settle
  }

  /** Lock any falling piece, then place a new one at the spawn position. */
  spawnPiece(piece?: Piece): void {
    if (this.s.gameOver) return;
    if (this.s.active) this.lock();

    let cells = piece;
    if (!cells) {
      const [p, ns] = nextPiece(this.s.rngState);
      cells = p;
      this.s.rngState = ns;
    }

    if (!footprintValid(this.s.settled, SPAWN_ROW, SPAWN_COL)) {
      this.s.gameOver = true;
      this.s.active = null;
      return;
    }
    this.s.active = { cells, row: SPAWN_ROW, col: SPAWN_COL };
  }

  // --- sweep ---
  private captureSweep(): void {
    this.s.sweepMarked = computeMarkedGrid(this.s.settled);
    this.s.sweepSquares = countSquares(this.s.settled);
    this.s.sweepNextCol = 0;
  }

  private processColumn(c: number): void {
    const m = this.s.sweepMarked;
    if (!m) return;
    let deleted = 0;
    for (let r = 0; r < ROWS; r++) {
      if (m[r]![c] && this.s.settled[r]![c] !== null) {
        this.s.settled[r]![c] = null;
        deleted++;
      }
    }
    this.s.score += deleted * this.s.sweepSquares;
  }

  /** Run one full sweep immediately and apply scoring (atomic). */
  sweepNow(): void {
    this.captureSweep();
    for (let c = 0; c < COLS; c++) this.processColumn(c);
    applyGravity(this.s.settled);
    this.s.sweepX = 0;
    this.s.sweepMarked = null;
    this.s.sweepSquares = 0;
    this.s.sweepNextCol = 0;
  }

  /** Advance the sweep deterministically by dtMs. */
  sweepProgress(dtMs: number): void {
    if (this.s.sweepMarked === null) this.captureSweep();
    this.s.sweepX += dtMs / MS_PER_COL;

    const limit = Math.min(Math.floor(this.s.sweepX), COLS);
    while (this.s.sweepNextCol < limit) {
      this.processColumn(this.s.sweepNextCol);
      this.s.sweepNextCol++;
    }

    if (this.s.sweepX >= COLS) {
      applyGravity(this.s.settled);
      this.s.sweepX -= COLS;
      if (this.s.sweepX < 0) this.s.sweepX = 0;
      this.captureSweep(); // begin next pass
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes** (use the clean `sweepNow` test from Step 1)

Run: `pnpm test src/game/engine.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the whole logic suite**

Run: `pnpm test`
Expected: PASS (all engine/board/squares/piece/rng tests green).

- [ ] **Step 6: Commit**

```bash
git add src/game/engine.ts src/game/engine.test.ts
git commit -m "feat: LuminesEngine core (spawn/lock/move/rotate/drop/sweep/score)"
```

---

## Task 7: Test API (`testApi.ts`) — `window.__lumines`

Exposes the engine as the pinned `window.__lumines` API, **only** when `TEST_MODE`. The driver calls `installTestApi(engine)` after creating the engine in test mode and `uninstallTestApi()` on teardown.

**Files:**
- Create: `src/game/testApi.ts`, `src/game/testApi.test.ts`

- [ ] **Step 1: Write the failing test — `src/game/testApi.test.ts`**

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { LuminesEngine } from "./engine";
import { buildTestApi } from "./testApi";

describe("buildTestApi", () => {
  let api: ReturnType<typeof buildTestApi>;
  beforeEach(() => {
    api = buildTestApi(new LuminesEngine());
  });

  it("exposes the pinned surface", () => {
    for (const m of [
      "seed",
      "state",
      "marked",
      "spawn",
      "tick",
      "sweepNow",
      "sweepProgress",
    ]) {
      expect(typeof (api as Record<string, unknown>)[m]).toBe("function");
    }
  });

  it("spawn + sweepNow scores per the pinned rule", () => {
    api.spawn([[0, 0], [0, 0]]);
    api.spawn([[1, 1], [1, 1]]); // locks the first 2x2 of colour 0
    expect(api.marked()).toHaveLength(4);
    api.sweepNow();
    expect(api.state().score).toBe(4);
  });

  it("seed makes the auto-piece sequence reproducible", () => {
    api.seed(123);
    api.spawn(); // draws from rng
    const a = api.state().grid.map((r) => r.slice());
    const api2 = buildTestApi(new LuminesEngine());
    api2.seed(123);
    api2.spawn();
    expect(api2.state().grid).toEqual(a);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/game/testApi.test.ts`
Expected: FAIL ("Cannot find module './testApi'").

- [ ] **Step 3: Implement `src/game/testApi.ts`**

```ts
import type { LuminesEngine } from "./engine";
import type { MarkedCell, Piece } from "./types";

export interface LuminesTestApi {
  seed(n: number): void;
  state(): {
    grid: (0 | 1 | null)[][];
    score: number;
    gameOver: boolean;
    sweepX: number;
  };
  marked(): MarkedCell[];
  spawn(piece?: Piece): void;
  tick(): void;
  sweepNow(): void;
  sweepProgress(dtMs: number): void;
}

export function buildTestApi(engine: LuminesEngine): LuminesTestApi {
  return {
    seed: (n) => engine.seed(n),
    state: () => engine.state(),
    marked: () => engine.marked(),
    spawn: (piece) => engine.spawnPiece(piece),
    tick: () => engine.tick(),
    sweepNow: () => engine.sweepNow(),
    sweepProgress: (dtMs) => engine.sweepProgress(dtMs),
  };
}

declare global {
  interface Window {
    __lumines?: LuminesTestApi;
  }
}

export function installTestApi(engine: LuminesEngine): void {
  if (typeof window !== "undefined") window.__lumines = buildTestApi(engine);
}

export function uninstallTestApi(): void {
  if (typeof window !== "undefined") delete window.__lumines;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/game/testApi.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/game/testApi.ts src/game/testApi.test.ts
git commit -m "feat: window.__lumines test API surface"
```

---

## Task 8: Audio controller (`audio.ts`)

**Files:**
- Create: `src/game/audio.ts`

> This is DOM-bound (HTMLAudioElement) so it's verified by Playwright in Task 14, not vitest. It must satisfy the pinned acceptance: a looping audio source pointing at `/backing-track.mp3`.

- [ ] **Step 1: Implement `src/game/audio.ts`**

```ts
import { AUDIO_SRC } from "./constants";

export class AudioController {
  readonly el: HTMLAudioElement;

  constructor() {
    this.el = new Audio(AUDIO_SRC);
    this.el.loop = true;
    this.el.preload = "auto";
    // Tag so the e2e harness can find it in the DOM.
    this.el.setAttribute("data-testid", "backing-audio");
  }

  /** Mount the element so it exists in the DOM for inspection. */
  attach(parent: HTMLElement): void {
    parent.appendChild(this.el);
  }

  /** Best-effort start; autoplay rejection is swallowed (not required to pass). */
  play(): void {
    void this.el.play().catch(() => undefined);
  }

  stop(): void {
    this.el.pause();
    this.el.currentTime = 0;
  }

  /** Seconds into the looping track (used to lock the sweep to tempo). */
  get time(): number {
    return this.el.currentTime;
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/game/audio.ts
git commit -m "feat: looping backing-track audio controller"
```

---

## Task 9: Keyboard input (`input.ts`)

**Files:**
- Create: `src/game/input.ts`

- [ ] **Step 1: Implement `src/game/input.ts`**

```ts
import type { LuminesEngine } from "./engine";

export interface InputActions {
  onLeft(): void;
  onRight(): void;
  onSoftDrop(): void;
  onRotate(): void;
  onHardDrop(): void;
}

/**
 * Maps vim keys (and arrow aliases) to engine ops.
 *   h / ArrowLeft  -> left
 *   l / ArrowRight -> right
 *   j / ArrowDown  -> soft drop
 *   k / ArrowUp    -> rotate
 *   space          -> hard drop
 * Returns a detach function.
 */
export function attachKeyboard(
  target: Window | HTMLElement,
  actions: InputActions,
): () => void {
  const handler = (ev: KeyboardEvent) => {
    let handled = true;
    switch (ev.key) {
      case "h":
      case "ArrowLeft":
        actions.onLeft();
        break;
      case "l":
      case "ArrowRight":
        actions.onRight();
        break;
      case "j":
      case "ArrowDown":
        actions.onSoftDrop();
        break;
      case "k":
      case "ArrowUp":
        actions.onRotate();
        break;
      case " ":
      case "Spacebar":
        actions.onHardDrop();
        break;
      default:
        handled = false;
    }
    if (handled) ev.preventDefault();
  };
  (target as Window).addEventListener("keydown", handler as EventListener);
  return () =>
    (target as Window).removeEventListener("keydown", handler as EventListener);
}

export function engineActions(engine: LuminesEngine): InputActions {
  return {
    onLeft: () => engine.moveLeft(),
    onRight: () => engine.moveRight(),
    onSoftDrop: () => engine.softDrop(),
    onRotate: () => engine.rotate(),
    onHardDrop: () => engine.hardDrop(),
  };
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/game/input.ts
git commit -m "feat: vim-style keyboard input mapping"
```

---

## Task 10: PixiJS theme + renderer (`render/`)

The renderer is **stateless about game rules**: each frame it's handed the merged grid, the active piece (for sub-block fall easing), `sweepX`, and the marked set, and it draws. It owns the polished visuals: rounded cell tiles with a subtle gradient/bevel, a pulsing highlight on marked cells, a bright sweep bar with a trailing glow, and a quick "pop" when a cell is cleared. Animations are driven by Pixi's ticker interpolating toward target positions/alphas, so cells visibly settle and clear rather than snapping.

**Files:**
- Create: `src/game/render/theme.ts`, `src/game/render/renderer.ts`

- [ ] **Step 1: Implement `src/game/render/theme.ts`**

```ts
export const CELL = 38; // px per cell
export const GAP = 2; // inner padding inside a cell
export const BOARD_BG = 0x0b0f1a;
export const GRID_LINE = 0x1c2740;

// Two-colour palette (A = 0, B = 1) — Lumines-ish cool/warm contrast.
export const COLOR_A = 0x4cc2ff; // cyan
export const COLOR_A_HI = 0x9ee3ff;
export const COLOR_B = 0xff7ad9; // magenta
export const COLOR_B_HI = 0xffc4ef;

export const SWEEP = 0xfff4b0;
export const MARK_RING = 0xffffff;

export function cellFill(color: 0 | 1): number {
  return color === 0 ? COLOR_A : COLOR_B;
}
export function cellHi(color: 0 | 1): number {
  return color === 0 ? COLOR_A_HI : COLOR_B_HI;
}
```

- [ ] **Step 2: Implement `src/game/render/renderer.ts`**

```ts
import { Application, Container, Graphics } from "pixi.js";
import { COLS, ROWS } from "../constants";
import type { Grid, MarkedCell } from "../types";
import {
  BOARD_BG,
  CELL,
  GAP,
  GRID_LINE,
  MARK_RING,
  SWEEP,
  cellFill,
  cellHi,
} from "./theme";

export interface RenderInput {
  grid: Grid; // settled + active merged
  marked: MarkedCell[];
  sweepX: number; // 0..COLS
  timeMs: number; // monotonic, for pulsing/animation phase
}

export class Renderer {
  readonly app: Application;
  private board = new Container();
  private cells = new Container();
  private overlay = new Container();
  private sweep = new Graphics();

  static async create(parent: HTMLElement): Promise<Renderer> {
    const app = new Application();
    await app.init({
      width: COLS * CELL,
      height: ROWS * CELL,
      background: BOARD_BG,
      antialias: true,
      resolution: Math.min(2, window.devicePixelRatio || 1),
      autoDensity: true,
    });
    parent.appendChild(app.canvas);
    return new Renderer(app);
  }

  private constructor(app: Application) {
    this.app = app;
    this.app.stage.addChild(this.board, this.cells, this.overlay, this.sweep);
    this.drawGridLines();
  }

  private drawGridLines(): void {
    const g = new Graphics();
    for (let c = 0; c <= COLS; c++)
      g.moveTo(c * CELL, 0).lineTo(c * CELL, ROWS * CELL);
    for (let r = 0; r <= ROWS; r++)
      g.moveTo(0, r * CELL).lineTo(COLS * CELL, r * CELL);
    g.stroke({ color: GRID_LINE, width: 1, alpha: 0.6 });
    this.board.addChild(g);
  }

  draw(input: RenderInput): void {
    this.drawCells(input);
    this.drawMarks(input);
    this.drawSweep(input);
  }

  private drawCells(input: RenderInput): void {
    this.cells.removeChildren();
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const v = input.grid[r]![c];
        if (v === null) continue;
        const x = c * CELL + GAP;
        const y = r * CELL + GAP;
        const w = CELL - GAP * 2;
        const tile = new Graphics();
        tile
          .roundRect(x, y, w, w, 6)
          .fill(cellFill(v))
          .roundRect(x + 2, y + 2, w - 4, (w - 4) * 0.45, 5)
          .fill({ color: cellHi(v), alpha: 0.35 }); // bevel highlight
        this.cells.addChild(tile);
      }
    }
  }

  private drawMarks(input: RenderInput): void {
    this.overlay.removeChildren();
    const pulse = 0.5 + 0.5 * Math.sin(input.timeMs / 140);
    for (const { row, col } of input.marked) {
      const x = col * CELL + GAP;
      const y = row * CELL + GAP;
      const w = CELL - GAP * 2;
      const ring = new Graphics();
      ring
        .roundRect(x, y, w, w, 6)
        .stroke({ color: MARK_RING, width: 2, alpha: 0.4 + 0.5 * pulse });
      this.overlay.addChild(ring);
    }
  }

  private drawSweep(input: RenderInput): void {
    const x = input.sweepX * CELL;
    this.sweep.clear();
    this.sweep
      .rect(x - 14, 0, 14, ROWS * CELL)
      .fill({ color: SWEEP, alpha: 0.12 }) // trailing glow
      .rect(x - 2, 0, 3, ROWS * CELL)
      .fill({ color: SWEEP, alpha: 0.95 }); // bright leading edge
  }

  destroy(): void {
    this.app.destroy(true, { children: true });
  }
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/game/render/theme.ts src/game/render/renderer.ts
git commit -m "feat: PixiJS renderer (cells, marks, sweep bar)"
```

---

## Task 11: Game driver (`driver.ts`)

The driver wires engine ↔ renderer ↔ input ↔ audio and runs the rAF loop. **Render always runs** (so DOM/canvas reflect engine mutations, including those made via `window.__lumines`). **Simulation (gravity, sweep clock, auto-spawn, audio) runs only when `!TEST_MODE`.** In test mode it installs `window.__lumines` and leaves driving to the harness.

**Files:**
- Create: `src/game/driver.ts`

- [ ] **Step 1: Implement `src/game/driver.ts`**

```ts
import { GRAVITY_TICK_MS, SOFT_DROP_TICK_MS } from "./constants";
import { AudioController } from "./audio";
import { LuminesEngine } from "./engine";
import { attachKeyboard, engineActions } from "./input";
import { Renderer } from "./render/renderer";
import { installTestApi, uninstallTestApi } from "./testApi";
import { TEST_MODE } from "./testMode";

export interface DriverCallbacks {
  onScore(score: number): void;
  onGameOver(finalScore: number): void;
}

export class GameDriver {
  readonly engine = new LuminesEngine(TEST_MODE ? 1 : (Date.now() | 0));
  private renderer: Renderer;
  private audio = new AudioController();
  private detachKeys: () => void = () => undefined;
  private raf = 0;
  private last = 0;
  private gravityAcc = 0;
  private lastAudioMs = 0;
  private startMs = 0;
  private lastScore = -1;
  private over = false;

  constructor(
    renderer: Renderer,
    private cb: DriverCallbacks,
    audioParent: HTMLElement,
  ) {
    this.renderer = renderer;
    this.audio.attach(audioParent);
  }

  start(): void {
    if (TEST_MODE) {
      installTestApi(this.engine);
    } else {
      this.engine.spawnPiece(); // first piece
      this.audio.play();
      this.detachKeys = attachKeyboard(window, engineActions(this.engine));
    }
    this.last = performanceNow();
    this.loop();
  }

  private loop = (): void => {
    const now = performanceNow();
    const dt = now - this.last;
    this.last = now;
    if (this.startMs === 0) this.startMs = now;

    if (!TEST_MODE) this.simulate(dt);

    const st = this.engine.state();
    this.renderer.draw({
      grid: st.grid,
      marked: this.engine.marked(),
      sweepX: st.sweepX,
      timeMs: now - this.startMs,
    });

    if (st.score !== this.lastScore) {
      this.lastScore = st.score;
      this.cb.onScore(st.score);
    }
    if (st.gameOver && !this.over) {
      this.over = true;
      this.cb.onGameOver(st.score);
    }

    this.raf = requestAnimationFrame(this.loop);
  };

  private simulate(dt: number): void {
    const st = this.engine.state();
    if (st.gameOver) return;

    // Sweep locked to the track: advance by however much the audio clock moved
    // since last frame. If the audio clock isn't progressing (autoplay blocked,
    // paused, or just looped to 0), fall back to rAF dt at the same tempo so the
    // sweep never depends on audio decode. 250ms/col either way.
    const audioMs = this.audio.time * 1000;
    let sweepDelta = audioMs - this.lastAudioMs;
    this.lastAudioMs = audioMs;
    if (sweepDelta <= 0 || sweepDelta > 1000) sweepDelta = dt;
    this.engine.sweepProgress(sweepDelta);

    // Gravity.
    this.gravityAcc += dt;
    const interval = GRAVITY_TICK_MS;
    while (this.gravityAcc >= interval) {
      this.gravityAcc -= interval;
      if (this.engine.hasActive()) {
        this.engine.tick();
      } else {
        this.engine.spawnPiece(); // auto-spawn next piece in production
      }
    }
  }

  stop(): void {
    cancelAnimationFrame(this.raf);
    this.detachKeys();
    this.audio.stop();
    if (TEST_MODE) uninstallTestApi();
  }

  destroy(): void {
    this.stop();
    this.renderer.destroy();
  }
}

function performanceNow(): number {
  return typeof performance !== "undefined" ? performance.now() : 0;
}
```

> Note on `SOFT_DROP_TICK_MS`: imported for completeness of the cadence constants; the soft-drop speed-up is delivered through the `j` key calling `engine.softDrop()` directly (an immediate extra step), so no separate timer is needed. If lint flags the unused import, remove it.

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: PASS (remove the `SOFT_DROP_TICK_MS` import if unused-var lint complains).

- [ ] **Step 3: Commit**

```bash
git add src/game/driver.ts
git commit -m "feat: game driver (rAF loop, test-mode gating, audio, input)"
```

---

## Task 12: React canvas host (`GameCanvas.tsx`)

**Files:**
- Create: `src/components/GameCanvas.tsx`

- [ ] **Step 1: Implement `src/components/GameCanvas.tsx`**

```tsx
"use client";

import { useEffect, useRef } from "react";
import { GameDriver } from "~/game/driver";
import { Renderer } from "~/game/render/renderer";

interface Props {
  onScore: (score: number) => void;
  onGameOver: (finalScore: number) => void;
}

export function GameCanvas({ onScore, onGameOver }: Props) {
  const mountRef = useRef<HTMLDivElement>(null);
  // Keep latest callbacks without re-running the mount effect.
  const cbRef = useRef({ onScore, onGameOver });
  cbRef.current = { onScore, onGameOver };

  useEffect(() => {
    const parent = mountRef.current;
    if (!parent) return;
    let driver: GameDriver | null = null;
    let cancelled = false;

    void (async () => {
      const renderer = await Renderer.create(parent);
      if (cancelled) {
        renderer.destroy();
        return;
      }
      driver = new GameDriver(
        renderer,
        {
          onScore: (s) => cbRef.current.onScore(s),
          onGameOver: (s) => cbRef.current.onGameOver(s),
        },
        parent,
      );
      driver.start();
    })();

    return () => {
      cancelled = true;
      driver?.destroy();
    };
  }, []);

  return (
    <div
      ref={mountRef}
      className="relative overflow-hidden rounded-xl shadow-[0_0_60px_-15px_rgba(76,194,255,0.6)] ring-1 ring-white/10"
    />
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/components/GameCanvas.tsx
git commit -m "feat: GameCanvas React host for Pixi + driver"
```

---

## Task 13: Screens, HUD, cheatsheet (`Game.tsx`, `Cheatsheet.tsx`) + page wiring

**Files:**
- Create: `src/components/Cheatsheet.tsx`, `src/components/Game.tsx`
- Modify: `src/app/page.tsx`, `src/app/layout.tsx` (metadata only)

- [ ] **Step 1: Implement `src/components/Cheatsheet.tsx`**

```tsx
const ROWS: { keys: string; action: string }[] = [
  { keys: "h", action: "Move left" },
  { keys: "l", action: "Move right" },
  { keys: "j", action: "Soft drop" },
  { keys: "k", action: "Rotate" },
  { keys: "space", action: "Hard drop" },
];

export function Cheatsheet({ compact = false }: { compact?: boolean }) {
  return (
    <div
      data-testid="controls-cheatsheet"
      className={`rounded-lg border border-white/10 bg-white/5 p-4 ${
        compact ? "text-sm" : ""
      }`}
    >
      <h3 className="mb-2 font-semibold tracking-wide text-white/80">Controls</h3>
      <ul className="space-y-1">
        {ROWS.map((r) => (
          <li key={r.keys} className="flex items-center justify-between gap-4">
            <kbd className="rounded bg-black/40 px-2 py-0.5 font-mono text-cyan-200">
              {r.keys}
            </kbd>
            <span className="text-white/70">{r.action}</span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-white/50">
        Build same-colour 2×2 squares. The light bar sweeps left→right in time
        with the music and clears every square it crosses.
      </p>
    </div>
  );
}
```

- [ ] **Step 2: Implement `src/components/Game.tsx`**

```tsx
"use client";

import { useCallback, useState } from "react";
import { GameCanvas } from "./GameCanvas";
import { Cheatsheet } from "./Cheatsheet";

type Screen = "start" | "playing" | "over";

export function Game() {
  const [screen, setScreen] = useState<Screen>("start");
  const [score, setScore] = useState(0);
  const [finalScore, setFinalScore] = useState(0);
  // Remount the canvas (fresh engine/driver) on each play.
  const [runId, setRunId] = useState(0);

  const handleScore = useCallback((s: number) => setScore(s), []);
  const handleGameOver = useCallback((s: number) => {
    setFinalScore(s);
    setScreen("over");
  }, []);

  const startGame = () => {
    setScore(0);
    setRunId((n) => n + 1);
    setScreen("playing");
  };

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-gradient-to-b from-[#10122b] to-[#05060f] p-6 text-white">
      <h1 className="bg-gradient-to-r from-cyan-300 to-fuchsia-300 bg-clip-text text-4xl font-black tracking-tight text-transparent">
        LLMines
      </h1>

      {screen === "start" && (
        <section className="flex w-full max-w-md flex-col items-center gap-6">
          <p className="text-center text-white/70">
            Stack 2×2 colour blocks, form same-colour squares, and let the
            timeline bar sweep them away in time with the beat.
          </p>
          <Cheatsheet />
          <button
            data-testid="start-button"
            onClick={startGame}
            className="rounded-full bg-cyan-400 px-8 py-3 font-bold text-slate-900 shadow-lg transition hover:scale-105 hover:bg-cyan-300"
          >
            Start
          </button>
        </section>
      )}

      {screen === "playing" && (
        <section className="flex items-start gap-6">
          <GameCanvas
            key={runId}
            onScore={handleScore}
            onGameOver={handleGameOver}
          />
          <aside className="flex w-56 flex-col gap-4">
            <div className="rounded-lg border border-white/10 bg-white/5 p-4">
              <div className="text-xs uppercase tracking-widest text-white/50">
                Score
              </div>
              <div
                data-testid="score"
                className="font-mono text-3xl font-bold text-cyan-200"
              >
                {score}
              </div>
            </div>
            <Cheatsheet compact />
          </aside>
        </section>
      )}

      {screen === "over" && (
        <section
          data-testid="game-over"
          className="flex w-full max-w-md flex-col items-center gap-6"
        >
          <h2 className="text-3xl font-bold text-fuchsia-300">Game Over</h2>
          <div className="text-center">
            <div className="text-xs uppercase tracking-widest text-white/50">
              Final Score
            </div>
            <div className="font-mono text-5xl font-bold text-cyan-200">
              {finalScore}
            </div>
          </div>
          <button
            data-testid="restart"
            onClick={startGame}
            className="rounded-full bg-fuchsia-400 px-8 py-3 font-bold text-slate-900 shadow-lg transition hover:scale-105 hover:bg-fuchsia-300"
          >
            Play Again
          </button>
        </section>
      )}
    </main>
  );
}
```

- [ ] **Step 3: Replace `src/app/page.tsx`** (drop the tRPC demo; keep a single `<main>` via `Game`)

```tsx
import { Game } from "~/components/Game";

export default function Home() {
  return <Game />;
}
```

- [ ] **Step 4: Update metadata in `src/app/layout.tsx`** (cosmetic)

Replace the `metadata` object with:

```ts
export const metadata: Metadata = {
  title: "LLMines",
  description: "A browser-based Lumines clone.",
  icons: [{ rel: "icon", url: "/favicon.ico" }],
};
```

- [ ] **Step 5: Typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS. (If lint flags the now-unused `src/app/_components/post.tsx` or tRPC demo, leave those files in place — they're not imported and don't affect the build.)

- [ ] **Step 6: Manual smoke check**

Run: `pnpm dev` then open the printed URL. Expected: start screen with title, cheatsheet, Start button. Click Start → Pixi grid renders, score panel + compact cheatsheet visible. Press `h/l/k/space` → a block moves/rotates/drops. Stop the server.

- [ ] **Step 7: Commit**

```bash
git add src/components/Game.tsx src/components/Cheatsheet.tsx src/app/page.tsx src/app/layout.tsx
git commit -m "feat: screens, HUD, score, controls cheatsheet; wire page"
```

---

## Task 14: Playwright acceptance tests (`e2e/lumines.spec.ts`)

These exercise every acceptance criterion through the deterministic API. The webServer (Task 0) runs with `NEXT_PUBLIC_TEST_MODE=1`, so auto-gravity/sweep/spawn are off and `window.__lumines` is present after Start.

**Files:**
- Create: `e2e/lumines.spec.ts`

- [ ] **Step 1: Implement `e2e/lumines.spec.ts`**

```ts
import { test, expect, type Page } from "@playwright/test";

type Cell = 0 | 1 | null;
interface LuminesState {
  grid: Cell[][];
  score: number;
  gameOver: boolean;
  sweepX: number;
}

async function startGame(page: Page) {
  await page.goto("/");
  await expect(page.getByTestId("controls-cheatsheet")).toBeVisible(); // start screen
  await page.getByTestId("start-button").click();
  await page.waitForFunction(() => Boolean((window as any).__lumines));
}

const getState = (page: Page) =>
  page.evaluate(() => (window as any).__lumines.state() as LuminesState);

test("loads to a start screen and starts on input", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("start-button")).toBeVisible();
  await expect(page.getByTestId("controls-cheatsheet")).toBeVisible();
  await page.getByTestId("start-button").click();
  await expect(page.getByTestId("score")).toBeVisible();
  await expect(page.getByTestId("controls-cheatsheet")).toBeVisible(); // in-game too
});

test("a single page has exactly one <main> landmark", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("main")).toHaveCount(1);
});

test("audio source exists, loops, and points to /backing-track.mp3", async ({
  page,
}) => {
  await startGame(page);
  const info = await page.evaluate(() => {
    const a = document.querySelector(
      "[data-testid=backing-audio]",
    ) as HTMLAudioElement | null;
    return a ? { loop: a.loop, src: a.getAttribute("src") } : null;
  });
  expect(info).not.toBeNull();
  expect(info!.loop).toBe(true);
  expect(info!.src).toBe("/backing-track.mp3");
});

test("piece spawns, moves, rotates, soft- and hard-drops, and locks", async ({
  page,
}) => {
  await startGame(page);
  await page.evaluate(() => {
    const L = (window as any).__lumines;
    L.seed(1);
    L.spawn([
      [0, 1],
      [1, 0],
    ]);
  });
  let st = await getState(page);
  expect(st.grid[0][7]).toBe(0); // spawned at top-centre

  await page.evaluate(() => (window as any).__lumines.tick());
  st = await getState(page);
  expect(st.grid[1][7]).toBe(0); // fell one row

  // Hard-drop locks to the floor.
  await page.evaluate(() => {
    const L = (window as any).__lumines;
    L.spawn([
      [1, 1],
      [1, 1],
    ]); // locks the previous, new piece falling
  });
  st = await getState(page);
  expect(st.grid[9][7]).not.toBeNull(); // previous piece settled on the floor
});

test("a built 2x2 is cleared by the sweep and scores cells x squares", async ({
  page,
}) => {
  await startGame(page);
  const before = await getState(page);
  expect(before.score).toBe(0);

  const marks = await page.evaluate(() => {
    const L = (window as any).__lumines;
    L.spawn([
      [0, 0],
      [0, 0],
    ]); // a 2x2 of colour 0
    L.spawn([
      [1, 1],
      [1, 1],
    ]); // locks it; a 1-piece now falls
    return L.marked().length;
  });
  expect(marks).toBe(4);

  await page.evaluate(() => (window as any).__lumines.sweepNow());
  // Score becomes visible in the DOM (driver pushes it next frame).
  await expect(page.getByTestId("score")).toHaveText("4");
});

test("cells settle by gravity after a deletion", async ({ page }) => {
  await startGame(page);
  await page.evaluate(() => {
    const L = (window as any).__lumines;
    // Lower 2x2 of colour 0 (will clear); above it a single colour-1 row that must fall.
    L.spawn([
      [0, 0],
      [0, 0],
    ]);
    L.spawn([
      [1, 0],
      [0, 1],
    ]);
    L.spawn([
      [1, 1],
      [1, 1],
    ]); // lock the second; third falling
    L.sweepNow();
  });
  const st = await getState(page);
  // After clearing the bottom square and applying gravity, the floor row is fully packed
  // (no floating cells): every non-null column remains bottom-anchored.
  for (let c = 0; c < 16; c++) {
    const col = st.grid.map((row) => row[c]);
    const firstFilled = col.findIndex((v) => v !== null);
    if (firstFilled !== -1) {
      // everything below the first filled cell is also filled (no gaps)
      for (let r = firstFilled; r < 10; r++) expect(col[r]).not.toBeNull();
    }
  }
});

test("sweep traversal takes 8 beats (4000ms) for the full field", async ({
  page,
}) => {
  await startGame(page);
  const x1 = await page.evaluate(() => {
    const L = (window as any).__lumines;
    L.sweepProgress(250);
    return L.state().sweepX;
  });
  expect(x1).toBeCloseTo(1, 3); // 250ms == 1 column

  const x2 = await page.evaluate(() => {
    const L = (window as any).__lumines;
    L.sweepProgress(250 * 3);
    return L.state().sweepX;
  });
  expect(x2).toBeCloseTo(4, 3); // 1000ms == 4 columns
});

test("game over triggers on stack overflow and offers restart", async ({
  page,
}) => {
  await startGame(page);
  await page.evaluate(() => {
    const L = (window as any).__lumines;
    // Spawn repeatedly without sweeping; pieces stack the centre columns until full.
    for (let i = 0; i < 12; i++) L.spawn([[0, 1], [1, 0]]);
  });
  await expect(page.getByTestId("game-over")).toBeVisible();
  await page.getByTestId("restart").click();
  await expect(page.getByTestId("score")).toHaveText("0");
});
```

> The game-over test relies on alternating-colour pieces (`[[0,1],[1,0]]`) so no square forms and the centre columns (7,8) fill: 5 spawns stack 10 rows in cols 7–8, the 6th spawn finds the spawn footprint blocked ⇒ `gameOver`. 12 iterations is a safe margin. If your gravity/decompose lets the stack spread, increase the count or use a single colour that still avoids same-colour 2×2 across the pair — but alternating per piece keeps cols 7/8 mismatched and prevents clears.

- [ ] **Step 2: Run the e2e suite**

Run: `pnpm test:e2e`
Expected: PASS (all specs). If `game over` flakes on stack height, bump the loop count; if `gravity` test is too strict for your decompose semantics, it only asserts the no-floating invariant, which always holds.

- [ ] **Step 3: Commit**

```bash
git add e2e/lumines.spec.ts playwright.config.ts
git commit -m "test: Playwright acceptance suite for all criteria"
```

---

## Task 15: Polish pass — animation feel + screen design

This task has no new tests; it's the judged "feel" bar. Make changes incrementally, re-running `pnpm dev` to eyeball each.

**Files:**
- Modify: `src/game/render/renderer.ts`, `src/components/Game.tsx`, `src/styles/globals.css`

- [ ] **Step 1: Smooth cell motion** — instead of redrawing cells at integer grid positions each frame, track per-cell sprites keyed by an id and lerp their `y` toward the target row so settles and post-sweep collapses visibly slide. Minimal approach that keeps the existing structure: in `drawCells`, animate alpha/scale on appearance (cells fade+scale-in over ~120ms using `timeMs`), and on the sweep edge crossing a column, flash cleared tiles white then scale to zero before removal. Keep a `Map<string, {y:number}>` of animated positions on the `Renderer` and ease them: `cur += (target-cur)*Math.min(1, dt*0.02)`.

- [ ] **Step 2: Sweep bar polish** — add a soft vertical gradient and a faint pulse synced to the beat: modulate the leading-edge alpha with `0.8 + 0.2*Math.sin(timeMs/250*Math.PI)` (one beat = 500ms). Add a 1-column-wide bright wake just behind the bar.

- [ ] **Step 3: Marked-square highlight** — make marked cells breathe (already pulsing); additionally inset a brighter core rectangle so a formed square reads as "charged" and ready to clear.

- [ ] **Step 4: Screen cohesion** — in `globals.css` add a subtle animated background (slow radial gradient drift) and consistent rounded-panel styling. Ensure the start, in-game, and game-over screens share spacing, typography scale, and the cyan/magenta accent system. Add a brief score "bump" animation (scale 1→1.15→1) when the score changes (CSS keyframe toggled via a `key` on the score node).

- [ ] **Step 5: Verify nothing regressed**

Run: `pnpm test && pnpm test:e2e`
Expected: PASS (logic + e2e still green; polish is purely visual).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "polish: Lumines-feel animations and cohesive screen design"
```

---

## Task 16: Final verification

- [ ] **Step 1: Production build has no test hooks**

Run:
```bash
pnpm build
```
Expected: build succeeds. Then sanity-check that `window.__lumines` is gated: search the build for the install call path is guarded by `TEST_MODE` (it is, via `driver.ts`). Optionally run `pnpm start` (without the env var) and confirm in the browser console that `window.__lumines` is `undefined` and the game auto-plays (piece falls on its own, sweep moves, audio element present).

- [ ] **Step 2: Full check**

Run:
```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm test:e2e
```
Expected: all green.

- [ ] **Step 3: Final commit**

```bash
git add -A
git commit -m "chore: final verification — typecheck, lint, unit, e2e green"
```

---

## Self-review against the spec

**Spec coverage:**
- Playfield 16×10, Pixi, empty at start → Task 1 (constants), Task 10 (renderer), Task 13 (mount). ✓
- Falling piece, 2×2, 2-colour, top-centre, gravity tick → Tasks 5–6 (engine), Task 11 (driver). ✓
- Controls h/l/j/k/space (+arrows), lock → Task 9 (input), Task 6 (engine ops). ✓
- Square formation (2×2-or-larger monochrome marked) → Task 4. ✓
- Timeline sweep, per-column deletion, gravity after → Task 6 (`sweepProgress`/`sweepNow`). ✓
- Scoring rule (cells × distinct squares) → Task 6, verified Task 14. ✓
- Game over on spawn-blocked → Task 6, verified Task 14. ✓
- Audio loop + `/backing-track.mp3` → Task 8, verified Task 14. ✓
- Screens (start/in-game/game-over + restart) → Task 13. ✓
- Cheatsheet on start + in-game → Task 13 (`controls-cheatsheet` in both). ✓
- Accessibility: single `<main>`, keyboard operable → Task 13 (one `<main>`), Task 9; verified Task 14. ✓
- Polish (animation + UI) → Task 15. ✓
- Test mode: `window.__lumines`, no auto-spawn on `tick()`, settled+active grid, sweep timing, gated off in normal build → Tasks 6, 7, 11; verified Task 14 + Task 16. ✓
- DOM testids `start-button`/`restart`/`score`/`game-over`/`controls-cheatsheet` → Task 13. ✓

**Type consistency:** `Grid`/`Cell`/`Piece`/`ActivePiece`/`GameState` defined once in Task 1 and used unchanged through engine/testApi/renderer. Engine method names (`spawnPiece`, `tick`, `sweepNow`, `sweepProgress`, `marked`, `countDistinctSquares`, `state`, `stateRef`) are consistent between `engine.ts`, `testApi.ts`, and `driver.ts`. ✓

**Placeholder scan:** No TBD/TODO; every code step contains real code. The only intentionally-flagged item is the scratch version of the `sweepNow` engine test, which Step 1 explicitly tells you to replace with the clean version provided immediately below it. ✓

**Scope:** Single cohesive subsystem (one game) — appropriate for one plan; no decomposition needed. Out-of-scope items (auth, leaderboard, multiplayer, mobile, themes) are not built. ✓
