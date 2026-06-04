import { expect, test } from "@playwright/test";
import { startGame, type LuminesApi, type Piece } from "./_lumines";

const SOLID0: Piece = [
  [0, 0],
  [0, 0],
];
// checkerboard — never forms a monochrome 2x2 by itself
const MIXED: Piece = [
  [1, 0],
  [0, 1],
];

test("a constructed 2x2 square is cleared by the sweep and scores 4", async ({ page }) => {
  await startGame(page);

  const marks = await page.evaluate((piece) => {
    const api = (window as unknown as { __lumines: LuminesApi }).__lumines;
    api.seed(1);
    api.spawn(piece as Piece); // a solid 2x2 is itself a monochrome square
    // marking is over the SETTLED stack — drop the piece so it locks first
    for (let i = 0; i < 15; i++) api.tick();
    return api.marked().length;
  }, SOLID0);
  expect(marks).toBe(4);

  const after = await page.evaluate(() => {
    const api = (window as unknown as { __lumines: LuminesApi }).__lumines;
    api.sweepNow();
    const s = api.state();
    return { score: s.score, marked: api.marked().length };
  });
  expect(after.score).toBe(4);
  expect(after.marked).toBe(0);
  await expect(page.getByTestId("score")).toHaveText("4");
});

test("cells above a cleared square fall by gravity", async ({ page }) => {
  await startGame(page);

  const result = await page.evaluate(
    ({ solid, mixed }) => {
      const api = (window as unknown as { __lumines: LuminesApi }).__lumines;
      api.seed(2);
      // 1) drop a solid 2x2 to the floor
      api.spawn(solid as Piece);
      for (let i = 0; i < 15; i++) api.tick();
      // 2) drop a checkerboard piece on top of it (not part of any square)
      api.spawn(mixed as Piece);
      for (let i = 0; i < 15; i++) api.tick();
      const before = api.state().grid;
      // 3) sweep: clears only the solid square below; the mixed piece survives
      api.sweepNow();
      const s = api.state();
      const rows = s.grid.length;
      return {
        score: s.score,
        before,
        bottomTwoCol7: [s.grid[rows - 2]![7], s.grid[rows - 1]![7]],
        bottomTwoCol8: [s.grid[rows - 2]![8], s.grid[rows - 1]![8]],
      };
    },
    { solid: SOLID0, mixed: MIXED },
  );

  // The solid square (4 cells, 1 square) scored 4.
  expect(result.score).toBe(4);
  // The checkerboard piece fell to the floor: col7 had [1,0] top→bottom, col8 had [0,1].
  expect(result.bottomTwoCol7).toEqual([1, 0]);
  expect(result.bottomTwoCol8).toEqual([0, 1]);
});
