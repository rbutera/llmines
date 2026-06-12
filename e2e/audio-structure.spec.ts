import { expect, test } from "@playwright/test";

/**
 * AUDIO STRUCTURE PROOF — headless proof of the CLEAR-GATED audio mechanics on the
 * REAL production bundle, driven via the `?audiodev=1` engine handle.
 *
 * The model under test (the player's CLEARS drive the song, NOT a clock):
 *  - the structure manifest loads (segmentCount > 1, BPM from the manifest);
 *  - a section HOLDS / loops in place with NO clears (the index does not advance);
 *  - clears drive the cumulative TIER up within a section (sticky reveal);
 *  - accumulating clears past the threshold ADVANCES the section forward, one step;
 *  - a burst does NOT fast-forward multiple sections (in-flight lock);
 *  - the advance is forward-only (the index is monotonic);
 *  - no console / page errors throughout.
 *
 * Drives the engine directly via the dev hook (`__injectClears` to bank clear-progress
 * + `__stepBoundary` to fire a loop boundary on demand) so the test is fast and
 * DETERMINISTIC — it never waits the real bar window. The dev hook IS the engine
 * instance, so its public methods (unlock / __injectClears / __stepBoundary /
 * getAudioState) are all callable from the page.
 */

interface AudioState {
  segmentIndex: number;
  maxSegmentReached: number;
  segmentCount: number;
  transitionInFlight: boolean;
  segmentScore: number;
  tier: number;
  armedTier: number;
  tierCount: number;
  layerGains: number[];
  activeStems: number;
  recordedBedActive: boolean;
  bpm: number;
  trackId: string;
}

declare global {
  interface Window {
    __luminesAudioDev?: {
      unlock: () => Promise<void>;
      fire: (ev: {
        type: string;
        squares?: number;
        combo?: number;
        size?: number;
      }) => void;
      getAudioState: () => AudioState;
      __injectClears: (count?: number) => void;
      __stepBoundary: () => void;
    };
    __luminesProbe?: { audio?: AudioState };
  }
}

async function readAudio(
  page: import("@playwright/test").Page,
): Promise<AudioState> {
  return page.evaluate(() => window.__luminesAudioDev!.getAudioState());
}

/** Boot the page, click Start, unlock the engine, wait for the structured bed. */
async function bootAudio(page: import("@playwright/test").Page): Promise<void> {
  await page.goto("/?audiodev=1");
  await page.getByTestId("start-button").click();
  await page.evaluate(async () => {
    await window.__luminesAudioDev!.unlock();
  });
  await expect
    .poll(async () => (await readAudio(page)).recordedBedActive, {
      message: "the recorded structured bed should load",
      timeout: 20000,
    })
    .toBe(true);
}

test("structure manifest loads, a section HOLDS with no clears (clear-gated proof)", async ({
  page,
}) => {
  const consoleErrors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text());
  });
  const pageErrors: string[] = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));

  await bootAudio(page);

  const start = await readAudio(page);
  // Manifest loaded: more than one section, BPM from the manifest (~110), section 0.
  expect(start.segmentCount).toBeGreaterThan(1);
  expect(start.bpm).toBeGreaterThan(100);
  expect(start.bpm).toBeLessThan(120);
  expect(start.segmentIndex).toBe(0);
  // a bed is audible at the sticky entry floor (never bare).
  expect(start.activeStems).toBeGreaterThanOrEqual(1);

  // SECTION HOLDS: step many boundaries with NO clears -> the index must NOT advance
  // (the song does not move on its own; clears drive it).
  const heldIndices = await page.evaluate(() => {
    const dev = window.__luminesAudioDev!;
    const seen: number[] = [];
    for (let i = 0; i < 8; i++) {
      dev.__stepBoundary();
      seen.push(dev.getAudioState().segmentIndex);
    }
    return seen;
  });
  for (const idx of heldIndices) expect(idx).toBe(0);

  expect(consoleErrors, `console errors: ${consoleErrors.join(" | ")}`).toEqual(
    [],
  );
  expect(pageErrors, `page errors: ${pageErrors.join(" | ")}`).toEqual([]);
});

