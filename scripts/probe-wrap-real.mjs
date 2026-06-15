// REAL-BOUNDARY wrap-stall repro. Unlike probe-wrap.mjs (which uses __stepBoundary to
// traverse, leaving NO real pending afterSettle callbacks at wrap time), this drives the
// FINAL completion of each song via REAL scheduled boundaries so the outgoing song's
// swapTier/advance afterSettle callbacks are genuinely IN FLIGHT when the reentrant
// switchTrack fires. It also lets real transport time accumulate. This is the path the
// synchronous e2e + the boot-time probe both miss.
//
// To make each song complete on a REAL boundary quickly, it forces the engine to the
// LAST-but-one segment with heat pinned, then lets the real loop boundary advance into the
// terminal segment and (a boundary later) fire the terminal completion -> reentrant
// switchTrack. After the wrap it watches the wrapped song1 build + advance using ONLY real
// scheduled boundaries (no __stepBoundary).
//
// Usage: node scripts/probe-wrap-real.mjs [baseURL]
import { chromium } from "@playwright/test";

const BASE = process.argv[2] ?? "http://localhost:3301";

async function readState(page) {
  return page.evaluate(() => window.__luminesAudioDev.getAudioState());
}

// Force the engine onto the terminal segment with the top tier ARMED but NOT yet held, so
// the next real boundary reveals/holds it and a later real boundary fires the terminal
// completion. Crucially we ALSO leave a real tier crossfade in flight by NOT clearing
// tierFading — we instead trigger a genuine swapTier on the prior segment first.
async function forceNearTerminalThenStartFade(page) {
  // First LOAD the terminal segment's players (only seg0 + prefetch are loaded normally),
  // then jump onto it. Without loaded players the segment is silent for reasons unrelated
  // to the bug under test.
  await page.evaluate(async () => {
    const e = window.__luminesAudioDev;
    const lastIdx = e.segments.length - 1;
    await e.loadSegment(lastIdx);
  });
  // wait for the terminal segment's players to actually exist.
  for (let i = 0; i < 60; i++) {
    const ok = await page.evaluate(() => {
      const e = window.__luminesAudioDev;
      const seg = e.segments[e.segments.length - 1];
      return seg && seg.tierPlayers.some((p) => p);
    });
    if (ok) break;
    await page.waitForTimeout(250);
  }
  await page.evaluate(() => {
    const e = window.__luminesAudioDev;
    const segs = e.segments;
    const lastIdx = segs.length - 1;
    const seg = segs[lastIdx];
    const top = Math.max(0, seg.tierKeys.length - 1);
    e.segmentIndex = lastIdx;
    e.maxSegmentReached = lastIdx;
    e.heat = 1;
    // start one BELOW top so the next real boundary does a genuine swapTier (-> real
    // tierFading=true + a real afterSettle in flight), reaches top, holds, then completes.
    e.tier = Math.max(0, top - 1);
    e.armedTier = Math.max(0, top - 1);
    e.targetTier = top;
    e.topHeldSinceBoundary = false;
    e.tierFading = false;
    e.transitionInFlight = false;
    // gain up the starting tier so the segment is genuinely audible going in.
    for (let t = 0; t < seg.tierGains.length; t++) {
      const g = seg.tierGains[t];
      if (g) { try { g.gain.value = t === e.tier ? 1 : 0; } catch {} }
    }
    e.scheduleLoopTick();
  });
}

async function waitForTrack(page, wantId, timeoutMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const s = await readState(page);
    if (s.trackId === wantId && s.activeStems > 0) return s;
    // keep heat pinned via the real onClear path so the wrapped song can build.
    await page.evaluate(() => window.__luminesAudioDev.__injectClears(12));
    await page.waitForTimeout(400);
  }
  return readState(page);
}

