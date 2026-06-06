import { expect, test, type Page } from "@playwright/test";

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
    __lumines?: {
      seed(n: number): void;
      state(): State;
      marked(): { row: number; col: number }[];
      spawn(piece: Piece): void;
      tick(): void;
      pressSoftDrop(): void;
      pressHardDrop(): void;
      endGame(score: number): void;
      auth: {
        signIn(user: {
          name: string;
          subject: string;
          avatarUrl?: string;
        }): void;
        signOut(): void;
      };
      sweepNow(): void;
      sweepProgress(dtMs: number): void;
    };
  }
}

const MONO_A: Piece = [
  [0, 0],
  [0, 0],
];

async function getState(page: Page): Promise<State> {
  await waitForTestApi(page);
  return page.evaluate(() => window.__lumines!.state());
}

async function waitForTestApi(page: Page): Promise<void> {
  await page.waitForFunction(() => Boolean(window.__lumines));
}

async function api(page: Page, fn: string, ...args: unknown[]): Promise<void> {
  await waitForTestApi(page);
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

async function signIn(
  page: Page,
  user: { name: string; subject: string; avatarUrl?: string },
): Promise<void> {
  await waitForTestApi(page);
  await page.evaluate((mockUser) => {
    window.__lumines!.auth.signIn(mockUser);
  }, user);
}

async function signOut(page: Page): Promise<void> {
  await waitForTestApi(page);
  await page.evaluate(() => {
    window.__lumines!.auth.signOut();
  });
}

async function beginRun(page: Page): Promise<void> {
  if ((await page.getByTestId("restart").count()) > 0) {
    await page.getByTestId("restart").click();
    return;
  }

  if ((await page.getByTestId("start-button").count()) > 0) {
    await page.getByTestId("start-button").click();
  }
}

async function submitMockScore(
  page: Page,
  user: { name: string; subject: string; avatarUrl?: string },
  score: number,
): Promise<void> {
  await signIn(page, user);
  await beginRun(page);
  await api(page, "endGame", score);
  await expect(page.getByTestId("score")).toHaveText(String(score));
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

test("mock auth sign-in and sign-out update the standard UI", async ({
  page,
}) => {
  await expect(page.getByTestId("signin")).toBeVisible();
  await expect(page.getByTestId("signout")).toHaveCount(0);

  await signIn(page, {
    name: "Ada Lovelace",
    subject: "google-oauth2|ada",
  });

  await expect(page.getByTestId("user-name")).toHaveText("Ada Lovelace");
  await expect(page.getByTestId("signout")).toBeVisible();
  await expect(page.getByTestId("signin")).toHaveCount(0);

  await signOut(page);

  await expect(page.getByTestId("signin")).toBeVisible();
  await expect(page.getByTestId("signout")).toHaveCount(0);
});

test("unauthenticated endGame does not write personal best or leaderboard", async ({
  page,
}) => {
  await page.getByTestId("start-button").click();
  await api(page, "endGame", 120);

  await expect(page.getByTestId("game-over")).toBeVisible();
  await expect(page.getByTestId("score")).toHaveText("120");
  await expect(page.getByTestId("signin")).toBeVisible();
  await expect(
    page.getByText("Scores from guest runs are not saved."),
  ).toBeVisible();
  await expect(page.getByTestId("personal-best")).toHaveText("0");
  await expect(page.getByTestId("leaderboard-row")).toHaveCount(0);
});

test("signed-in endGame updates personal best only when beaten", async ({
  page,
}) => {
  const user = { name: "Grace Hopper", subject: "google-oauth2|grace" };

  await submitMockScore(page, user, 40);
  await expect(page.getByTestId("personal-best")).toHaveText("40");
  await expect(page.getByTestId("leaderboard-row")).toHaveCount(1);
  await expect(page.getByTestId("leaderboard-row").first()).toContainText(
    "Grace Hopper",
  );
  await expect(page.getByTestId("leaderboard-row").first()).toContainText("40");

  await submitMockScore(page, user, 20);
  await expect(page.getByTestId("personal-best")).toHaveText("40");
  await expect(page.getByTestId("leaderboard-row")).toHaveCount(1);
  await expect(page.getByTestId("leaderboard-row").first()).toContainText("40");

  await submitMockScore(page, user, 80);
  await expect(page.getByTestId("personal-best")).toHaveText("80");
  await expect(page.getByTestId("leaderboard-row")).toHaveCount(1);
  await expect(page.getByTestId("leaderboard-row").first()).toContainText("80");
});

test("global leaderboard renders the top 10 in descending order", async ({
  page,
}) => {
  for (let i = 0; i < 12; i++) {
    await submitMockScore(
      page,
      { name: `Player ${i}`, subject: `google-oauth2|player-${i}` },
      i * 10,
    );
  }

  const rows = page.getByTestId("leaderboard-row");
  await expect(rows).toHaveCount(10);
  await expect(rows.nth(0)).toContainText("Player 11");
  await expect(rows.nth(0)).toContainText("110");
  await expect(rows.nth(9)).toContainText("Player 2");
  await expect(rows.nth(9)).toContainText("20");
  const rowTexts = await rows.allTextContents();
  expect(rowTexts.some((text) => /Player 1(?!\d)/.test(text))).toBe(false);
  expect(rowTexts.some((text) => /Player 0(?!\d)/.test(text))).toBe(false);
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
  expect(s.hold).toEqual({ active: true, remainingMs: 500 });

  await api(page, "tick");
  s = await getState(page);
  expect(s.hold).toEqual({ active: false, remainingMs: 0 });
  expect(s.grid[0]![7]).toBe(0);
  expect(s.grid[1]![7]).toBe(0);
  expect(s.grid[2]![7]).toBe(null);

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

test("hold allows movement and rotation without canceling", async ({
  page,
}) => {
  await page.getByTestId("start-button").click();
  await api(page, "spawn", [
    [0, 1],
    [0, 1],
  ] as Piece);

  await page.keyboard.press("l");
  let s = await getState(page);
  expect(s.hold.active).toBe(true);
  expect(s.grid[0]![8]).toBe(0);
  expect(s.grid[0]![9]).toBe(1);

  await page.keyboard.press("k");
  s = await getState(page);
  expect(s.hold.active).toBe(true);
  expect(s.grid[0]![8]).toBe(0);
  expect(s.grid[0]![9]).toBe(0);
  expect(s.grid[1]![8]).toBe(1);
  expect(s.grid[1]![9]).toBe(1);
});

test("fresh soft-drop press cancels hold and moves immediately", async ({
  page,
}) => {
  await page.getByTestId("start-button").click();
  await api(page, "spawn", MONO_A);

  await api(page, "pressSoftDrop");
  const s = await getState(page);

  expect(s.hold).toEqual({ active: false, remainingMs: 0 });
  expect(s.grid[1]![7]).toBe(0);
  expect(s.grid[2]![7]).toBe(0);
  expect(s.grid[0]![7]).toBe(null);
});

test("fresh hard-drop press cancels hold and locks immediately", async ({
  page,
}) => {
  await page.getByTestId("start-button").click();
  await api(page, "spawn", MONO_A);

  await api(page, "pressHardDrop");
  const s = await getState(page);

  expect(s.hold).toEqual({ active: false, remainingMs: 0 });
  expect(s.grid[9]![7]).toBe(0);
  expect(s.grid[9]![8]).toBe(0);
  expect(s.grid[8]![7]).toBe(0);
  expect(s.grid[8]![8]).toBe(0);
  expect(s.grid[0]![7]).toBe(null);
});

test("carried-over drop key repeat does not skip hold", async ({ page }) => {
  await page.getByTestId("start-button").click();
  await api(page, "spawn", MONO_A);

  await page.evaluate(() => {
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "j",
        repeat: true,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  let s = await getState(page);
  expect(s.hold).toEqual({ active: true, remainingMs: 500 });
  expect(s.grid[0]![7]).toBe(0);
  expect(s.grid[1]![7]).toBe(0);
  expect(s.grid[2]![7]).toBe(null);

  await api(page, "tick");
  s = await getState(page);
  expect(s.hold).toEqual({ active: false, remainingMs: 0 });
  expect(s.grid[0]![7]).toBe(0);
  expect(s.grid[1]![7]).toBe(0);

  await page.evaluate(() => {
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "j",
        repeat: true,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  s = await getState(page);
  expect(s.grid[1]![7]).toBe(0);
  expect(s.grid[2]![7]).toBe(0);
  expect(s.grid[0]![7]).toBe(null);
});

test("hard drop lands within the bottom rows", async ({ page }) => {
  await page.getByTestId("start-button").click();
  await api(page, "spawn", MONO_A);

  await page.keyboard.press("Space");
  const s = await getState(page);

  expect(s.grid[9]![7]).toBe(0);
  expect(s.grid[9]![8]).toBe(0);
  expect(s.grid[8]![7]).toBe(0);
  expect(s.grid[8]![8]).toBe(0);
  expect(s.grid[0]![7]).toBe(null);
  expect(s.grid[0]![8]).toBe(null);
});

test("near-bottom stack landing stays in bounds", async ({ page }) => {
  await page.getByTestId("start-button").click();
  await api(page, "spawn", MONO_A);
  await page.keyboard.press("Space");

  await api(page, "spawn", [
    [1, 1],
    [1, 1],
  ] as Piece);
  await page.keyboard.press("Space");
  const s = await getState(page);

  expect(s.grid[9]![7]).toBe(0);
  expect(s.grid[9]![8]).toBe(0);
  expect(s.grid[8]![7]).toBe(0);
  expect(s.grid[8]![8]).toBe(0);
  expect(s.grid[7]![7]).toBe(1);
  expect(s.grid[7]![8]).toBe(1);
  expect(s.grid[6]![7]).toBe(1);
  expect(s.grid[6]![8]).toBe(1);
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
  await expect(page.getByTestId("score-feedback-effect")).toBeVisible();
  await expect(page.getByTestId("score-feedback-effect")).toHaveAttribute(
    "data-score-delta",
    "4",
  );
  await expect(page.getByTestId("score-feedback-effect")).toHaveAttribute(
    "data-intensity",
    "1",
  );
  await expect(page.getByTestId("score-feedback-delta")).toHaveText("+4");
  await expect(page.getByTestId("score-feedback-particle")).toHaveCount(12);
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
  await expect(page.getByTestId("score")).toHaveText("12");
  await expect(page.getByTestId("score-feedback-effect")).toBeVisible();
  await expect(page.getByTestId("score-feedback-effect")).toHaveAttribute(
    "data-score-delta",
    "12",
  );
  await expect(page.getByTestId("score-feedback-effect")).toHaveAttribute(
    "data-intensity",
    "2",
  );
  await expect(page.getByTestId("score-feedback-particle")).toHaveCount(17);
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
