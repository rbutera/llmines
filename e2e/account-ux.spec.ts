import { expect, test, type Page } from "@playwright/test";

/**
 * Account / UX e2e — runs in TEST_MODE, so the deterministic mock account seam
 * (`window.__lumines.auth`) backs sign-in/username and the in-memory store backs
 * scores. These cover the five account/UX items end to end against the SAME UI
 * the real Convex backend drives (only the seam swaps):
 *  1. logged-in user chip in the HUD (+ a signed-out sign-in affordance),
 *  2. first-login username step (defaulted to firstName+lastName, editable),
 *  3. game-over login (signed out) / auto-save (signed in),
 *  4. the Settings dev panel gated behind `?dev=1`,
 *  5. the game-over replay download.
 */

interface AuthApi {
  signIn(p: { subject: string; displayName: string; email?: string }): void;
  signOut(): void;
  suggestedUsername(): string | null;
  needsUsername(): boolean;
  chooseUsername(username: string): string;
}

declare global {
  interface Window {
    __lumines?: {
      auth: AuthApi;
      endGame(score: number): void;
      seed(n: number): void;
    };
  }
}

async function signIn(
  page: Page,
  subject: string,
  displayName: string,
): Promise<void> {
  await page.evaluate(
    ([s, d]) => window.__lumines!.auth.signIn({ subject: s, displayName: d }),
    [subject, displayName] as const,
  );
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

test("HUD shows a sign-in affordance when signed out and the username when signed in", async ({
  page,
}) => {
  await page.getByTestId("start-button").click();

  // Signed out: the in-play HUD carries the small sign-in affordance.
  await expect(page.getByTestId("hud-signin")).toBeVisible();
  await expect(page.getByTestId("hud-account")).toHaveCount(0);

  // Sign in + choose a username, then the chip shows the username.
  await signIn(page, "g|alice", "Alice Anderson");
  await expect(page.getByTestId("username-select")).toBeVisible();
  // Default suggestion = firstName+lastName.
  await expect(page.getByTestId("username-input")).toHaveValue("AliceAnderson");
  await page.getByTestId("username-confirm").click();
  await expect(page.getByTestId("username-select")).toHaveCount(0);

  await expect(page.getByTestId("hud-account")).toBeVisible();
  await expect(page.getByTestId("hud-username")).toHaveText("AliceAnderson");
});

test("first login presents the username step, defaulted to firstName+lastName, editable", async ({
  page,
}) => {
  await page.getByTestId("start-button").click();
  await signIn(page, "g|rai", "Rai Butera");

  const select = page.getByTestId("username-select");
  await expect(select).toBeVisible();
  await expect(page.getByTestId("username-input")).toHaveValue("RaiButera");

  // Edit to a custom name and confirm.
  await page.getByTestId("username-input").fill("GemPilot");
  await page.getByTestId("username-confirm").click();
  await expect(select).toHaveCount(0);
  await expect(page.getByTestId("hud-username")).toHaveText("GemPilot");
});

test("username clash surfaces inline; the next free suggestion is numbered", async ({
  page,
}) => {
  await page.getByTestId("start-button").click();

  // First player claims "RaiButera".
  await signIn(page, "g|r1", "Rai Butera");
  await page.getByTestId("username-confirm").click();
  await page.evaluate(() => window.__lumines!.auth.signOut());

  // Second player with the same name: the suggestion is collision-numbered.
  await signIn(page, "g|r2", "Rai Butera");
  await expect(page.getByTestId("username-input")).toHaveValue("RaiButera2");

  // Typing the taken name surfaces the clash inline and blocks confirm (the live
  // uniqueness check catches it before a submit).
  await page.getByTestId("username-input").fill("RaiButera");
  await expect(page.getByTestId("username-error")).toContainText(/taken/i);
  await expect(page.getByTestId("username-confirm")).toBeDisabled();
  await expect(page.getByTestId("username-select")).toBeVisible();

  // A free name (the numbered suggestion) re-enables confirm and saves.
  await page.getByTestId("username-input").fill("RaiButera2");
  await expect(page.getByTestId("username-confirm")).toBeEnabled();
  await page.getByTestId("username-confirm").click();
  await expect(page.getByTestId("username-select")).toHaveCount(0);
  await expect(page.getByTestId("hud-username")).toHaveText("RaiButera2");
});

test("game over: signed out shows a login button; no save happens", async ({
  page,
}) => {
  await page.getByTestId("start-button").click();
  await page.evaluate(() => window.__lumines!.endGame(1234));

  const over = page.getByTestId("game-over");
  await expect(over).toBeVisible();
  // Signed out → prominent login affordance, no saved state.
  await expect(page.getByTestId("gameover-signin")).toBeVisible();
  await expect(page.getByTestId("score-saved")).toHaveCount(0);
});

test("game over: signed in (with a username) auto-saves and shows the saved state", async ({
  page,
}) => {
  await page.getByTestId("start-button").click();
  await signIn(page, "g|bob", "Bob Builder");
  await page.getByTestId("username-confirm").click(); // accept "BobBuilder"
  await expect(page.getByTestId("username-select")).toHaveCount(0);

  await page.evaluate(() => window.__lumines!.endGame(4242));

  await expect(page.getByTestId("game-over")).toBeVisible();
  await expect(page.getByTestId("gameover-signin")).toHaveCount(0);
  await expect(page.getByTestId("score-saved")).toBeVisible();

  // The saved score appears on the leaderboard under the chosen username.
  await page.getByTestId("gameover-leaderboard").click();
  const board = page.getByTestId("leaderboard");
  await expect(board).toBeVisible();
  await expect(board.getByTestId("leaderboard-row").first()).toContainText(
    "BobBuilder",
  );
});

test("Settings dev panel is hidden by default and shown with ?dev=1", async ({
  page,
}) => {
  // Default (no query param): the dev settings toggle never mounts.
  await page.getByTestId("start-button").click();
  await expect(page.getByTestId("settings-toggle")).toHaveCount(0);

  // With ?dev=1: the toggle mounts and opens the Leva panel.
  await page.goto("/?dev=1");
  await page.getByTestId("start-button").click();
  await expect(page.getByTestId("settings-toggle")).toBeVisible();
});

test("game over: the replay button downloads the run's replay JSON", async ({
  page,
}) => {
  await page.getByTestId("start-button").click();
  await page.evaluate(() => window.__lumines!.endGame(99));
  await expect(page.getByTestId("game-over")).toBeVisible();

  const downloadPromise = page.waitForEvent("download");
  await page.getByTestId("gameover-download-replay").click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^llmines-replay-.*\.json$/);
});
