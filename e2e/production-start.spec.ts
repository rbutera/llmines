import { expect, test } from "@playwright/test";

/**
 * PRODUCTION-START acceptance guard.
 *
 * Runs against the REAL production bundle (no NEXT_PUBLIC_TEST_MODE), so the
 * actual Start-button flow executes end to end: controller.start() resumes the
 * AudioClock, spawns the first piece, starts the rAF loop, and the music-synced
 * sweep begins to advance. This is the path the deterministic `window.__lumines`
 * suite BYPASSES — which is exactly how a "217 tests green but clicking Start
 * does nothing" regression shipped (the juice pass's AutoFitCamera could set the
 * orthographic camera zoom to 0 on a degenerate first-frame size, producing a
 * singular projection so the scene renders a frozen frame with the sweep stuck
 * at x=0 and no visible piece, with no thrown error).
 *
 * The assertions read `window.__luminesProbe`, a tiny read-only projection of the
 * live RenderState wired in GameShell for exactly this purpose (it does NOT exist
 * to drive the game — that is `window.__lumines`, absent in production).
 *
 * This test MUST FAIL on the pre-fix build (sweep frozen at 0) and PASS after the
 * fix, so the gap can never silently reship.
 */

interface Probe {
  sweepX: number;
  hasActive: boolean;
  gameOver: boolean;
  /** The orthographic camera's ACTUALLY-applied zoom (written by AutoFitCamera). */
  cameraZoom?: number;
}

declare global {
  interface Window {
    __luminesProbe?: Probe;
  }
}

test("clicking Start spawns a piece and advances the sweep, with no console errors", async ({
  page,
}) => {
  const consoleErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  const pageErrors: string[] = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));

  await page.goto("/");

  // The deterministic control seam must NOT exist in production.
  const hasTestSeam = await page.evaluate(
    () => typeof (window as unknown as { __lumines?: unknown }).__lumines !== "undefined",
  );
  expect(hasTestSeam, "window.__lumines must be absent in the production bundle").toBe(false);

  // The real Start button click is the user gesture that resumes the audio clock.
  await page.getByTestId("start-button").click();

  // (a) a piece must be present/active shortly after Start (spawn is synchronous,
  //     but allow a beat for React to flush the playing phase + first emit).
  await expect
    .poll(() => page.evaluate(() => window.__luminesProbe?.hasActive ?? false), {
      message: "a piece should be active after Start",
      timeout: 3000,
    })
    .toBe(true);

  // (b) the sweep must advance beyond 0 within a few seconds (audio clock resumed,
  //     rAF loop integrating the bar). This is the assertion that fails when the
  //     scene/controller is frozen.
  await expect
    .poll(() => page.evaluate(() => window.__luminesProbe?.sweepX ?? 0), {
      message: "sweepX should advance beyond 0 after Start",
      timeout: 4000,
    })
    .toBeGreaterThan(0);

  // The game must not have died on the first frames.
  const probe = await page.evaluate(() => window.__luminesProbe);
  expect(probe?.gameOver, "the game must not be over right after Start").toBe(false);

  // (c) the RENDER must be alive, not just the controller. The AutoFitCamera
  //     zoom-0 regression left the controller advancing (sweepX > 0) while the
  //     3D scene drew a frozen/blank frame via a SINGULAR orthographic projection
  //     — so sweepX alone does NOT catch it. AutoFitCamera surfaces the camera's
  //     actually-applied zoom; assert it stayed positive (a degenerate projection
  //     is exactly zoom <= 0). The canvas must also be mounted (scene present).
  await expect(page.locator("canvas")).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => window.__luminesProbe?.cameraZoom ?? 0), {
      message:
        "the orthographic camera zoom must stay positive (zoom 0 = singular projection = blank frozen scene)",
      timeout: 3000,
    })
    .toBeGreaterThan(0);

  // (d) no uncaught console errors / page errors on the production start path.
  expect(consoleErrors, `console errors during Start: ${consoleErrors.join(" | ")}`).toEqual([]);
  expect(pageErrors, `page errors during Start: ${pageErrors.join(" | ")}`).toEqual([]);
});

