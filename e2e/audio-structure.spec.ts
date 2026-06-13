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

    // HORIZONTAL: a BURST of clears (far more than one advance's worth), then step
    // boundaries until it advances. A burst that also maxes the tier reveals the top
    // tier on one boundary and advances on the NEXT (the engine never advances off the
    // top on the same boundary it reveals it — vocals are heard first), so this can take
    // up to two steps. It must advance EXACTLY ONE section, then RESET-ON-ENTRY blocks a
    // banked fast-forward: the burst's progress was zeroed on entry, so with no fresh
    // clears the following boundaries do NOT advance again.
    // (NB `__stepBoundary` releases the in-flight lock between manual boundaries so
    // stepping is deterministic; the production in-flight lock is proven in the unit
    // suite, which steps the REAL loop boundary without the hook.)
    const beforeAdvance = dev.getAudioState().segmentIndex;
    dev.__injectClears(40); // a huge burst
    let steps = 0;
    while (
      dev.getAudioState().segmentIndex === beforeAdvance &&
      steps < 4
    ) {
      dev.__stepBoundary();
      steps++;
    }
    const afterOne = dev.getAudioState().segmentIndex;

    // further boundaries with NO fresh clears must NOT advance again (no banked FF).
    dev.__stepBoundary();
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
  // ...and did NOT pre-pay a further advance (the next boundaries held).
  expect(result.afterTwo - result.beforeAdvance).toBe(1);

  expect(consoleErrors, `console errors: ${consoleErrors.join(" | ")}`).toEqual(
    [],
  );
  expect(pageErrors, `page errors: ${pageErrors.join(" | ")}`).toEqual([]);
});

test("the OPENING starts at >=2 cumulative layers (never bare)", async ({
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
  // the opening section is audible at >=2 cumulative layers (tier index >= 1 =
  // drums+bass), never a bare ~1-layer tier0.
  expect(start.segmentIndex).toBe(0);
  expect(start.tier).toBeGreaterThanOrEqual(1);
  expect(start.activeStems).toBeGreaterThanOrEqual(1);

  // Walk forward a few sections; after EACH advance, wait for the destination's players
  // to finish loading over the network (the advance-into-unloaded window can momentarily
  // read a lower loaded tier), then assert the SETTLED entry holds >=2 layers. This
  // proves the steady-state min-2-layers floor without racing the async loader.
  for (let k = 0; k < 4; k++) {
    await page.evaluate(() => {
      const dev = window.__luminesAudioDev!;
      dev.__injectClears(12); // earn an advance
      dev.__stepBoundary();
    });
    // Wait for the freshly-entered section to SETTLE at the >=2-layer floor. The
    // advance-into-unloaded window can momentarily read a lower loaded tier until the
    // floor tier's player loads + reconciles up; the engine's load-reconcile must lift
    // the audible tier to at least the floor (tier index >= 1), never leaving it bare.
    await expect
      .poll(async () => (await readAudio(page)).tier, {
        timeout: 10000,
        message: "settled entry must reach the >=2-layer floor (tier >= 1)",
      })
      .toBeGreaterThanOrEqual(1);
  }

  expect(consoleErrors, `console errors: ${consoleErrors.join(" | ")}`).toEqual(
    [],
  );
  expect(pageErrors, `page errors: ${pageErrors.join(" | ")}`).toEqual([]);
});

test("a fully-revealed (vocals) section advances even below the clear-threshold", async ({
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
  const top = start.tierCount - 1;
  expect(top).toBeGreaterThanOrEqual(1);
  const beforeIndex = start.segmentIndex;

  // Bank a clear-progress amount that reveals the TOP tier (>= top*TIER_REVEAL_STEP=18
  // for a 4-tier section) but stays BELOW the advance threshold (30): 5 clears = score
  // 20. The mandatory full-reveal advance then fires ONE loop after the top is audible —
  // all below the clear-gate, proving it's the full-reveal path and not the threshold.
  await page.evaluate(() => {
    window.__luminesAudioDev!.__injectClears(5); // score 20: reveals top tier, < 30
  });

  // Poll: step a boundary, let any pending tier-player load settle, recording the MAX
  // audible tier and MAX clear-progress seen BEFORE the advance commits. The top tier's
  // player may still be loading over the network, so the reveal (and thus the advance)
  // can take a couple of steps; the poll waits it out.
  let maxTierSeen = start.tier;
  let maxScoreBeforeAdvance = start.segmentScore;
  await expect
    .poll(
      async () => {
        const cur = await readAudio(page);
        if (cur.segmentIndex === beforeIndex) {
          maxTierSeen = Math.max(maxTierSeen, cur.tier);
          maxScoreBeforeAdvance = Math.max(maxScoreBeforeAdvance, cur.segmentScore);
        }
        await page.evaluate(() => window.__luminesAudioDev!.__stepBoundary());
        return (await readAudio(page)).segmentIndex;
      },
      { timeout: 10000, message: "full-reveal should force an advance" },
    )
    .toBeGreaterThan(beforeIndex);

  // the top tier (vocals) WAS revealed in the originating section...
  expect(maxTierSeen).toBe(top);
  // ...and the advance happened on the MANDATORY full-reveal path, NOT the clear-gate:
  // the clear-progress never reached ADVANCE_THRESHOLD (30) before the section advanced.
  expect(maxScoreBeforeAdvance).toBeLessThan(30);

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

  // Walk the song: for each section, bank a comfortable over-threshold burst then step
  // boundaries until it advances (a burst that maxes the tier reveals the top on one
  // boundary and advances on the NEXT, so each section can take a couple of steps),
  // recording the index trajectory. Deterministic + fast (no real-time).
  const { indices, maxReached } = await page.evaluate(
    ({ sections, last }) => {
      const dev = window.__luminesAudioDev!;
      const seen: number[] = [dev.getAudioState().segmentIndex];
      let maxReached = dev.getAudioState().maxSegmentReached;
      for (let section = 0; section < sections; section++) {
        // Stop once we're ON the last section — earning a further advance there is
        // "past end of song", which switches tracks (rebuilds + resets the index);
        // this test proves the WALK to the last section, forward-only.
        if (dev.getAudioState().segmentIndex >= last) break;
        const here = dev.getAudioState().segmentIndex;
        dev.__injectClears(12); // comfortably past the advance threshold
        // step boundaries until THIS section advances (reveal-then-advance = up to ~3).
        let guard = 0;
        while (dev.getAudioState().segmentIndex === here && guard < 5) {
          dev.__stepBoundary();
          guard++;
        }
        const s = dev.getAudioState();
        seen.push(s.segmentIndex);
        maxReached = Math.max(maxReached, s.maxSegmentReached);
      }
      return { indices: seen, maxReached };
    },
    { sections: total + 4, last: total - 1 },
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
