// Real-timing PROGRESSION probe — verifies the heat→tier→advance model on the REAL
// transport (NOT the synchronous __stepBoundary dev hook). Launches real chromium,
// clicks Start, then simulates STEADY clearing by banking heat via the real onClear path
// (__injectClears) on a wall-clock interval while the engine's OWN scheduled tier ticks
// and loop-wrap boundaries fire in real time. Measures when the song first ADVANCES.
//
// The point: prove the opening is RESPONSIVE (builds to the top tier within the first
// loop and advances at that loop's wrap, ~35s for song1's 16-bar intro) WITHOUT
// fast-forward (never advances BEFORE the loop wrap — a section always plays in full).
//
// Usage: node scripts/probe-progression.mjs [baseURL]
//   baseURL defaults to http://localhost:3201 (start one: pnpm exec next start -p 3201)
import { chromium } from "@playwright/test";

const BASE = process.argv[2] ?? "http://localhost:3201";
const RUN_MS = 44_000; // a touch over song1's ~35s intro loop + margin
const CLEAR_EVERY_MS = 1_000; // steady clearing: 2 squares' heat per second
const POLL_MS = 150;

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
  // wait for the structured bed to load.
  for (let i = 0; i < 40; i++) {
    const ok = await page.evaluate(
      () => window.__luminesAudioDev?.getAudioState().recordedBedActive === true,
    );
    if (ok) break;
    await page.waitForTimeout(500);
  }
  // PAUSE the game (Escape) so gravity stops and the board never fills → no game-over to
  // reset the audio mid-probe. The Tone transport keeps free-running (pause only mutes
  // volume + halts the game loop), so the loop boundaries + tier ticks still fire in real
  // time and we get a clean read of the heat→tier→advance timing.
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);

  const t0 = await page.evaluate(() => performance.now());
  // steady clearing on a wall-clock interval, in the page.
  await page.evaluate((everyMs) => {
    const dev = window.__luminesAudioDev;
    window.__probeClearTimer = setInterval(() => dev.__injectClears(2), everyMs);
  }, CLEAR_EVERY_MS);

  const samples = [];
  let firstAdvanceMs = null;
  let tierAtFirstAdvance = null;
  const startWall = Date.now();
  while (Date.now() - startWall < RUN_MS) {
    const s = await page.evaluate(() => {
      const a = window.__luminesAudioDev.getAudioState();
      return {
        t: performance.now(),
        idx: a.segmentIndex,
        maxIdx: a.maxSegmentReached,
        cnt: a.segmentCount,
        track: a.trackId,
        tier: a.tier,
        tierCount: a.tierCount,
        heat: a.heat,
        stems: a.activeStems,
      };
    });
    s.rel = Math.round(s.t - t0);
    samples.push(s);
    if (firstAdvanceMs == null && s.idx > 0) {
      firstAdvanceMs = s.rel;
      tierAtFirstAdvance = samples[samples.length - 2]?.tier ?? s.tier;
    }
    await page.waitForTimeout(POLL_MS);
  }
  await page.evaluate(() => clearInterval(window.__probeClearTimer));

  const minStems = Math.min(...samples.map((s) => s.stems));
  const maxTier = Math.max(...samples.map((s) => s.tier));
  const tierCount = samples[0]?.tierCount ?? 0;
  const finalIdx = samples[samples.length - 1]?.idx ?? 0;
  // time the audible tier first reached the top.
  const reachedTopAt = samples.find((s) => s.tier >= tierCount - 1)?.rel ?? null;

  console.log("tierCount (song1):", tierCount, "topTier:", tierCount - 1);
  console.log("time tier first reached TOP:", reachedTopAt, "ms");
  console.log("first ADVANCE at:", firstAdvanceMs, "ms");
  console.log("audible tier at first advance:", tierAtFirstAdvance);
  console.log("maxTier seen:", maxTier, "finalSegmentIndex:", finalIdx);
  console.log("min activeStems (never silent if >=1):", minStems);
  const maxIdxSeen = Math.max(...samples.map((s) => s.maxIdx));
  const tracks = [...new Set(samples.map((s) => s.track))];
  console.log("segmentCount:", samples[0]?.cnt, "maxSegmentReached seen:", maxIdxSeen);
  console.log("trackIds seen:", tracks);
  console.log(
    "trace [rel,idx,maxIdx,tier,heat,track]:",
    JSON.stringify(
      samples
        .filter((_, i) => i % 3 === 0)
        .map((s) => [s.rel, s.idx, s.maxIdx, s.tier, +s.heat.toFixed(2), s.track]),
    ),
  );
  console.log("console/page errors:", errors.length ? errors : "none");

  await browser.close();

  // Verdicts.
  const checks = [];
  checks.push([
    "built to TOP tier",
    maxTier >= tierCount - 1,
    `maxTier ${maxTier} of ${tierCount - 1}`,
  ]);
  checks.push([
    "advanced at least once",
    firstAdvanceMs != null,
    `firstAdvance ${firstAdvanceMs}ms`,
  ]);
  // responsive: the opening advances within ~one intro loop + margin (NOT ~100s).
  checks.push([
    "responsive opening (first advance <= 45s)",
    firstAdvanceMs != null && firstAdvanceMs <= 45_000,
    `${firstAdvanceMs}ms`,
  ]);
  // no fast-forward: never advances BEFORE the intro's full loop (~34.9s) — a section
  // always plays in full. (Allow a small poll/timing slack below the loop length.)
  checks.push([
    "no fast-forward (first advance >= 30s, full intro played)",
    firstAdvanceMs != null && firstAdvanceMs >= 30_000,
    `${firstAdvanceMs}ms`,
  ]);
  checks.push(["never silent (activeStems >= 1)", minStems >= 1, `min ${minStems}`]);
  checks.push(["no console/page errors", errors.length === 0, `${errors.length}`]);

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
