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
      auth: {
        signIn(identity: { name: string; subject: string }): void;
        signOut(): void;
      };
      endGame(score: number): void;
    };
  }
}

async function signIn(page: Page, name: string, subject: string): Promise<void> {
  await page.evaluate(
    ([n, s]) => window.__lumines!.auth.signIn({ name: n, subject: s }),
    [name, subject] as const,
  );
}

async function signOut(page: Page): Promise<void> {
  await page.evaluate(() => window.__lumines!.auth.signOut());
}

async function endGame(page: Page, score: number): Promise<void> {
  await page.evaluate((s) => window.__lumines!.endGame(s), score);
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
  // piece visible at cols 7-8, rows 0-1, and held at the top (ready-to-place)
  expect(s.grid[0]![7]).toBe(0);
  expect(s.grid[0]![8]).toBe(0);
  expect(s.grid[1]![7]).toBe(0);
  expect(s.hold.active).toBe(true);

  // The first tick lapses the hold beat — the block stays at the top, gravity
  // does not advance it yet.
  await api(page, "tick");
  s = await getState(page);
  expect(s.hold.active).toBe(false);
  expect(s.grid[0]![7]).toBe(0);
  expect(s.grid[1]![7]).toBe(0);

  // Subsequent ticks descend at normal gravity.
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

test("new-block hold: deliberate re-press, no carried-over auto-drop", async ({
  page,
}) => {
  await page.getByTestId("start-button").click();
  await api(page, "seed", 1);

  // (1) A fresh spawn is held at the top until acted upon.
  await api(page, "spawn", MONO_A);
  let s = await getState(page);
  expect(s.hold.active).toBe(true);
  expect(s.hold.remainingMs).toBeGreaterThan(0);
  expect(s.grid[0]![7]).toBe(0); // still at the very top

  // (2) Carried-over hold: NOT calling a press hook keeps it held — the block
  // does not advance on its own beyond what the hold allows.
  s = await getState(page);
  expect(s.hold.active).toBe(true);
  expect(s.grid[2]![7]).toBe(null); // has not fallen

  // (3) A FRESH soft-drop press engages the fall immediately.
  await api(page, "pressSoftDrop");
  s = await getState(page);
  expect(s.hold.active).toBe(false);
  expect(s.grid[0]![7]).toBe(null); // moved off the top row
  expect(s.grid[1]![7]).toBe(0);

  // (4) After the hold lapses on a fresh spawn with no press, the block falls
  // at normal gravity under ticks.
  for (let i = 0; i < 25; i++) await api(page, "tick"); // land the first block
  await api(page, "spawn", MONO_A); // new block — held again
  s = await getState(page);
  expect(s.hold.active).toBe(true);

  await api(page, "tick"); // first tick lapses the hold beat (no descent)
  s = await getState(page);
  expect(s.hold.active).toBe(false);
  expect(s.grid[0]![7]).toBe(0); // still at top after the hold lapses

  await api(page, "tick"); // now normal gravity advances it
  s = await getState(page);
  expect(s.grid[0]![7]).toBe(null);
  expect(s.grid[1]![7]).toBe(0);
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
  // The authoritative HUD score is exact + assertable…
  await expect(page.getByTestId("score")).toHaveText("4");
  // …and a juicy animated score effect fires in the game view on the gain.
  await expect(page.getByTestId("score-fx")).toBeVisible();
  await expect(page.getByTestId("score-fx")).toContainText("4");
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

test("leaderboard renders and is empty before any qualifying game", async ({
  page,
}) => {
  await expect(page.getByTestId("leaderboard")).toBeVisible();
  await expect(page.getByTestId("leaderboard-row")).toHaveCount(0);
});

test("sign in / out reflects in the UI", async ({ page }) => {
  await page.getByTestId("start-button").click();

  // signed out: sign-in affordance, no signed-in chrome
  await expect(page.getByTestId("signin")).toBeVisible();
  await expect(page.getByTestId("user-name")).toHaveCount(0);
  await expect(page.getByTestId("signout")).toHaveCount(0);

  await signIn(page, "Ada Lovelace", "google|ada");
  await expect(page.getByTestId("user-name")).toHaveText("Ada Lovelace");
  await expect(page.getByTestId("signout")).toBeVisible();
  await expect(page.getByTestId("signin")).toHaveCount(0);

  await signOut(page);
  await expect(page.getByTestId("signin")).toBeVisible();
  await expect(page.getByTestId("user-name")).toHaveCount(0);
});

test("signed-in game over submits to Convex; personal best only improves; leaderboard reflects it", async ({
  page,
}) => {
  await page.getByTestId("start-button").click();
  await signIn(page, "Ada", "google|ada");

  // First run: 120 -> written; personal best + leaderboard reflect it.
  await endGame(page, 120);
  await expect(page.getByTestId("game-over")).toBeVisible();
  await expect(page.getByTestId("personal-best")).toHaveText("120");
  const rows = page.getByTestId("leaderboard-row");
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("Ada");
  await expect(rows.first()).toContainText("120");

  // Lower score does NOT lower the personal best.
  await page.getByTestId("restart").click();
  await endGame(page, 50);
  await expect(page.getByTestId("personal-best")).toHaveText("120");
  await expect(page.getByTestId("leaderboard-row").first()).toContainText("120");

  // Higher score raises it and updates the leaderboard.
  await page.getByTestId("restart").click();
  await endGame(page, 200);
  await expect(page.getByTestId("personal-best")).toHaveText("200");
  await expect(page.getByTestId("leaderboard-row").first()).toContainText("200");
  // Still a single row for the one player (one row per user).
  await expect(page.getByTestId("leaderboard-row")).toHaveCount(1);
});

test("a second player joins the global leaderboard, ranked by best", async ({
  page,
}) => {
  await page.getByTestId("start-button").click();

  await signIn(page, "Ada", "google|ada");
  await endGame(page, 80);
  await page.getByTestId("restart").click();

  await signIn(page, "Babbage", "google|babbage");
  await endGame(page, 150);

  const rows = page.getByTestId("leaderboard-row");
  await expect(rows).toHaveCount(2);
  // highest first
  await expect(rows.nth(0)).toContainText("Babbage");
  await expect(rows.nth(0)).toContainText("150");
  await expect(rows.nth(1)).toContainText("Ada");
  await expect(rows.nth(1)).toContainText("80");
});

test("an UNAUTHENTICATED game over is not written to the leaderboard", async ({
  page,
}) => {
  await page.getByTestId("start-button").click();
  // not signed in
  await expect(page.getByTestId("signin")).toBeVisible();

  await endGame(page, 999);
  await expect(page.getByTestId("game-over")).toBeVisible();
  // nothing written
  await expect(page.getByTestId("leaderboard-row")).toHaveCount(0);
});
