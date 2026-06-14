/**
 * REAL-ENGINE, REAL-ASSET check for the song-WRAP STALL playtest bug (Rai):
 *
 *   "When you get back to skin1 after completing skin2, you can't progress past
 *    the intro."
 *
 * The game cycles TWO songs/skins (song1 -> song2 -> wraps back to song1, an
 * infinite loop). A FRESH song1 progresses fine. The report is that after the WRAP
 * back to song1 the progression STALLS on the intro and never advances.
 *
 * This drives the REAL production engine with the REAL manifest + REAL opus assets
 * via the audiodev hook. It traverses each song quickly with `__stepBoundary` (the
 * deterministic boundary stepper), then after the wrap back to song1 it asserts the
 * wrapped song is genuinely HEALTHY: its segment 0 has loaded, audible tier audio
 * (activeStems > 0) and the index advances forward — i.e. the swap did not leave a
 * silent / unbuildable segment. Runs under the production-start config (real bundle,
 * audio enabled, no TEST_MODE).
 */
import { expect, test } from "@playwright/test";

interface AudioState {
  segmentIndex: number;
  segmentCount: number;
  trackId: string;
  tier: number;
  tierCount: number;
  transitionInFlight: boolean;
  tierFading: boolean;
  activeStems: number;
  recordedBedActive: boolean;
}

declare global {
  interface Window {
    __luminesAudioDev?: {
      unlock: () => Promise<void>;
      getAudioState: () => AudioState;
      __injectClears: (count?: number) => void;
      __stepBoundary: () => void;
    };
  }
}

async function readAudio(
  page: import("@playwright/test").Page,
): Promise<AudioState> {
  return page.evaluate(() => window.__luminesAudioDev!.getAudioState());
}

async function bootAudio(page: import("@playwright/test").Page): Promise<void> {
  await page.goto("/?audiodev=1");
  await page.getByTestId("start-button").click();
  // The audiodev engine hook only exists in the REAL (non-TEST_MODE) bundle. Under the
  // TEST_MODE config the engine isn't built — skip rather than fail (this spec is meant
  // for the production-start config, mirroring the audio-structure specs).
  const hasEngine = await page.evaluate(
    () => typeof window.__luminesAudioDev !== "undefined",
  );
  test.skip(!hasEngine, "audiodev engine hook absent (TEST_MODE bundle)");
  await page.evaluate(async () => {
    await window.__luminesAudioDev!.unlock();
  });
  await expect
    .poll(async () => (await readAudio(page)).recordedBedActive, {
      message: "the recorded structured bed should load",
      timeout: 30000,
    })
    .toBe(true);
}

/**
 * Step the current song to completion with the deterministic boundary stepper, then
 * wait (real time) for the async switchTrack to swap the track. Returns the new id.
 */
async function completeCurrentSong(
  page: import("@playwright/test").Page,
  fromTrackId: string,
): Promise<string> {
  // step boundaries until the terminal advance fires onSongComplete -> switchTrack.
  for (let i = 0; i < 400; i++) {
    const swapped = await page.evaluate((from) => {
      const dev = window.__luminesAudioDev!;
      dev.__injectClears(12); // pin heat to 1.0
      dev.__stepBoundary();
      return dev.getAudioState().trackId !== from;
    }, fromTrackId);
    if (swapped) break;
  }
  // the swap's async load resolves on real time — wait for the new song's bed.
  await expect
    .poll(async () => (await readAudio(page)).trackId, { timeout: 20000 })
    .not.toBe(fromTrackId);
  await expect
    .poll(async () => (await readAudio(page)).activeStems, { timeout: 20000 })
    .toBeGreaterThan(0);
  return (await readAudio(page)).trackId;
}

test("WRAP STALL: a wrapped song1 (song1 -> song2 -> song1) is healthy + advances (real assets)", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const pageErrors: string[] = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));

  await bootAudio(page);
  const song1 = (await readAudio(page)).trackId;
  expect((await readAudio(page)).segmentIndex).toBe(0);

  const song2 = await completeCurrentSong(page, song1);
  expect(song2).not.toBe(song1);

  const wrapped = await completeCurrentSong(page, song2);
  expect(wrapped).toBe(song1); // wrapped back to song1

  // The wrapped song1 must be HEALTHY: its segment 0 audio loaded + audible, not a
  // silent / unbuildable segment (the stall signature).
  const s = await readAudio(page);
  expect(
    s.activeStems,
    `wrapped song1 segment 0 has NO audible audio (silent stall): ${JSON.stringify(s)}`,
  ).toBeGreaterThan(0);

  // And it must ADVANCE off the intro under the (real) advance gate.
  const before = s.segmentIndex;
  let advanced = false;
  for (let i = 0; i < 60; i++) {
    advanced = await page.evaluate((b) => {
      const dev = window.__luminesAudioDev!;
      dev.__injectClears(12);
      dev.__stepBoundary();
      const a = dev.getAudioState();
      return a.segmentIndex > b || a.trackId !== window.__luminesAudioDev!.getAudioState().trackId;
    }, before);
    const a = await readAudio(page);
    if (a.segmentIndex > before || a.trackId !== wrapped) {
      advanced = true;
      break;
    }
  }
  const end = await readAudio(page);
  expect(
    advanced,
    `wrapped song1 stalled: ${JSON.stringify(end)}`,
  ).toBe(true);

  expect(pageErrors, `page errors: ${pageErrors.join(" | ")}`).toEqual([]);
});
