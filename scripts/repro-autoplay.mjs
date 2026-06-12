// Strict-autoplay AudioContext repro/verify harness.
//
// Launches REAL chromium (not headless-auto-allow) with strict autoplay policy,
// navigates to a locally-served production build, clicks Start, then measures
// ACTUAL audio output via an AnalyserNode tapped onto every node that connects to
// the AudioContext destination. RMS > threshold == real audible output.
//
// Usage: node scripts/repro-autoplay.mjs [baseURL]
//   baseURL defaults to http://localhost:3201
import { chromium } from "@playwright/test";

const BASE = process.argv[2] ?? "http://localhost:3201";
const RMS_THRESHOLD = 0.001; // anything above floor noise = real output

// Injected into the page BEFORE any app script. Hooks AudioNode.connect so that
// the moment anything connects to ctx.destination we splice in an AnalyserNode and
// stash it on window for later RMS reads. Captures Tone's output without touching
// Tone internals. Also records the AudioContext + its state transitions.
const initScript = () => {
  // @ts-nocheck
  const w = window;
  w.__audioProbe = {
    contexts: [],
    analysers: [],
    stateLog: [],
    consoleAutoplayError: false,
  };
  const AC = w.AudioContext || w.webkitAudioContext;
  if (!AC) return;
  // Capture the construction site + time of the FIRST AudioContext.
  const NativeAC = AC;
  const Wrapped = function (...a) {
    const inst = new NativeAC(...a);
    if (!w.__audioProbe.ctorStack) {
      w.__audioProbe.ctorStack = new Error("AudioContext-ctor").stack;
      w.__audioProbe.ctorBeforeGesture = !w.__audioProbe.gestureFired;
      w.__audioProbe.stateLog.push(`AudioContext constructed (gestureFired=${!!w.__audioProbe.gestureFired}) state=${inst.state}`);
    }
    return inst;
  };
  Wrapped.prototype = NativeAC.prototype;
  w.AudioContext = Wrapped;
  if (w.webkitAudioContext) w.webkitAudioContext = Wrapped;
  const origConnect = AudioNode.prototype.connect;
  AudioNode.prototype.connect = function (dest, ...rest) {
    try {
      const ctx = this.context;
      if (dest === ctx.destination) {
        if (!w.__audioProbe.contexts.includes(ctx)) {
          w.__audioProbe.contexts.push(ctx);
          const stack = new Error("ctx-connect").stack;
          w.__audioProbe.firstConnectStack = w.__audioProbe.firstConnectStack ?? stack;
          w.__audioProbe.stateLog.push(`ctx#${w.__audioProbe.contexts.length} created state=${ctx.state}`);
          ctx.addEventListener?.("statechange", () => {
            w.__audioProbe.stateLog.push(`ctx state -> ${ctx.state}`);
          });
        }
        // Splice an analyser in parallel so we read the real signal hitting dest.
        const an = ctx.createAnalyser();
        an.fftSize = 2048;
        origConnect.call(this, an);
        w.__audioProbe.analysers.push(an);
      }
    } catch (e) {
      /* never break the app */
    }
    return origConnect.call(this, dest, ...rest);
  };
};

