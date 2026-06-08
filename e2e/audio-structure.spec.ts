import { expect, test } from "@playwright/test";

/**
 * AUDIO STRUCTURE PROOF (v2.7) — headless proof of the loop-vs-play mechanics on
 * the REAL production bundle, driven via the `?audiodev=1` engine handle.
 *
 * Asserts (the MECHANICS, not the feel — feel is the human ear-check):
 *  - the structure manifest loads (segmentCount > 1, BPM from the manifest);
 *  - a LOOPER section HOLDS (index steady) with no clears;
 *  - firing clears ADVANCES the song forward (index increases), MONOTONICALLY;
 *  - a clear reveals/arms the vocal (vox gain rises within a vocal section);
 *  - CLEAR IS SILENT is the model (no SFX channel on clears — verified in unit
 *    tests; here we assert clearing's only effect is advance + reveal, no throw);
 *  - no console / page errors throughout.
 *
 * Drives the engine directly (unlock + fire) so it doesn't depend on skilful
 * block-clearing, then reads `window.__luminesProbe.audio` (the live getAudioState).
 */

interface AudioState {
  segmentIndex: number;
  maxSegmentReached: number;
  segmentCount: number;
  activeRole: string | null;
  activeBedMode: string | null;
  transitionInFlight: boolean;
  sectionClearProgress: number;
  voxUnlocked: boolean;
  voxArmed: boolean;
  recordedBedActive: boolean;
  bpm: number;
  layerGains: { bed: number; vox: number };
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
      setPreset: (m: "A" | "B" | "C") => void;
    };
    __luminesProbe?: { audio?: AudioState };
  }
}

async function readAudio(
  page: import("@playwright/test").Page,
): Promise<AudioState> {
  return page.evaluate(() => window.__luminesAudioDev!.getAudioState());
}

test("structure manifest loads, looper holds, clears advance forward (probe proof)", async ({
  page,
}) => {
  const consoleErrors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text());
  });
  const pageErrors: string[] = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));

  await page.goto("/?audiodev=1");
  await page.getByTestId("start-button").click();
  // unlock the audio engine on the user gesture (Start already calls it, but the
  // handle lets us guarantee it for the probe path).
  await page.evaluate(async () => {
    await window.__luminesAudioDev!.unlock();
  });

  // Wait for the structured bed to load (recordedBedActive true).
  await expect
    .poll(async () => (await readAudio(page)).recordedBedActive, {
      message: "the recorded structured bed should load",
      timeout: 20000,
    })
    .toBe(true);

  const start = await readAudio(page);
  // Manifest loaded: more than one section, BPM from the manifest (~110, not the
  // old hardcoded 112), starts on section 0 (a looper).
  expect(start.segmentCount).toBeGreaterThan(1);
  expect(start.bpm).toBeGreaterThan(100);
  expect(start.bpm).toBeLessThan(120);
  expect(start.segmentIndex).toBe(0);
  expect(start.activeRole).toBe("looper");
  expect(start.layerGains.bed).toBeGreaterThan(0.5);

  // LOOPER HOLDS: no clears for a moment -> index must not move.
  await page.waitForTimeout(800);
  expect((await readAudio(page)).segmentIndex).toBe(0);

  // Drive clears via the engine handle; record the index trajectory.
  const indices: number[] = [];
  for (let i = 0; i < 24; i++) {
    await page.evaluate(() =>
      window.__luminesAudioDev!.fire({
        type: "lineClear",
        squares: 2,
        combo: 1,
      }),
    );
    await page.waitForTimeout(120);
    indices.push((await readAudio(page)).segmentIndex);
  }
  const end = await readAudio(page);

  // Advanced forward off section 0...
  expect(end.segmentIndex).toBeGreaterThan(0);
  expect(end.maxSegmentReached).toBeGreaterThan(0);
  // ...monotonically (forward-only, never rewinds).
  for (let i = 1; i < indices.length; i++) {
    expect(indices[i]!).toBeGreaterThanOrEqual(indices[i - 1]!);
  }

  expect(consoleErrors, `console errors: ${consoleErrors.join(" | ")}`).toEqual(
    [],
  );
  expect(pageErrors, `page errors: ${pageErrors.join(" | ")}`).toEqual([]);
});

