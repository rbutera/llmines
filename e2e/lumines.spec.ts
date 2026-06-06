import { expect, test, type Page } from "@playwright/test";
import type { LuminesTestApi } from "../src/game/test-api/install";

type Color = 0 | 1;
type Cell = Color | null;
type Piece = [[Color, Color], [Color, Color]];
interface State {
  grid: Cell[][];
  score: number;
  gameOver: boolean;
  sweepX: number;
  hold: {
    active: boolean;
    remainingMs: number;
  };
}

declare global {
  interface Window {
    __lumines?: LuminesTestApi;
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

test("auth test hooks reflect signed-in UI and sign-out UI", async ({
  page,
}) => {
  await expect(page.getByTestId("signin")).toBeVisible();

  await page.evaluate(() =>
    window.__lumines!.auth!.signIn({
      name: "Ada Lovelace",
      subject: "google-oauth2|ada",
    }),
  );

  await expect(page.getByTestId("user-name")).toHaveText("Ada Lovelace");
  await expect(page.getByTestId("signout")).toBeVisible();

  await page.evaluate(() => window.__lumines!.auth!.signOut());
  await expect(page.getByTestId("signin")).toBeVisible();
  await expect(page.getByTestId("user-name")).toHaveCount(0);
});

test("unauthenticated endGame does not write leaderboard", async ({ page }) => {
  await page.getByTestId("start-button").click();
  await page.evaluate(() => window.__lumines!.endGame!(999));

  await expect(page.getByTestId("game-over")).toBeVisible();
  await expect(page.getByTestId("personal-best")).toHaveText("--");
  await expect(page.getByTestId("leaderboard-row")).toHaveCount(0);
});

test("signed-in endGame saves only improved personal best and updates leaderboard", async ({
  page,
}) => {
  await page.evaluate(() =>
    window.__lumines!.auth!.signIn({
      name: "Grace Hopper",
      subject: "google-oauth2|grace",
    }),
  );
  await page.getByTestId("start-button").click();

  await page.evaluate(() => window.__lumines!.endGame!(80));
  await expect(page.getByTestId("personal-best")).toHaveText("80");
  await expect(page.getByTestId("leaderboard-row")).toHaveCount(1);
  await expect(page.getByTestId("leaderboard-row").first()).toContainText(
    "Grace Hopper",
  );
  await expect(page.getByTestId("leaderboard-row").first()).toContainText("80");

  await page.evaluate(() => window.__lumines!.endGame!(60));
  await expect(page.getByTestId("personal-best")).toHaveText("80");
  await expect(page.getByTestId("leaderboard-row").first()).toContainText("80");

  await page.evaluate(() => window.__lumines!.endGame!(120));
  await expect(page.getByTestId("personal-best")).toHaveText("120");
  await expect(page.getByTestId("leaderboard-row").first()).toContainText(
    "120",
  );
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
  expect(s.hold.active).toBe(true);
  expect(s.hold.remainingMs).toBeGreaterThan(0);
  // piece visible at cols 7-8, rows 0-1
  expect(s.grid[0]![7]).toBe(0);
  expect(s.grid[0]![8]).toBe(0);
  expect(s.grid[1]![7]).toBe(0);

  await api(page, "pressSoftDrop");
  s = await getState(page);
  expect(s.hold.active).toBe(false);
  expect(s.grid[1]![7]).toBe(0);
  expect(s.grid[2]![7]).toBe(0);
  expect(s.grid[0]![7]).toBe(null);

  await api(page, "spawn", MONO_A);
  s = await getState(page);
  expect(s.hold.active).toBe(true);

  await api(page, "tick");
  s = await getState(page);
  expect(s.hold.active).toBe(false);
  expect(s.grid[0]![7]).toBe(0);
  expect(s.grid[1]![7]).toBe(0);
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

test("new block hold requires a fresh drop press", async ({ page }) => {
  await page.getByTestId("start-button").click();
  await api(page, "spawn", MONO_A);

  let s = await getState(page);
  expect(s.hold.active).toBe(true);
  expect(s.grid[0]![7]).toBe(0);
  expect(s.grid[1]![7]).toBe(0);

  // Simulates holding a drop key through spawn: no fresh press hook is called.
  await api(page, "tick");
  s = await getState(page);
  expect(s.hold.active).toBe(false);
  expect(s.grid[0]![7]).toBe(0);
  expect(s.grid[1]![7]).toBe(0);
  expect(s.grid[2]![7]).toBe(null);

  await api(page, "pressSoftDrop");
  s = await getState(page);
  expect(s.grid[0]![7]).toBe(null);
  expect(s.grid[1]![7]).toBe(0);
  expect(s.grid[2]![7]).toBe(0);
});

test("fresh hard drop during hold engages immediately", async ({ page }) => {
  await page.getByTestId("start-button").click();
  await api(page, "spawn", MONO_A);

  let s = await getState(page);
  expect(s.hold.active).toBe(true);

  await api(page, "pressHardDrop");
  s = await getState(page);
  expect(s.hold.active).toBe(false);
  expect(s.grid[9]![7]).toBe(0);
  expect(s.grid[8]![7]).toBe(0);
  expect(s.grid[0]![7]).toBe(null);
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
  await expect(page.getByTestId("score-burst")).toBeVisible();
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
