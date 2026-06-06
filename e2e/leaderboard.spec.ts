import { expect, test, type Page } from "@playwright/test";

/**
 * Accounts / high scores / leaderboard, driven entirely against the deterministic
 * MOCK via the TEST_MODE hooks (no real OAuth, no live Convex). The
 * `window.__lumines` type is declared in lumines.spec.ts (merged globally).
 */

async function signIn(page: Page, name: string, subject: string): Promise<void> {
  await page.evaluate(
    ([n, s]) => window.__lumines!.auth!.signIn({ name: n, subject: s }),
    [name, subject] as const,
  );
}
async function signOut(page: Page): Promise<void> {
  await page.evaluate(() => window.__lumines!.auth!.signOut());
}
async function endGame(page: Page, score: number): Promise<void> {
  await page.evaluate((s) => window.__lumines!.endGame!(s), score);
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

test("sign in with Google and sign out, reflected in the UI [US1]", async ({
  page,
}) => {
  await expect(page.getByTestId("signin")).toBeVisible();

  await signIn(page, "Ada", "u-ada");
  await expect(page.getByTestId("user-name")).toHaveText("Ada");
  await expect(page.getByTestId("signout")).toBeVisible();

  await signOut(page);
  await expect(page.getByTestId("signin")).toBeVisible();
});

test("signed-in score persists; personal best only improves [US2]", async ({
  page,
}) => {
  await signIn(page, "Ada", "u-ada");

  await endGame(page, 100);
  await expect(page.getByTestId("personal-best")).toHaveText("100");

  await endGame(page, 50); // not beaten
  await expect(page.getByTestId("personal-best")).toHaveText("100");

  await endGame(page, 150); // beaten
  await expect(page.getByTestId("personal-best")).toHaveText("150");
});

test("unauthenticated game is not saved; prompted to sign in [US4]", async ({
  page,
}) => {
  // signed out
  await endGame(page, 999);
  await expect(page.getByTestId("signin-prompt")).toBeVisible();
  // not authenticated -> no personal-best element, and nothing written
  await expect(page.getByTestId("personal-best")).toHaveCount(0);
  await expect(page.getByTestId("leaderboard-row")).toHaveCount(0);
});

test("global top-10 leaderboard renders and reflects new scores [US3]", async ({
  page,
}) => {
  await signIn(page, "Ada", "u-ada");
  await endGame(page, 100);
  await expect(page.getByTestId("leaderboard-row")).toHaveCount(1);
  await expect(page.getByTestId("leaderboard-row").first()).toContainText("Ada");
  await expect(page.getByTestId("leaderboard-row").first()).toContainText("100");

  // a second user submits a higher score and tops the board
  await signOut(page);
  await signIn(page, "Bob", "u-bob");
  await endGame(page, 200);
  await expect(page.getByTestId("leaderboard-row")).toHaveCount(2);
  await expect(page.getByTestId("leaderboard-row").first()).toContainText("Bob");
  await expect(page.getByTestId("leaderboard-row").first()).toContainText("200");
});
