import { expect, test, type Page } from "@playwright/test";

declare global {
  interface Window {
    __lumines?: {
      endGame(score: number): void;
      auth: {
        signIn(id: { name: string; subject: string }): void;
        signOut(): void;
      };
    };
  }
}

async function signIn(
  page: Page,
  name: string,
  subject: string,
): Promise<void> {
  await page.waitForFunction(() => !!window.__lumines?.auth);
  await page.evaluate((id) => window.__lumines!.auth.signIn(id), {
    name,
    subject,
  });
}
async function signOut(page: Page): Promise<void> {
  await page.waitForFunction(() => !!window.__lumines?.auth);
  await page.evaluate(() => window.__lumines!.auth.signOut());
}
async function endGame(page: Page, score: number): Promise<void> {
  await page.waitForFunction(
    () => typeof window.__lumines?.endGame === "function",
  );
  await page.evaluate((s) => window.__lumines!.endGame(s), score);
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

test("signed-out user sees sign-in and plays without being saved", async ({
  page,
}) => {
  await expect(page.getByTestId("signin")).toBeVisible();
  await page.getByTestId("start-button").click();
  await endGame(page, 999);
  await expect(page.getByTestId("personal-best")).toContainText("Sign in");
  await expect(page.getByTestId("leaderboard-row")).toHaveCount(0);
});

test("sign in reflects in the UI; sign out reverts", async ({ page }) => {
  await signIn(page, "Ada", "user-ada");
  await expect(page.getByTestId("user-name")).toHaveText("Ada");
  await expect(page.getByTestId("signout")).toBeVisible();
  await expect(page.getByTestId("signin")).toHaveCount(0);
  await signOut(page);
  await expect(page.getByTestId("signin")).toBeVisible();
  await expect(page.getByTestId("user-name")).toHaveCount(0);
});

test("signed-in score persists; personal best only rises; leaderboard reflects it", async ({
  page,
}) => {
  await signIn(page, "Ada", "user-ada");
  await page.getByTestId("start-button").click();

  await endGame(page, 100);
  await expect(page.getByTestId("personal-best")).toContainText("100");
  await expect(page.getByTestId("leaderboard-row")).toHaveCount(1);
  await expect(page.getByTestId("leaderboard-row").first()).toContainText(
    "100",
  );

  // A worse run does NOT lower the personal best.
  await page.getByTestId("restart").click();
  await endGame(page, 40);
  await expect(page.getByTestId("personal-best")).toContainText("100");

  // A better run raises it.
  await page.getByTestId("restart").click();
  await endGame(page, 250);
  await expect(page.getByTestId("personal-best")).toContainText("250");
  await expect(page.getByTestId("leaderboard-row").first()).toContainText(
    "250",
  );
});

test("a second user reorders the global leaderboard", async ({ page }) => {
  await signIn(page, "Ada", "user-ada");
  await page.getByTestId("start-button").click();
  await endGame(page, 100);

  await signIn(page, "Bo", "user-bo");
  await page.getByTestId("restart").click();
  await endGame(page, 300);

  await expect(page.getByTestId("leaderboard-row")).toHaveCount(2);
  await expect(page.getByTestId("leaderboard-row").first()).toContainText("Bo");
  await expect(page.getByTestId("leaderboard-row").first()).toContainText(
    "300",
  );
});

test("unauthenticated game-over is not written to the leaderboard", async ({
  page,
}) => {
  await signIn(page, "Ada", "user-ada");
  await page.getByTestId("start-button").click();
  await endGame(page, 100);
  await expect(page.getByTestId("leaderboard-row")).toHaveCount(1);

  await signOut(page);
  await page.getByTestId("restart").click();
  await endGame(page, 999);
  await expect(page.getByTestId("leaderboard-row")).toHaveCount(1);
  await expect(page.getByTestId("leaderboard-row").first()).toContainText(
    "100",
  );
});
