import { expect, test } from "@playwright/test";

/**
 * AUDIO STRUCTURE PROOF — headless proof of the HEAT-DRIVEN audio mechanics on the
 * REAL production bundle, driven via the `?audiodev=1` engine handle.
 *
 * The model under test (the player's CLEARS build a `heat` meter that drives the song,
 * NOT a clock):
 *  - the structure manifest loads (segmentCount > 1, BPM from the manifest);
 *  - a section HOLDS / loops in place with NO clears (the index does not advance);
 *  - clears build heat which drives the cumulative TIER UP within a section;
 *  - a section advances forward only once its TOP tier is audible AND held a loop;
 *  - CARRY-ACROSS: a section entered at sustained high heat starts at the SAME (top)
 *    tier — no vocal cut (post-transition tier >= pre-transition tier);
 *  - falling heat (clear-less passes) SHEDS the audible tier (down path);
 *  - NO bare-heat fast-forward: a 5-tier section held below its top does not advance;
 *  - a burst advances AT MOST one section per boundary (no fast-forward);
 *  - the advance is forward-only (the index is monotonic);
 *  - no console / page errors throughout.
 *
 * Drives the engine via the dev hooks: `__injectClears` (UP path, banks heat) +
 * `__stepBoundary` (fire a loop boundary) + `__decayPasses` (DOWN path, guaranteed
 * clear-less passes that shed heat). Fast + DETERMINISTIC — never waits the real bar.
 */