test("chrome: no skin toggle / N key / bottom bar / title button; the score is visible", async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));

  await page.goto("/");

  // START SCREEN: the preserved contracts are present...
  await expect(page.getByTestId("start-button")).toBeVisible();
  await expect(page.getByTestId("controls-cheatsheet")).toBeVisible();
  // ...and the skin-cycle toggle is GONE (no "SKIN ▸" control anywhere).
  await expect(page.getByText(/SKIN ▸/i)).toHaveCount(0);
  await expect(page.getByText(/cycle skin/i)).toHaveCount(0);
  // The cheatsheet must not advertise the removed "n skin" key.
  await expect(page.getByTestId("controls-cheatsheet")).not.toContainText(
    "n skin",
  );

  // The N key is inert (it used to cycle the skin). Pressing it must not throw
  // or change the page; just assert no page error results.
  await page.keyboard.press("n");

  // Enter the game.
  await page.getByTestId("start-button").click();
  await expect
    .poll(() => page.evaluate(() => window.__luminesProbe?.hasActive ?? false), {
      timeout: 3000,
    })
    .toBe(true);

  // IN-PLAY: the score readout is present AND visible (legibility fix).
  const score = page.getByTestId("score");
  await expect(score).toBeVisible();
  // The dead bottom pause-hint ("esc · ❚❚ pause") is removed.
  await expect(page.getByText("esc · ❚❚ pause")).toHaveCount(0);

  expect(
    pageErrors,
    `page errors during the chrome check: ${pageErrors.join(" | ")}`,
  ).toEqual([]);
});

test("How to Play tutorial opens from Start and is keyboard-dismissible", async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));

  await page.goto("/");

  // The tutorial button is on the Start menu and the overlay is initially closed.
  const open = page.getByTestId("how-to-play");
  await expect(open).toBeVisible();
  await expect(page.getByTestId("tutorial-overlay")).toHaveCount(0);

  // Open it: a labelled modal dialog with the objective + controls content.
  await open.click();
  const overlay = page.getByTestId("tutorial-overlay");
  await expect(overlay).toBeVisible();
  await expect(overlay).toHaveAttribute("role", "dialog");
  await expect(overlay).toHaveAttribute("aria-modal", "true");
  await expect(overlay.getByText("HOW TO PLAY")).toBeVisible();
  await expect(overlay.getByText(/timeline bar sweeps/i)).toBeVisible();
  await expect(overlay.getByText(/chain gem/i).first()).toBeVisible();

  // Focus lands on the close button (keyboard users start inside the dialog).
  await expect(page.getByTestId("tutorial-close")).toBeFocused();

  // Escape closes it without starting the game (still on the Start screen).
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("tutorial-overlay")).toHaveCount(0);
  await expect(page.getByTestId("start-button")).toBeVisible();
  expect(await page.evaluate(() => window.__luminesProbe?.hasActive ?? false)).toBe(false);

  // Re-open and close via the GOT IT button.
  await open.click();
  await expect(page.getByTestId("tutorial-overlay")).toBeVisible();
  await page.getByTestId("tutorial-close").click();
  await expect(page.getByTestId("tutorial-overlay")).toHaveCount(0);

  expect(
    pageErrors,
    `page errors during the tutorial check: ${pageErrors.join(" | ")}`,
  ).toEqual([]);
});

test("Escape pauses the running game (the sweep stops advancing)", async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));

  await page.goto("/");
  await page.getByTestId("start-button").click();

  // Let the sweep get going.
  await expect
    .poll(() => page.evaluate(() => window.__luminesProbe?.sweepX ?? 0), {
      message: "sweepX should advance before pausing",
      timeout: 4000,
    })
    .toBeGreaterThan(0);

  // Press Escape to pause.
  await page.keyboard.press("Escape");

  // After a moment to let any in-flight frame settle, the sweep must be FROZEN:
  // sample it, wait, and confirm it did not advance.
  await page.waitForTimeout(200);
  const pausedX = await page.evaluate(() => window.__luminesProbe?.sweepX ?? 0);
  await page.waitForTimeout(600); // > one sweep column; would move if not paused
  const laterX = await page.evaluate(() => window.__luminesProbe?.sweepX ?? 0);
  expect(laterX, "sweepX must not advance while paused").toBe(pausedX);

  // Resume and confirm it advances again — pause is resumable, not a stop.
  await page.keyboard.press("Escape");
  await expect
    .poll(() => page.evaluate(() => window.__luminesProbe?.sweepX ?? 0), {
      message: "sweepX should advance again after resume",
      timeout: 4000,
    })
    .toBeGreaterThan(pausedX);

  expect(pageErrors, `page errors during pause: ${pageErrors.join(" | ")}`).toEqual([]);
});