function readRms() {
  const w = window;
  const p = w.__audioProbe;
  if (!p || p.analysers.length === 0) return { rms: 0, analysers: 0, ctxStates: [], log: p?.stateLog ?? [] };
  let peak = 0;
  for (const an of p.analysers) {
    const buf = new Float32Array(an.fftSize);
    an.getFloatTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
    const rms = Math.sqrt(sum / buf.length);
    if (rms > peak) peak = rms;
  }
  return {
    rms: peak,
    analysers: p.analysers.length,
    ctxStates: p.contexts.map((c) => c.state),
    log: p.stateLog,
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const browser = await chromium.launch({
    headless: false,
    args: [
      "--autoplay-policy=document-user-activation-required",
      "--mute-audio=false",
    ],
  });
  const context = await browser.newContext();
  const page = await context.newPage();

  const consoleMsgs = [];
  let autoplayError = false;
  page.on("console", (m) => {
    const t = m.text();
    consoleMsgs.push(`[${m.type()}] ${t}`);
    if (/AudioContext was not allowed to start/i.test(t)) autoplayError = true;
  });
  page.on("pageerror", (e) => consoleMsgs.push(`[pageerror] ${e.message}`));

  await page.addInitScript(initScript);
  await page.goto(BASE, { waitUntil: "networkidle" });

  // Measure BEFORE the gesture.
  const before = await page.evaluate(readRms);
  console.log("RMS before Start:", JSON.stringify(before));

  // Report where/when the AudioContext was first constructed.
  const ctor = await page.evaluate(() => ({
    ctorStack: window.__audioProbe?.ctorStack ?? null,
    ctorBeforeGesture: window.__audioProbe?.ctorBeforeGesture ?? null,
    firstConnectStack: window.__audioProbe?.firstConnectStack ?? null,
  }));
  console.log("AudioContext ctorBeforeGesture:", ctor.ctorBeforeGesture);
  console.log("AudioContext ctor stack:\n", ctor.ctorStack);

  // Mark the gesture, then click. The Start button is the user gesture.
  await page.evaluate(() => { window.__audioProbe.gestureFired = true; });
  await page.getByTestId("start-button").click();

  // Drive a little gameplay so the engine has reason to keep audio flowing
  // (the clear-gated bed should be audible from the first segment regardless,
  // but real input exercises the full path the way a player would).
  void (async () => {
    for (let k = 0; k < 60; k++) {
      await sleep(180);
      try {
        await page.keyboard.press(["ArrowLeft", "ArrowRight", "ArrowDown", "Space", "ArrowUp"][k % 5]);
      } catch { /* page may close */ }
    }
  })();

  // Let audio actually spin up: context resume + Tone.start + first segment fetch+decode.
  // Sample RMS repeatedly over a few seconds; report the peak we ever see.
  let peak = 0;
  let lastSample = null;
  const series = [];
  for (let i = 0; i < 40; i++) {
    await sleep(300);
    const s = await page.evaluate(readRms);
    lastSample = s;
    series.push(Number(s.rms.toFixed(5)));
    if (s.rms > peak) peak = s.rms;
  }

  // Sustain check: count how many of the LAST 10 samples are above threshold.
  const tail = series.slice(-10);
  const sustained = tail.filter((v) => v > RMS_THRESHOLD).length;
  const meanTail = tail.reduce((a, b) => a + b, 0) / tail.length;

  console.log("RMS peak after Start (over ~12s):", peak.toFixed(6));
  console.log("RMS series (every 300ms):", JSON.stringify(series));
  console.log(`RMS tail sustain: ${sustained}/10 samples > ${RMS_THRESHOLD}, meanTail=${meanTail.toFixed(5)}`);
  console.log("Last sample:", JSON.stringify(lastSample));
  console.log("Autoplay console error fired:", autoplayError);
  console.log("Context state log:", JSON.stringify(lastSample?.log ?? []));

  const autoplayLines = consoleMsgs.filter((m) => /AudioContext|autoplay|not allowed/i.test(m));
  if (autoplayLines.length) {
    console.log("Autoplay-related console lines:");
    for (const l of autoplayLines) console.log("  ", l);
  }

  await browser.close();

  // Gate: audio must be SUSTAINED (not a one-frame transient) and no autoplay error.
  const pass = sustained >= 6 && meanTail > RMS_THRESHOLD && !autoplayError;
  console.log("");
  console.log(pass ? "RESULT: PASS (audible output, no autoplay error)" : "RESULT: FAIL (no/low audio output OR autoplay error)");
  process.exit(pass ? 0 : 2);
}

main().catch((e) => {
  console.error("harness error:", e);
  process.exit(1);
});
