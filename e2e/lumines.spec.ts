import { expect, test, type Page } from "@playwright/test";

type Color = 0 | 1;
type Cell = Color | null;
type Piece = [[Color, Color], [Color, Color]];

/**
 * Local view of the state shape these e2e assertions read. The real
 * `window.__lumines.state()` (declared in src/game/test-api/install.ts) returns
 * a wider `PublicState`; this is a structural subset for convenience. The global
 * `Window.__lumines` augmentation comes from install.ts — not re-declared here,
 * to avoid two conflicting declarations of the same global property.
 */
interface State {
  grid: Cell[][];
  score: number;
  gameOver: boolean;
  sweepX: number;
  hold: { active: boolean; remainingMs: number };
  /** Additive (lumines-grid-and-sweep): distinct completed 2x2 squares. */
  distinctSquares: number;
  /**
   * Additive (Phase 3, render-only): the most recent chain-flood clear — origin
   * chain cell, ordered cleared component (cell + BFS distance), monotonic id.
   */
  lastChainClear?: {
    origin: number;
    cells: { cell: number; dist: number }[];
    id: number;
  };
}

declare global {
  interface Window {
    __lumines?: {
      seed(n: number): void;
      state(): State;
      marked(): { row: number; col: number }[];
      spawn(piece: Piece): void;
      tick(): void;
      sweepNow(): void;
      sweepProgress(dtMs: number): void;
      pressSoftDrop(): void;
      pressHardDrop(): void;
      clockAdvance(dtMs: number): void;
      setSpecial(row: number, col: number): void;
      setTempo(bpm: number): void;
    };
  }
}

const MONO_A: Piece = [
  [0, 0],
  [0, 0],
];

async function getState(page: Page): Promise<State> {
  return page.evaluate(() => window.__lumines!.state());
}