test("the song progresses through ALL sections to end-of-song (full-track proof)", async ({
  page,
}) => {
  // Section advances are bar-aligned (each step waits a bar boundary), so walking
  // a 12-section song takes real wall-clock time — give the test room.
  test.setTimeout(180_000);
  const consoleErrors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text());
  });
  const pageErrors: string[] = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));

  await page.goto("/?audiodev=1");
  await page.getByTestId("start-button").click();
  await page.evaluate(async () => {
    await window.__luminesAudioDev!.unlock();
    window.__luminesAudioDev!.setPreset("C"); // fastest advance to walk the whole song
    (window as unknown as { __songComplete?: boolean }).__songComplete = false;
    (
      window.__luminesAudioDev as unknown as { onSongComplete?: () => void }
    ).onSongComplete = () => {
      (window as unknown as { __songComplete?: boolean }).__songComplete = true;
    };
  });
  await expect
    .poll(async () => (await readAudio(page)).recordedBedActive, {
      timeout: 20000,
    })
    .toBe(true);

  const total = (await readAudio(page)).segmentCount;
  expect(total).toBeGreaterThanOrEqual(10); // the FULL song (song1 = 12 sections)

  // Drive clears from INSIDE the page on a steady cadence (a clear every 150ms),
  // tracking the max section reached + onSongComplete, until done or ~150s.
  const result = await page.evaluate(async () => {
    const dev = window.__luminesAudioDev!;
    const w = window as unknown as { __songComplete?: boolean };
    let maxReached = 0;
    const t0 = Date.now();
    while (Date.now() - t0 < 150000) {
      dev.fire({ type: "lineClear", squares: 2, combo: 2 });
      await new Promise((r) => setTimeout(r, 150));
      maxReached = Math.max(maxReached, dev.getAudioState().maxSegmentReached);
      if (w.__songComplete === true) break;
    }
    return { maxReached, complete: w.__songComplete === true };
  });

  // Proof: the song walked through to the LAST section (full track) AND fired
  // end-of-song.
  expect(
    result.maxReached,
    `should reach the final section (of ${total})`,
  ).toBeGreaterThanOrEqual(total - 1);
  expect(result.complete, "onSongComplete should fire at end-of-song").toBe(
    true,
  );

  expect(consoleErrors, `console errors: ${consoleErrors.join(" | ")}`).toEqual(
    [],
  );
  expect(pageErrors, `page errors: ${pageErrors.join(" | ")}`).toEqual([]);
});

test("a clear reveals the vocal within a vocal section (no clear-sound, just the vox)", async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));

  await page.goto("/?audiodev=1");
  await page.getByTestId("start-button").click();
  await page.evaluate(async () => {
    await window.__luminesAudioDev!.unlock();
    window.__luminesAudioDev!.setPreset("C"); // fastest reveal/advance for the proof
  });
  await expect
    .poll(async () => (await readAudio(page)).recordedBedActive, {
      timeout: 20000,
    })
    .toBe(true);

  // Clear (in-page, steady cadence) until a vocal section reveals its vocal.
  const { maxVox, reachedVocalSection } = await page.evaluate(async () => {
    const dev = window.__luminesAudioDev!;
    let maxVox = 0;
    let reached = false;
    const t0 = Date.now();
    while (Date.now() - t0 < 25000) {
      dev.fire({ type: "lineClear", squares: 2, combo: 1 });
      await new Promise((r) => setTimeout(r, 120));
      const s = dev.getAudioState();
      if (s.voxUnlocked || s.voxArmed || s.layerGains.vox > 0) reached = true;
      maxVox = Math.max(maxVox, s.layerGains.vox);
      if (maxVox > 0.5) break;
    }
    return { maxVox, reachedVocalSection: reached };
  });

  // The vocal layer became audible at some point (the only audible effect of a
  // clear — there is no clear SFX).
  expect(
    reachedVocalSection,
    "a clear should reveal/arm a section's vocal",
  ).toBe(true);
  expect(
    maxVox,
    "the vocal layer should rise above silence on clears",
  ).toBeGreaterThan(0.3);

  expect(pageErrors, `page errors: ${pageErrors.join(" | ")}`).toEqual([]);
});