test("clears drive the tier UP then ADVANCE the section forward (no fast-forward)", async ({
  page,
}) => {
  const consoleErrors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text());
  });
  const pageErrors: string[] = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));

  await bootAudio(page);

  const result = await page.evaluate(() => {
    const dev = window.__luminesAudioDev!;
    const tier0 = dev.getAudioState().tier;

    // VERTICAL: a few clears, then a boundary -> the cumulative tier rises in place,
    // WITHOUT advancing the section. 4 injected clears = weight 16 (reveals tier2 at
    // ≥12) which is still below the advance threshold (30), so the section holds.
    dev.__injectClears(4);
    dev.__stepBoundary();
    const afterReveal = dev.getAudioState();

    // HORIZONTAL: a BURST of clears (far more than one advance's worth) then ONE
    // boundary -> advances exactly ONE section. The second boundary then proves
    // RESET-ON-ENTRY blocks a banked fast-forward: the burst's progress was zeroed on
    // entering the new section, so with no fresh clears there is nothing to advance on.
    // (NB the `__stepBoundary` dev hook releases the in-flight lock between manual
    // boundaries so stepping is deterministic; the production in-flight lock itself is
    // proven in the unit suite, which steps the REAL loop boundary without the hook.)
    const beforeAdvance = dev.getAudioState().segmentIndex;
    dev.__injectClears(40); // a huge burst
    dev.__stepBoundary();
    const afterOne = dev.getAudioState().segmentIndex;

    // a SECOND boundary with NO fresh clears must NOT advance again (no banked FF).
    dev.__stepBoundary();
    const afterTwo = dev.getAudioState().segmentIndex;

    return {
      tier0,
      revealTier: afterReveal.tier,
      revealIndex: afterReveal.segmentIndex,
      beforeAdvance,
      afterOne,
      afterTwo,
    };
  });

  // the tier rose on clears, in place (section did not advance during the reveal).
  expect(result.revealTier).toBeGreaterThan(result.tier0);
  expect(result.revealIndex).toBe(0);
  // the burst advanced EXACTLY one section...
  expect(result.afterOne - result.beforeAdvance).toBe(1);
  // ...and did NOT pre-pay a second advance (the next boundary held).
  expect(result.afterTwo - result.beforeAdvance).toBe(1);

  expect(consoleErrors, `console errors: ${consoleErrors.join(" | ")}`).toEqual(
    [],
  );
  expect(pageErrors, `page errors: ${pageErrors.join(" | ")}`).toEqual([]);
});

test("steady clearing walks the whole song forward-only to the last section", async ({
  page,
}) => {
  const consoleErrors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text());
  });
  const pageErrors: string[] = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));

  await bootAudio(page);

  const total = (await readAudio(page)).segmentCount;
  expect(total).toBeGreaterThanOrEqual(10); // the FULL fine cut (song1 = 12 sections)

  // Earn an advance every boundary (inject a comfortable over-threshold burst, step a
  // boundary), recording the index trajectory. Deterministic + fast (no real-time).
  const { indices, maxReached } = await page.evaluate(
    ({ steps, last }) => {
      const dev = window.__luminesAudioDev!;
      const seen: number[] = [dev.getAudioState().segmentIndex];
      let maxReached = dev.getAudioState().maxSegmentReached;
      for (let k = 0; k < steps; k++) {
        // Stop once we're ON the last section — earning a further advance there is
        // "past end of song", which switches tracks (rebuilds + resets the index);
        // this test proves the WALK to the last section, forward-only.
        if (dev.getAudioState().segmentIndex >= last) break;
        dev.__injectClears(12); // comfortably past the advance threshold
        dev.__stepBoundary();
        const s = dev.getAudioState();
        seen.push(s.segmentIndex);
        maxReached = Math.max(maxReached, s.maxSegmentReached);
      }
      return { indices: seen, maxReached };
    },
    { steps: total + 4, last: total - 1 },
  );

  // forward-only: the index never decrements and never jumps by more than one.
  for (let i = 1; i < indices.length; i++) {
    expect(indices[i]!).toBeGreaterThanOrEqual(indices[i - 1]!);
    expect(indices[i]! - indices[i - 1]!).toBeLessThanOrEqual(1);
  }
  // it walked all the way to the last section of the full track.
  expect(maxReached).toBeGreaterThanOrEqual(total - 1);

  expect(consoleErrors, `console errors: ${consoleErrors.join(" | ")}`).toEqual(
    [],
  );
  expect(pageErrors, `page errors: ${pageErrors.join(" | ")}`).toEqual([]);
});
