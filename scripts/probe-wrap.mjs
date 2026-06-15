// REAL-TRANSPORT, REENTRANT wrap-stall probe. The synchronous __stepBoundary e2e MISSES
// the bug because (a) it never exercises the engine's OWN scheduled loop boundary after a
// wrap, and (b) it never triggers the wrap the way real play does: from INSIDE a scheduled
// onLoopBoundary callback (terminal advance -> complete -> onSongComplete -> switchTrack).
//
// This probe reproduces the REAL path: it wires onSongComplete to advance the skin/track
// (mirroring GameShell), forces the engine to its TERMINAL segment with the top tier held,
// then lets the engine's OWN scheduled boundary fire the terminal advance -> onSongComplete
// -> switchTrack, REENTRANTLY. It does this for song1 -> song2, then song2 -> song1 (the
// wrap), then asserts the wrapped song1 builds its tier + ADVANCES in REAL TIME via the real
// scheduled boundaries (NO __stepBoundary).
//
// Usage: node scripts/probe-wrap.mjs [baseURL]
import { chromium } from "@playwright/test";

const BASE = process.argv[2] ?? "http://localhost:3301";
const POLL_MS = 250;

async function readState(page) {
  return page.evaluate(() => window.__luminesAudioDev.getAudioState());
}

// Drive the current song to its terminal completion using the deterministic boundary
// stepper (this is the TRIGGER only — faithful, since in real play the terminal advance
// ALSO fires synchronously inside onLoopBoundary; the bug under test is the POST-wrap
// scheduling which we verify with REAL boundaries afterwards). Returns the new track id.
async function completeCurrentSong(page, fromTrackId) {
  for (let i = 0; i < 400; i++) {
    const swapped = await page.evaluate((from) => {
      const dev = window.__luminesAudioDev;
      dev.__injectClears(12); // pin heat to 1.0
      dev.__stepBoundary();
      return dev.getAudioState().trackId !== from;
    }, fromTrackId);
    if (swapped) break;
  }
  // the swap's async load resolves on real time — wait for the new song's bed.
  for (let i = 0; i < 60; i++) {
    const s = await readState(page);
    if (s.trackId !== fromTrackId && s.activeStems > 0) break;
    await page.waitForTimeout(300);
  }
  return (await readState(page)).trackId;
}

async function main() {
  const browser = await chromium.launch({
    args: ["--autoplay-policy=no-user-gesture-required"],
  });
  const page = await browser.newPage();
  const errors = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(String(e.message)));

  await page.goto(`${BASE}/?audiodev=1`, { waitUntil: "networkidle" });
  await page.getByTestId("start-button").click();
  await page.evaluate(async () => {
    await window.__luminesAudioDev.unlock();
  });
  for (let i = 0; i < 60; i++) {
    const ok = await page.evaluate(
      () => window.__luminesAudioDev?.getAudioState().recordedBedActive === true,
    );
    if (ok) break;
    await page.waitForTimeout(500);
  }
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);

  // NOTE: onSongComplete is ALREADY wired by GameShell to advanceSkin -> switchTrack
  // (the dev handle IS the real engine instance). We do NOT override it — this keeps the
  // wrap path byte-faithful to real play (terminal advance -> complete -> onSongComplete
  // -> advanceSkin -> switchTrack, reentrant inside onLoopBoundary).

  const song1 = (await readState(page)).trackId;
  console.log("FRESH song1:", JSON.stringify(await readState(page)));

  // ── song1 -> song2: trigger terminal completion (reentrant switchTrack) ──
  const song2 = await completeCurrentSong(page, song1);
  console.log("after completion 1 -> track:", song2, JSON.stringify(await readState(page)));
  if (song2 === song1) { console.log("FAILED to reach song2 — aborting"); await browser.close(); process.exit(2); }

  // ── song2 -> song1 (THE WRAP): trigger terminal completion again ──
  const wrappedId = await completeCurrentSong(page, song2);
  const wrapped = await readState(page);
  console.log("WRAPPED back to:", wrappedId, JSON.stringify(wrapped));

  // ── REAL-TIME progression on the wrapped song1: inject clears, let the engine's OWN
  //    scheduled boundaries fire. NO __stepBoundary. Watch for tier build + advance. ──
  await page.evaluate(() => {
    const dev = window.__luminesAudioDev;
    window.__wrapClearTimer = setInterval(() => dev.__injectClears(12), 500);
  });

  const RUN_MS = 80_000; // song1 intro ~34.9s; watch ~2+ real boundaries.
  const samples = [];
  const t0 = Date.now();
  let topReachedAt = null;
  let advancedAt = null;
  const tierCount = wrapped.tierCount;
  while (Date.now() - t0 < RUN_MS) {
    const s = await readState(page);
    const rel = Math.round((Date.now() - t0) / 1000);
    samples.push({ rel, idx: s.segmentIndex, tier: s.tier, heat: +s.heat.toFixed(2), stems: s.activeStems, track: s.trackId, tif: s.transitionInFlight, tf: s.tierFading });
    if (topReachedAt == null && s.tier >= tierCount - 1) topReachedAt = rel;
    if (advancedAt == null && (s.segmentIndex > 0 || s.trackId !== "song1")) advancedAt = rel;
    await page.waitForTimeout(POLL_MS);
  }
  await page.evaluate(() => clearInterval(window.__wrapClearTimer));

  const maxTier = Math.max(...samples.map((s) => s.tier));
  const minStems = Math.min(...samples.map((s) => s.stems));
  const finalIdx = samples[samples.length - 1].idx;
  console.log("\ntierCount:", tierCount, "topTier:", tierCount - 1);
  console.log("maxTier reached:", maxTier, "tier reached TOP at:", topReachedAt, "s");
  console.log("ADVANCED at:", advancedAt, "s   finalSegmentIndex:", finalIdx);
  console.log("min activeStems:", minStems);
  console.log("trace [s,idx,tier,heat,stems,tif,tf]:", JSON.stringify(samples.filter((_, i) => i % 4 === 0).map((s) => [s.rel, s.idx, s.tier, s.heat, s.stems, s.tif ? 1 : 0, s.tf ? 1 : 0])));
  console.log("errors:", errors.length ? errors : "none");

  await browser.close();

  const checks = [];
  checks.push(["wrapped to song1 with audio", wrapped.trackId === "song1" && wrapped.activeStems > 0, JSON.stringify({ track: wrapped.trackId, stems: wrapped.activeStems })]);
  checks.push(["never silent post-wrap (stems >= 1)", minStems >= 1, `min ${minStems}`]);
  checks.push(["tier BUILT to top (real boundary fired)", maxTier >= tierCount - 1, `maxTier ${maxTier}/${tierCount - 1}`]);
  checks.push(["ADVANCED off the intro in real time", advancedAt != null, `advancedAt ${advancedAt}s`]);
  checks.push(["no page errors", errors.length === 0, `${errors.length}`]);

  let pass = true;
  for (const [name, ok, detail] of checks) {
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}  (${detail})`);
    if (!ok) pass = false;
  }
  console.log(`\nRESULT: ${pass ? "PASS" : "FAIL"}`);
  process.exit(pass ? 0 : 1);
}

main().catch((e) => {
  console.error("probe error:", e);
  process.exit(2);
});
