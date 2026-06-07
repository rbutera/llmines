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