async function main() {
  const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
  const page = await browser.newPage();
  const errors = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(String(e.message)));

  await page.goto(`${BASE}/?audiodev=1`, { waitUntil: "networkidle" });
  await page.getByTestId("start-button").click();
  await page.evaluate(async () => { await window.__luminesAudioDev.unlock(); });
  for (let i = 0; i < 60; i++) {
    const ok = await page.evaluate(() => window.__luminesAudioDev?.getAudioState().recordedBedActive === true);
    if (ok) break;
    await page.waitForTimeout(500);
  }
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);

  console.log("FRESH song1:", JSON.stringify(await readState(page)));

  // ── song1 -> song2 via a REAL terminal boundary (real settles in flight) ──
  await forceNearTerminalThenStartFade(page);
  // pin heat so the terminal builds + holds + completes over the next real boundaries.
  const stop1 = await page.evaluate(() => {
    window.__t = setInterval(() => window.__luminesAudioDev.__injectClears(12), 400);
    return true;
  });
  const onSong2 = await waitForTrack(page, "pipeline", 120_000);
  await page.evaluate(() => clearInterval(window.__t));
  console.log("after REAL completion 1 -> track:", onSong2.trackId, JSON.stringify(onSong2));
  if (onSong2.trackId !== "pipeline") { console.log("FAILED to reach song2"); await browser.close(); process.exit(2); }
  // settle a moment
  await page.waitForTimeout(1500);

  // ── song2 -> song1 (THE WRAP) via a REAL terminal boundary ──
  await forceNearTerminalThenStartFade(page);
  await page.evaluate(() => { window.__t = setInterval(() => window.__luminesAudioDev.__injectClears(12), 400); });
  const wrapped = await waitForTrack(page, "song1", 120_000);
  await page.evaluate(() => clearInterval(window.__t));
  console.log("WRAPPED back to:", wrapped.trackId, JSON.stringify(wrapped));

  // ── REAL-TIME progression on the wrapped song1 (NO __stepBoundary) ──
  await page.evaluate(() => { window.__t = setInterval(() => window.__luminesAudioDev.__injectClears(12), 500); });
  const RUN_MS = 90_000;
  const samples = [];
  const t0 = Date.now();
  let topReachedAt = null, advancedAt = null;
  const tierCount = wrapped.tierCount;
  while (Date.now() - t0 < RUN_MS) {
    const s = await readState(page);
    const rel = Math.round((Date.now() - t0) / 1000);
    samples.push({ rel, idx: s.segmentIndex, tier: s.tier, heat: +s.heat.toFixed(2), stems: s.activeStems, track: s.trackId, tif: s.transitionInFlight ? 1 : 0, tf: s.tierFading ? 1 : 0 });
    if (topReachedAt == null && s.tier >= tierCount - 1) topReachedAt = rel;
    if (advancedAt == null && (s.segmentIndex > 0 || s.trackId !== "song1")) advancedAt = rel;
    await page.waitForTimeout(250);
  }
  await page.evaluate(() => clearInterval(window.__t));

  const maxTier = Math.max(...samples.map((s) => s.tier));
  const minStems = Math.min(...samples.map((s) => s.stems));
  const finalIdx = samples[samples.length - 1].idx;
  const everTif = samples.some((s) => s.tif);
  const everTf = samples.some((s) => s.tf);
  console.log("\ntierCount:", tierCount, "topTier:", tierCount - 1);
  console.log("maxTier:", maxTier, "topReachedAt:", topReachedAt, "s  ADVANCED at:", advancedAt, "s  finalIdx:", finalIdx);
  console.log("minStems:", minStems, "  any transitionInFlight stuck?:", everTif, "  any tierFading?:", everTf);
  console.log("trace [s,idx,tier,heat,stems,tif,tf]:", JSON.stringify(samples.filter((_, i) => i % 4 === 0).map((s) => [s.rel, s.idx, s.tier, s.heat, s.stems, s.tif, s.tf])));
  console.log("errors:", errors.length ? errors : "none");

  await browser.close();

  // With heat pinned at 1.0 + the top tier held, the wrapped song1 must KEEP advancing
  // (one segment per ~35s loop), not stall after the first advance. Count distinct indices
  // reached AND detect a transitionInFlight that never clears (the stall signature).
  const distinctIdx = new Set(samples.map((s) => s.idx)).size;
  const lastTif = samples.slice(-20).every((s) => s.tif === 1); // stuck-true at the end
  const checks = [
    ["wrapped to song1 with audio", wrapped.trackId === "song1" && wrapped.activeStems > 0, JSON.stringify({ t: wrapped.trackId, st: wrapped.activeStems, tif: wrapped.transitionInFlight, tf: wrapped.tierFading })],
    ["never silent post-wrap", minStems >= 1, `min ${minStems}`],
    ["tier BUILT to top", maxTier >= tierCount - 1, `maxTier ${maxTier}/${tierCount - 1}`],
    ["ADVANCED off intro", advancedAt != null, `advancedAt ${advancedAt}s`],
    // the REAL post-wrap health check: keeps advancing, not frozen after one step.
    ["KEEPS advancing (>=3 distinct segments in 90s)", distinctIdx >= 3, `distinctIdx ${distinctIdx} (max ${finalIdx})`],
    ["transitionInFlight not stuck-true", !lastTif, `lastTif ${lastTif}`],
    ["no page errors", errors.length === 0, `${errors.length}`],
  ];
  let pass = true;
  for (const [name, ok, detail] of checks) { console.log(`${ok ? "PASS" : "FAIL"}  ${name}  (${detail})`); if (!ok) pass = false; }
  console.log(`\nRESULT: ${pass ? "PASS" : "FAIL"}`);
  process.exit(pass ? 0 : 1);
}

main().catch((e) => { console.error("probe error:", e); process.exit(2); });