interface AudioState {
  segmentIndex: number;
  maxSegmentReached: number;
  segmentCount: number;
  transitionInFlight: boolean;
  heat: number;
  tier: number;
  armedTier: number;
  tierCount: number;
  layerGains: number[];
  activeStems: number;
  recordedBedActive: boolean;
  bpm: number;
  trackId: string;
  sfxMode: string;
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
      __decayPasses: (n?: number) => void;
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

test("structure manifest loads, a section HOLDS with no clears (heat-gated proof)", async ({
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
  expect(start.segmentCount).toBeGreaterThan(1);
  expect(start.bpm).toBeGreaterThan(100);
  expect(start.bpm).toBeLessThan(120);
  expect(start.segmentIndex).toBe(0);
  expect(start.heat).toBe(0);
  expect(start.sfxMode).toBe("tone"); // default SFX mode
  // a bed is audible at the min-audible floor (never bare).
  expect(start.activeStems).toBeGreaterThanOrEqual(1);

  // SECTION HOLDS: step many boundaries with NO clears -> the index must NOT advance
  // (the song does not move on its own; clears drive it).
  const heldIndices = await page.evaluate(() => {
    const dev = window.__luminesAudioDev!;
    const seen: number[] = [];
    for (let i = 0; i < 8; i++) {
      dev.__decayPasses(1); // guaranteed clear-less passes
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

test("clears build heat to drive the tier UP then ADVANCE the section (no fast-forward)", async ({
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

    // VERTICAL: clears + a boundary raise the audible tier in place (one step up from
    // the floor), without advancing while it is below the top. Inject enough heat that
    // the desired tier is above the floor on a 4-tier section (round(0.88*3)=3 desired,
    // so the audible tier steps up one from the floor on this boundary).
    dev.__injectClears(8);
    dev.__stepBoundary();
    const afterReveal = dev.getAudioState();

    // HORIZONTAL: pin heat to 1.0 and step boundaries until the section advances. The
    // tier climbs one step per boundary, the top is held one loop, then it advances
    // EXACTLY ONE section — never multiple per boundary (no fast-forward).
    const beforeAdvance = dev.getAudioState().segmentIndex;
    let steps = 0;
    const trajectory: number[] = [];
    while (
      dev.getAudioState().segmentIndex === beforeAdvance &&
      steps < 12
    ) {
      dev.__injectClears(12); // keep heat at 1.0 so the climb never decays
      dev.__stepBoundary();
      trajectory.push(dev.getAudioState().segmentIndex);
      steps++;
    }
    const afterOne = dev.getAudioState().segmentIndex;

    // further boundaries WITHOUT fresh clears must not advance many at once.
    dev.__decayPasses(1);
    dev.__decayPasses(1);
    const afterTwo = dev.getAudioState().segmentIndex;

    return {
      tier0,
      revealTier: afterReveal.tier,
      revealIndex: afterReveal.segmentIndex,
      beforeAdvance,
      afterOne,
      afterTwo,
      trajectory,
    };
  });

  // the tier rose on clears, in place (section did not advance during the reveal).
  expect(result.revealTier).toBeGreaterThan(result.tier0);
  expect(result.revealIndex).toBe(0);
  // the burst advanced EXACTLY one section across the climb...
  expect(result.afterOne - result.beforeAdvance).toBe(1);
  // ...and no boundary stepped more than one section (no fast-forward).
  let prev = result.beforeAdvance;
  for (const idx of result.trajectory) {
    expect(idx - prev).toBeLessThanOrEqual(1);
    prev = idx;
  }

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
  // the opening section is audible at >=2 cumulative layers (tier index >= 1).
  expect(start.segmentIndex).toBe(0);
  expect(start.tier).toBeGreaterThanOrEqual(1);
  expect(start.activeStems).toBeGreaterThanOrEqual(1);

  // Walk forward a few sections; after each advance, wait for the destination's players
  // to load, then assert the settled entry holds >=2 layers (never bare).
  for (let k = 0; k < 4; k++) {
    await page.evaluate(() => {
      const dev = window.__luminesAudioDev!;
      for (let i = 0; i < 12; i++) {
        dev.__injectClears(12);
        dev.__stepBoundary();
        if (dev.getAudioState().segmentIndex > 0) break;
      }
    });
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

test("CARRY-ACROSS: sustained heat keeps the top tier across a transition (no vocal cut)", async ({
  page,
}) => {
  const consoleErrors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text());
  });
  const pageErrors: string[] = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));

  await bootAudio(page);

  // build heat to the top tier of section 0 and advance, keeping heat pinned ~1.0;
  // record the pre-transition (top) tier. Stops as soon as the index advances.
  const pre = await page.evaluate(() => {
    const dev = window.__luminesAudioDev!;
    let preTier = dev.getAudioState().tier;
    const before = dev.getAudioState().segmentIndex;
    let steps = 0;
    while (dev.getAudioState().segmentIndex === before && steps < 16) {
      dev.__injectClears(12); // pin heat to 1.0
      preTier = Math.max(preTier, dev.getAudioState().tier);
      dev.__stepBoundary();
      steps++;
    }
    return { preTier, advancedTo: dev.getAudioState().segmentIndex };
  });
  expect(pre.advancedTo).toBeGreaterThan(0); // it advanced

  // THE no-vocal-cut OBSERVABLE: after the destination segment's players LOAD + the
  // heat-carry reconciles (async over the network in the real bundle), the post-
  // transition tier is >= the pre-transition tier — sustained heat carries the top
  // tier across, vocals don't drop. Poll so we don't race the loader.
  await expect
    .poll(async () => (await readAudio(page)).tier, {
      timeout: 10000,
      message: "post-transition tier should carry across (>= pre-transition tier)",
    })
    .toBeGreaterThanOrEqual(pre.preTier);

  expect(consoleErrors, `console errors: ${consoleErrors.join(" | ")}`).toEqual(
    [],
  );
  expect(pageErrors, `page errors: ${pageErrors.join(" | ")}`).toEqual([]);
});

test("DOWN path: clear-less passes SHED the audible tier (falling heat drops layers)", async ({
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
    // raise the audible tier above the floor WITHOUT reaching the top (so it cannot
    // advance and re-enter at a carried tier). A few clears -> a mid tier.
    dev.__injectClears(5);
    dev.__stepBoundary();
    const high = dev.getAudioState().tier;
    // now shed with the DISTINCT down-path hook (guaranteed clear-less passes).
    let low = high;
    for (let i = 0; i < 12; i++) {
      dev.__decayPasses(1);
      low = Math.min(low, dev.getAudioState().tier);
    }
    return { high, low, floor: dev.getAudioState().tier };
  });

  // the tier was raised, then SHED back down by falling heat...
  expect(result.high).toBeGreaterThanOrEqual(1);
  expect(result.low).toBeLessThan(result.high);
  // ...and never fell below the >=2-layer floor.
  expect(result.low).toBeGreaterThanOrEqual(1);

  expect(consoleErrors, `console errors: ${consoleErrors.join(" | ")}`).toEqual(
    [],
  );
  expect(pageErrors, `page errors: ${pageErrors.join(" | ")}`).toEqual([]);
});

test("NO bare-heat: a section held below its top tier does not advance", async ({
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
    // Step boundaries while pinning heat to 1.0, recording (pre-boundary tier, index)
    // each pass. The invariant: the index must NEVER increase on a boundary whose
    // PRE-boundary audible tier was below the segment's top — i.e. the song never
    // advances past a tier the player has not heard (no bare-heat fast-forward). The
    // tier climbs ONE step per boundary, so there are several boundaries where it is
    // below the top, and NONE of them may advance.
    const violations: { preTier: number; top: number }[] = [];
    let prev = dev.getAudioState();
    for (let k = 0; k < 16; k++) {
      const preTier = prev.tier;
      const preTop = prev.tierCount - 1;
      const preIndex = prev.segmentIndex;
      dev.__injectClears(12); // pin heat to 1.0 (desired = top)
      dev.__stepBoundary();
      const cur = dev.getAudioState();
      // an index increase on a boundary whose pre-boundary tier was below the top is a
      // bare-heat fast-forward (advancing past unheard material) — forbidden.
      if (cur.segmentIndex > preIndex && preTier < preTop) {
        violations.push({ preTier, top: preTop });
      }
      prev = cur;
    }
    return { violations };
  });

  // no boundary advanced the section while its pre-boundary audible tier was below top.
  expect(result.violations).toEqual([]);

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
  const last = total - 1;

  // Walk the whole song. For EACH section: wait for its players to load (so it can
  // actually reach its top tier — the real bundle loads segments async over the
  // network), pin heat to 1.0, step boundaries until it advances, then record the index.
  // Interleaving page-level polls is required because a synchronous evaluate() would
  // outrun the loader and stall on an unloaded destination.
  const indices: number[] = [(await readAudio(page)).segmentIndex];
  for (let section = 0; section < total + 6; section++) {
    const here = (await readAudio(page)).segmentIndex;
    if (here >= last) break;
    // wait for THIS section's audible tier to reach its top under pinned heat (its
    // players must have loaded + the tier climbed), then advance off it.
    await expect
      .poll(
        async () => {
          const s = await page.evaluate(() => {
            const dev = window.__luminesAudioDev!;
            dev.__injectClears(12); // pin heat to 1.0
            dev.__stepBoundary();
            const a = dev.getAudioState();
            return { tier: a.tier, top: a.tierCount - 1, index: a.segmentIndex };
          });
          // advanced (index moved) OR reached the top (about to advance next boundary).
          return s.index > here || s.tier >= s.top ? "ready" : "climbing";
        },
        { timeout: 12000, message: `section ${here} should build to its top + advance` },
      )
      .toBe("ready");
    // one more boundary to commit the advance off the held top, then record.
    await page.evaluate(() => {
      const dev = window.__luminesAudioDev!;
      dev.__injectClears(12);
      dev.__stepBoundary();
    });
    indices.push((await readAudio(page)).segmentIndex);
  }

  const maxReached = (await readAudio(page)).maxSegmentReached;

  // forward-only: the recorded index trajectory never decrements (the one-step-per-
  // boundary cap is proven deterministically in the unit suite).
  for (let i = 1; i < indices.length; i++) {
    expect(indices[i]!).toBeGreaterThanOrEqual(indices[i - 1]!);
  }
  // it walked all the way to the last section of the full track.
  expect(maxReached).toBeGreaterThanOrEqual(total - 1);

  expect(consoleErrors, `console errors: ${consoleErrors.join(" | ")}`).toEqual(
    [],
  );
  expect(pageErrors, `page errors: ${pageErrors.join(" | ")}`).toEqual([]);
});
