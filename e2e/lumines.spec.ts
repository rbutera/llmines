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

// `window.__lumines` is declared globally by src/game/test-api/install.ts and is
// in scope here via the project tsconfig; no local re-declaration needed.

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
  // piece visible at cols 7-8, rows 0-1
  expect(s.grid[0]![7]).toBe(0);
  expect(s.grid[0]![8]).toBe(0);
  expect(s.grid[1]![7]).toBe(0);

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

test("landed blocks settle flush on the bottom rows with no out-of-bounds cells", async ({
  page,
}) => {
  const ROWS = 10;
  const COLS = 16;

  await page.getByTestId("start-button").click();
  await api(page, "seed", 1);

  // First piece: tick it down to the floor (loop ~20 ticks, as other tests do).
  await api(page, "spawn", MONO_A);
  for (let i = 0; i < 20; i++) await api(page, "tick");

  let s = await getState(page);
  // Grid shape is exactly ROWS x COLS — nothing rendered/stored out of bounds.
  expect(s.grid.length).toBe(ROWS);
  for (const row of s.grid) expect(row.length).toBe(COLS);

  // The mono piece settled flush on the bottom two rows at cols 7-8.
  expect(s.grid[9]![7]).toBe(0);
  expect(s.grid[9]![8]).toBe(0);
  expect(s.grid[8]![7]).toBe(0);
  expect(s.grid[8]![8]).toBe(0);

  // No occupied cell exists outside the ROWS x COLS bounds (no below-floor clip).
  const inBounds = (st: State): boolean =>
    st.grid.length === ROWS &&
    st.grid.every(
      (row, r) =>
        row.length === COLS &&
        row.every((cell, c) => cell === null || (r < ROWS && c < COLS)),
    );
  expect(inBounds(s)).toBe(true);

  // Second piece lands atop the first (stack-top resting case, Req 2.2).
  await api(page, "spawn", MONO_A);
  for (let i = 0; i < 20; i++) await api(page, "tick");

  s = await getState(page);
  // Stack is flush: rows 6-9 in cols 7-8 are occupied, nothing below the floor.
  expect(s.grid[7]![7]).toBe(0);
  expect(s.grid[7]![8]).toBe(0);
  expect(s.grid[6]![7]).toBe(0);
  expect(s.grid[6]![8]).toBe(0);
  expect(s.grid.length).toBe(ROWS);
  for (const row of s.grid) expect(row.length).toBe(COLS);
  expect(inBounds(s)).toBe(true);
});

// ---- F3: auth + global leaderboard (deterministic mock seam) --------------

async function signIn(page: Page, name: string, subject: string): Promise<void> {
  await page.evaluate(
    ([n, s]) => window.__lumines!.auth!.signIn({ name: n, subject: s }),
    [name, subject] as const,
  );
}

async function endGame(page: Page, score: number): Promise<void> {
  await page.evaluate((s) => window.__lumines!.endGame!(s), score);
}

test("signing in shows the user name and a sign-out control", async ({
  page,
}) => {
  await expect(page.getByTestId("signin")).toBeVisible();
  await expect(page.getByTestId("user-name")).toHaveCount(0);

  await signIn(page, "Ada", "subject-ada");

  await expect(page.getByTestId("user-name")).toHaveText("Ada");
  await expect(page.getByTestId("signout")).toBeVisible();
  await expect(page.getByTestId("signin")).toHaveCount(0);
});

test("signing out returns to the unauthenticated state", async ({ page }) => {
  await signIn(page, "Ada", "subject-ada");
  await expect(page.getByTestId("signout")).toBeVisible();

  await page.getByTestId("signout").click();

  await expect(page.getByTestId("signin")).toBeVisible();
  await expect(page.getByTestId("user-name")).toHaveCount(0);
});

test("a signed-in run adds a leaderboard row and updates personal best (improve-only)", async ({
  page,
}) => {
  await signIn(page, "Ada", "subject-ada");
  await page.getByTestId("start-button").click();

  await endGame(page, 120);
  await expect(page.getByTestId("game-over")).toBeVisible();
  await expect(page.getByTestId("leaderboard-row")).toHaveCount(1);
  await expect(page.getByTestId("leaderboard-row")).toContainText("Ada");
  await expect(page.getByTestId("leaderboard-row")).toContainText("120");
  await expect(page.getByTestId("personal-best")).toHaveText("120");

  // A lower score does NOT lower the personal best (improve-only).
  await page.getByTestId("restart").click();
  await endGame(page, 50);
  await expect(page.getByTestId("personal-best")).toHaveText("120");

  // A higher score DOES improve it.
  await page.getByTestId("restart").click();
  await endGame(page, 300);
  await expect(page.getByTestId("personal-best")).toHaveText("300");
  await expect(page.getByTestId("leaderboard-row")).toHaveCount(1);
});

test("a signed-out run writes nothing to the leaderboard", async ({ page }) => {
  await page.getByTestId("start-button").click();
  await endGame(page, 999);

  await expect(page.getByTestId("game-over")).toBeVisible();
  await expect(page.getByTestId("leaderboard-row")).toHaveCount(0);
  await expect(page.getByTestId("personal-best")).toHaveCount(0);
});
