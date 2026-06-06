import { expect, test, type Page } from "@playwright/test";

type Color = 0 | 1;
type Cell = Color | null;
type Piece = [[Color, Color], [Color, Color]];
interface State {
  grid: Cell[][];
  score: number;
  gameOver: boolean;
  sweepX: number;
  hold: { active: boolean; remainingMs: number };
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
      auth?: {
        signIn(identity: {
          name: string;
          subject: string;
          avatar?: string;
        }): void;
        signOut(): void;
      };
      endGame?(score: number): void;
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
  // Poll for hydration: the interface is installed in a mount effect, so wait
  // for it rather than reading once immediately after navigation.
  await expect
    .poll(() => page.evaluate(() => typeof window.__lumines))
    .toBe("object");
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
  // piece visible at cols 7-8, rows 0-1, HOLDING at the top
  expect(s.grid[0]![7]).toBe(0);
  expect(s.grid[0]![8]).toBe(0);
  expect(s.grid[1]![7]).toBe(0);
  expect(s.hold.active).toBe(true);

  // first tick lapses the hold (no descent — still at the top)
  await api(page, "tick");
  s = await getState(page);
  expect(s.hold.active).toBe(false);
  expect(s.grid[0]![7]).toBe(0);
  expect(s.grid[1]![7]).toBe(0);

  // the next tick advances one row (normal gravity after the hold)
  await api(page, "tick");
  s = await getState(page);
  expect(s.grid[1]![7]).toBe(0);
  expect(s.grid[2]![7]).toBe(0);
  expect(s.grid[0]![7]).toBe(null);

  // tick to the floor and beyond — must NOT auto-spawn a new piece
  for (let i = 0; i < 20; i++) await api(page, "tick");
  s = await getState(page);
  // bottom 2x2 settled, and the top is empty (no new piece spawned)
  expect(s.grid[9]![7]).toBe(0);
  expect(s.grid[8]![7]).toBe(0);
  expect(s.grid[0]![7]).toBe(null);
  expect(s.grid[0]![8]).toBe(null);
});

test("new block holds on spawn; a carried-over key (no fresh press) does not drop it [US1]", async ({
  page,
}) => {
  await page.getByTestId("start-button").click();
  await api(page, "seed", 1);

  await api(page, "spawn", MONO_A);
  let s = await getState(page);
  expect(s.hold.active).toBe(true);
  expect(s.hold.remainingMs).toBeGreaterThan(0);
  // held at the top
  expect(s.grid[0]![7]).toBe(0);
  expect(s.grid[1]![7]).toBe(0);

  // Carried-over held key is simulated by NOT calling a press hook. A single
  // tick only lapses the hold — it must NOT fast-drop the block.
  await api(page, "tick");
  s = await getState(page);
  expect(s.hold.active).toBe(false);
  expect(s.grid[0]![7]).toBe(0); // still at the top: no auto-drop
  expect(s.grid[1]![7]).toBe(0);

  // Holding across multiple spawns skips no holds: spawning again (locks the
  // previous block) re-arms the hold for the new block.
  await api(page, "spawn", MONO_A);
  s = await getState(page);
  expect(s.hold.active).toBe(true);
});

test("a fresh deliberate press drops the held block immediately [US2]", async ({
  page,
}) => {
  await page.getByTestId("start-button").click();
  await api(page, "seed", 1);

  // fresh soft-drop ends the hold and descends right away
  await api(page, "spawn", MONO_A);
  expect((await getState(page)).hold.active).toBe(true);
  await api(page, "pressSoftDrop");
  let s = await getState(page);
  expect(s.hold.active).toBe(false);
  expect(s.grid[1]![7]).toBe(0); // descended one row
  expect(s.grid[2]![7]).toBe(0);
  expect(s.grid[0]![7]).toBe(null);

  // fresh hard-drop lands on the floor immediately (no hold delay)
  await api(page, "sweepNow"); // clear the board
  await api(page, "spawn", MONO_A);
  await api(page, "pressHardDrop");
  s = await getState(page);
  expect(s.grid[9]![7]).toBe(0);
  expect(s.grid[8]![7]).toBe(0);
});

test("with no fresh press the hold lapses into normal gravity [US3]", async ({
  page,
}) => {
  await page.getByTestId("start-button").click();
  await api(page, "seed", 1);

  await api(page, "spawn", MONO_A);
  expect((await getState(page)).hold.active).toBe(true);

  // one tick lapses the hold (no descent)
  await api(page, "tick");
  let s = await getState(page);
  expect(s.hold.active).toBe(false);
  expect(s.grid[0]![7]).toBe(0);

  // subsequent ticks descend one row each — normal gravity
  await api(page, "tick");
  s = await getState(page);
  expect(s.grid[1]![7]).toBe(0);
  expect(s.grid[0]![7]).toBe(null);
});

test("scoring fires an in-view animation while the score value stays exact [US1]", async ({
  page,
}) => {
  await page.getByTestId("start-button").click();
  await api(page, "seed", 1);

  const fx = page.getByTestId("score-fx");
  // idle before any score: no celebration
  await expect(fx).toHaveAttribute("data-fx-tier", "none");

  // build + clear a single square -> score 4
  await api(page, "spawn", MONO_A);
  for (let i = 0; i < 20; i++) await api(page, "tick");
  await api(page, "sweepNow");

  // a visible effect fires in the game view...
  await expect(fx).toHaveAttribute("data-fx-tier", /modest|big/);
  // ...while the AUTHORITATIVE score stays the exact integer
  await expect(page.getByTestId("score")).toHaveText("4");
  expect((await getState(page)).score).toBe(4);
});

