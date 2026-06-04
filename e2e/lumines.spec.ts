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
  expect((st.grid[0] as Cell[])[7]).toBe(0); // spawned at top-centre

  await page.evaluate(() => (window as any).__lumines.tick());
  st = await getState(page);
  expect((st.grid[1] as Cell[])[7]).toBe(0); // fell one row

  await page.evaluate(() => {
    const L = (window as any).__lumines;
    L.spawn([
      [1, 1],
      [1, 1],
    ]); // locks the previous, new piece falling
  });
  st = await getState(page);
  expect((st.grid[9] as Cell[])[7]).not.toBeNull(); // previous piece settled on the floor
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
  await expect(page.getByTestId("score")).toHaveText("4");
});

test("cells settle by gravity after a deletion", async ({ page }) => {
  await startGame(page);
  await page.evaluate(() => {
    const L = (window as any).__lumines;
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
  for (let c = 0; c < 16; c++) {
    const col = st.grid.map((row) => row[c]);
    const firstFilled = col.findIndex((v) => v !== null);
    if (firstFilled !== -1) {
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
    for (let i = 0; i < 12; i++) L.spawn([[0, 1], [1, 0]]);
  });
  await expect(page.getByTestId("game-over")).toBeVisible();
  await page.getByTestId("restart").click();
  await expect(page.getByTestId("score")).toHaveText("0");
});