async function api(page: Page, fn: string, ...args: unknown[]): Promise<void> {
  await page.evaluate(
    ([f, a]) => {
      const api = window.__lumines as unknown as Record<
        string,
        (...x: unknown[]) => void
      >;
      api[f as string]!(...(a as unknown[]));
    },
    [fn, args] as const,
  );
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

test("loads to start screen with controls cheatsheet, starts on input", async ({
  page,
}) => {
  await expect(page.getByTestId("start-button")).toBeVisible();
  await expect(page.getByTestId("controls-cheatsheet")).toBeVisible();
  await expect(page.getByTestId("game-over")).toHaveCount(0);

  await page.getByTestId("start-button").click();

  await expect(page.getByTestId("score")).toBeVisible();
  await expect(page.getByTestId("score")).toHaveText("0");
  // controls remain visible in-game
  await expect(page.getByTestId("controls-cheatsheet")).toBeVisible();
});

test("exposes window.__lumines in test mode", async ({ page }) => {
  const hasApi = await page.evaluate(
    () => typeof window.__lumines === "object",
  );
  expect(hasApi).toBe(true);
});

test("spawn places at top-centre; tick advances; tick never auto-spawns", async ({
  page,
}) => {
  await page.getByTestId("start-button").click();
  await api(page, "seed", 1);
  await api(page, "spawn", MONO_A);

  let s = await getState(page);
  expect(s.grid.length).toBe(10);
  expect(s.grid[0]!.length).toBe(16);
  // A freshly spawned piece STAGES ABOVE the field (SPAWN_ROW = -2, so the 2x2
  // occupies rows -2/-1) and is held for one beat before gravity resumes. The
  // grid view only composites IN-FIELD cells (rows 0-9), so right after spawn the
  // staged piece does not appear anywhere in grid rows 0-9.
  expect(s.grid[0]![7]).toBe(null);
  expect(s.grid[1]![7]).toBe(null);
  // freshly spawned: held at the top (new-block hold)
  expect(s.hold.active).toBe(true);

  // first tick lapses the hold in place — no descent yet, still staged above the
  // field, so nothing shows in the grid view.
  await api(page, "tick");
  s = await getState(page);
  expect(s.hold.active).toBe(false);
  expect(s.grid[0]![7]).toBe(null);

  // tick 2: descends to row -1 (cells rows -1/0) — the top-centre cell enters the
  // field at row 0. tick 3: descends to row 0 (cells rows 0/1) — fully in-field,
  // entering at the top centre (cols 7-8).
  await api(page, "tick");
  await api(page, "tick");
  s = await getState(page);
  expect(s.grid[0]![7]).toBe(0);
  expect(s.grid[0]![8]).toBe(0);
  expect(s.grid[1]![7]).toBe(0);
  expect(s.grid[1]![8]).toBe(0);
  expect(s.grid[2]![7]).toBe(null);

  // tick to the floor and beyond — must NOT auto-spawn a new piece
  for (let i = 0; i < 20; i++) await api(page, "tick");
  s = await getState(page);
  // bottom 2x2 settled, and the top is empty (no new piece spawned)
  expect(s.grid[9]![7]).toBe(0);
  expect(s.grid[8]![7]).toBe(0);
  expect(s.grid[0]![7]).toBe(null);
  expect(s.grid[0]![8]).toBe(null);
});

test("keyboard moves and rotates the active piece", async ({ page }) => {
  // Pieces stage ABOVE the field (rows -2/-1) and are held for one beat, so they
  // are not in the grid view (rows 0-9) until they descend. Move/rotate still
  // apply to the staged piece; we assert the result by driving the piece down
  // into the field (one tick lapses the hold, then two ticks bring rows -2 -> 0)
  // and reading the composited grid. `descend()` does exactly that.
  const descend = async () => {
    await api(page, "tick"); // lapse the new-block hold (no descent)
    await api(page, "tick"); // row -2 -> -1 (enters field at row 0)
    await api(page, "tick"); // row -1 -> 0  (fully in-field, rows 0/1)
  };

  await page.getByTestId("start-button").click();

  // Move RIGHT one column while staged -> the piece enters at cols 8-9.
  await api(page, "spawn", [
    [0, 1],
    [0, 1],
  ] as Piece);
  await page.keyboard.press("l"); // move right -> cols 8-9
  await descend();
  let s = await getState(page);
  expect(s.grid[0]![8]).toBe(0);
  expect(s.grid[0]![9]).toBe(1);
  expect(s.grid[1]![8]).toBe(0);
  expect(s.grid[1]![9]).toBe(1);

  // Move right then back left (net cols 7-8) and rotate CW, all while staged.
  // Spawning again locks the previous piece; place it at a column it cannot
  // collide with on entry. rotate CW: [[0,1],[0,1]] -> [[0,0],[1,1]].
  await api(page, "spawn", [
    [0, 1],
    [0, 1],
  ] as Piece);
  await page.keyboard.press("l"); // right -> cols 8-9
  await page.keyboard.press("h"); // back -> cols 7-8
  await page.keyboard.press("k"); // rotate CW -> [[0,0],[1,1]]
  await descend();
  s = await getState(page);
  expect(s.grid[0]![7]).toBe(0);
  expect(s.grid[0]![8]).toBe(0);
  expect(s.grid[1]![7]).toBe(1);
  expect(s.grid[1]![8]).toBe(1);
});

test("a built 2x2 square is cleared by the sweep and scores per the rule", async ({
  page,
}) => {
  await page.getByTestId("start-button").click();
  await api(page, "spawn", MONO_A);
  for (let i = 0; i < 20; i++) await api(page, "tick"); // land the mono-A square

  // square detected
  const marked = await page.evaluate(() => window.__lumines!.marked());
  expect(marked.length).toBe(4);

  await api(page, "sweepNow");
  const s = await getState(page);
  // V2 scoring supersedes: 1 distinct square * 40 = 40, plus the all-clear
  // board-state bonus (10,000) since the board is empty after the clear.
  expect(s.score).toBe(10040);
  // all cleared
  expect(s.grid.flat().every((c) => c === null)).toBe(true);
  await expect(page.getByTestId("score")).toHaveText("10040");
});

test("cells settle by gravity after deletions", async ({ page }) => {
  await page.getByTestId("start-button").click();
  // floor square of A
  await api(page, "spawn", MONO_A);
  for (let i = 0; i < 20; i++) await api(page, "tick");
  // drop B-over-A piece on top: top row B, bottom row A
  await api(page, "spawn", [
    [1, 1],
    [0, 0],
  ] as Piece);
  for (let i = 0; i < 20; i++) await api(page, "tick");

  await api(page, "sweepNow");
  const s = await getState(page);
  // V2 scoring supersedes: 2 distinct squares * 40 = 80, plus the single-colour
  // board-state bonus (1,000) since only the mono-B row remains after the clear.
  expect(s.score).toBe(1080);
  // the floating B row fell to the floor by gravity
  expect(s.grid[9]![7]).toBe(1);
  expect(s.grid[9]![8]).toBe(1);
  expect(s.grid[8]![7]).toBe(null);
});

test("sweep timing: 0.25s per column, 4.0s full traversal", async ({
  page,
}) => {
  await page.getByTestId("start-button").click();
  let s = await getState(page);
  expect(s.sweepX).toBeCloseTo(0, 3);

  await api(page, "sweepProgress", 250);
  s = await getState(page);
  expect(s.sweepX).toBeCloseTo(1, 2);

  await api(page, "sweepProgress", 750); // total 1000ms -> 4 cols
  s = await getState(page);
  expect(s.sweepX).toBeCloseTo(4, 2);

  await api(page, "sweepProgress", 3000); // total 4000ms -> wraps to 0
  s = await getState(page);
  expect(s.sweepX).toBeCloseTo(0, 2);
});

test("game over on stack overflow, restart resets", async ({ page }) => {
  await page.getByTestId("start-button").click();
  // stack mono pieces at centre until a spawn cannot enter
  for (let i = 0; i < 7; i++) {
    await api(page, "spawn", MONO_A).catch(() => undefined);
  }
  await expect(page.getByTestId("game-over")).toBeVisible();
  await expect(page.getByTestId("restart")).toBeVisible();

  await page.getByTestId("restart").click();
  await expect(page.getByTestId("game-over")).toHaveCount(0);
  await expect(page.getByTestId("score")).toHaveText("0");
  const s = await getState(page);
  expect(s.gameOver).toBe(false);
  expect(s.grid.flat().every((c) => c === null)).toBe(true);
});

test("chain clear emits an ordered lastChainClear wavefront payload (Phase 3)", async ({
  page,
}) => {
  const COLS = 16;
  const consoleErrors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text());
  });
  page.on("pageerror", (e) => consoleErrors.push(e.message));

  await page.getByTestId("start-button").click();

  // Build a mono-A 2x2 square at the centre (cols 7-8, rows 8-9).
  await api(page, "spawn", MONO_A);
  for (let i = 0; i < 20; i++) await api(page, "tick");
  // Extend the connected mono-A region one square to the right (cols 9-10).
  await api(page, "spawn", MONO_A);
  await page.keyboard.press("l"); // cols 8-9
  await page.keyboard.press("l"); // cols 9-10
  for (let i = 0; i < 20; i++) await api(page, "tick");

  // Mark a chain special on the left square's bottom-left cell. When the sweep
  // clears that square, the chain floods the whole connected mono-A region.
  await api(page, "setSpecial", 9, 7);

  // Sanity: the connected mono-A strip spans cols 7..10 on the floor.
  let pre = await getState(page);
  for (let c = 7; c <= 10; c++) expect(pre.grid[9]![c]).toBe(0);

  await api(page, "sweepNow");
  const s = await getState(page);

  // The record-only payload is present and describes the cleared component.
  expect(s.lastChainClear).toBeDefined();
  const rec = s.lastChainClear!;
  expect(rec.id).toBeGreaterThanOrEqual(1);
  expect(rec.origin).toBe(9 * COLS + 7); // the chain cell, row 9 col 7

  const distByCell = new Map(rec.cells.map((o) => [o.cell, o.dist]));
  // Origin reported at dist 0.
  expect(distByCell.get(9 * COLS + 7)).toBe(0);
  // The floor cells radiate outward by BFS distance from the origin.
  expect(distByCell.get(9 * COLS + 8)).toBe(1);
  expect(distByCell.get(9 * COLS + 9)).toBe(2);
  expect(distByCell.get(9 * COLS + 10)).toBe(3);
  // Distances are nondecreasing (BFS visit order).
  for (let i = 1; i < rec.cells.length; i++) {
    expect(rec.cells[i]!.dist).toBeGreaterThanOrEqual(rec.cells[i - 1]!.dist);
  }

  // The flood actually cleared the connected mono-A region (deletion unchanged).
  for (let c = 7; c <= 10; c++) expect(s.grid[9]![c]).toBe(null);

  // The wavefront renders without console errors over the animated flash window
  // (the ChainWavefront useFrame loop runs while the flash travels + fades).
  await page.waitForTimeout(300);
  expect(consoleErrors).toEqual([]);
});

test("audio source exists, loops, and points to /backing-track.mp3", async ({
  page,
}) => {
  const audio = page.locator("audio");
  await expect(audio).toHaveCount(1);
  await expect(audio).toHaveJSProperty("loop", true);
  const src = await audio.getAttribute("src");
  expect(src).toContain("/backing-track.mp3");
});