test("bigger clears produce a bigger effect tier [US2]", async ({ page }) => {
  await page.getByTestId("start-button").click();
  await api(page, "seed", 1);
  const fx = page.getByTestId("score-fx");

  // small clear: a single 2x2 square scores 4 -> modest
  await api(page, "spawn", MONO_A);
  for (let i = 0; i < 20; i++) await api(page, "tick");
  await api(page, "sweepNow");
  await expect(fx).toHaveAttribute("data-fx-tier", "modest");
  await expect(fx).toHaveAttribute("data-fx-tier", "none"); // transient

  // big clear: stack B-over-A so a sweep clears two squares (scores 12) -> big
  await api(page, "spawn", MONO_A);
  for (let i = 0; i < 20; i++) await api(page, "tick");
  await api(page, "spawn", [
    [1, 1],
    [0, 0],
  ] as Piece);
  for (let i = 0; i < 20; i++) await api(page, "tick");
  await api(page, "sweepNow");
  await expect(fx).toHaveAttribute("data-fx-tier", "big");
  expect((await getState(page)).score).toBe(16); // 4 + 12
});

test("score effect is transient and non-blocking; restart clears it [US3]", async ({
  page,
}) => {
  await page.getByTestId("start-button").click();
  await api(page, "seed", 1);
  const fx = page.getByTestId("score-fx");

  // cosmetic overlay never blocks input
  await expect(fx).toHaveCSS("pointer-events", "none");

  // score -> effect fires, then auto-clears (transient)
  await api(page, "spawn", MONO_A);
  for (let i = 0; i < 20; i++) await api(page, "tick");
  await api(page, "sweepNow");
  await expect(fx).toHaveAttribute("data-fx-tier", /modest|big/);
  await expect(fx).toHaveAttribute("data-fx-tier", "none");

  // drive to game over, restart -> score resets to 0 with no stale effect
  for (let i = 0; i < 8; i++)
    await api(page, "spawn", MONO_A).catch(() => undefined);
  await page.getByTestId("restart").click();
  await expect(page.getByTestId("score")).toHaveText("0");
  await expect(page.getByTestId("score-fx")).toHaveAttribute(
    "data-fx-tier",
    "none",
  );
});

test("piece settling onto the bottom row lands in-bounds on the correct rows (no out-of-bounds cells)", async ({
  page,
}) => {
  await page.getByTestId("start-button").click();
  await api(page, "seed", 1);

  // --- gravity-settle path: tick a piece all the way to the floor ---
  await api(page, "spawn", MONO_A);
  for (let i = 0; i < 20; i++) await api(page, "tick");
  let s = await getState(page);

  // grid is exactly 10x16 — there is no representation of a row below the floor
  expect(s.grid.length).toBe(10);
  expect(s.grid.every((row) => row.length === 16)).toBe(true);
  // the 2x2 landed on the bottom two rows at its columns
  expect(s.grid[9]![7]).toBe(0);
  expect(s.grid[9]![8]).toBe(0);
  expect(s.grid[8]![7]).toBe(0);
  expect(s.grid[8]![8]).toBe(0);
  // and ONLY those four cells are filled — no stray/out-of-bounds cell anywhere
  const filled = s.grid.flatMap((row, r) =>
    row.flatMap((c, col) => (c !== null ? [[r, col] as const] : [])),
  );
  expect(filled.length).toBe(4);
  for (const [r, col] of filled) {
    expect(r).toBeGreaterThanOrEqual(0);
    expect(r).toBeLessThan(10);
    expect(col).toBeGreaterThanOrEqual(0);
    expect(col).toBeLessThan(16);
  }
  // the block reaches the literal bottom row
  expect(filled.some(([r]) => r === 9)).toBe(true);

  // --- hard-drop path: a hard drop must also lock on the bottom row in-bounds ---
  await api(page, "sweepNow"); // clear the mono square to reset the floor
  s = await getState(page);
  expect(s.grid.flat().every((c) => c === null)).toBe(true);

  await api(page, "spawn", MONO_A);
  await page.keyboard.press(" "); // hard drop
  s = await getState(page);
  expect(s.grid[9]![7]).toBe(0);
  expect(s.grid[9]![8]).toBe(0);
  expect(s.grid[8]![7]).toBe(0);
  expect(s.grid[8]![8]).toBe(0);
  expect(s.grid.flat().filter((c) => c !== null).length).toBe(4);
});

test("keyboard moves and rotates the active piece", async ({ page }) => {
  await page.getByTestId("start-button").click();
  await api(page, "spawn", [
    [0, 1],
    [0, 1],
  ] as Piece);

  await page.keyboard.press("l"); // move right -> cols 8-9
  let s = await getState(page);
  expect(s.grid[0]![8]).toBe(0);
  expect(s.grid[0]![9]).toBe(1);

  await page.keyboard.press("h"); // back to cols 7-8
  s = await getState(page);
  expect(s.grid[0]![7]).toBe(0);
  expect(s.grid[0]![8]).toBe(1);

  // rotate CW: [[0,1],[0,1]] -> [[0,0],[1,1]]
  await page.keyboard.press("k");
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
  expect(s.score).toBe(4); // 4 cells x 1 distinct square
  // all cleared
  expect(s.grid.flat().every((c) => c === null)).toBe(true);
  await expect(page.getByTestId("score")).toHaveText("4");
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
  // the A cells (2 squares over rows 7-9) were cleared: 6 cells x 2 squares
  expect(s.score).toBe(12);
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

test("audio source exists, loops, and points to /backing-track.mp3", async ({
  page,
}) => {
  const audio = page.locator("audio");
  await expect(audio).toHaveCount(1);
  await expect(audio).toHaveJSProperty("loop", true);
  const src = await audio.getAttribute("src");
  expect(src).toContain("/backing-track.mp3");
});
