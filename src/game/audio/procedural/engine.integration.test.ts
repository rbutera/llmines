/**
 * HEADLESS proof that "clearing advances the song" actually works — both axes:
 *  - HORIZONTAL: cumulative clears step the segment index forward (new material).
 *  - VERTICAL: the active segment's vox gain RISES as clears accumulate and
 *    RECEDES when the player goes idle.
 *
 * This is the verification that was missing when the mechanic silently didn't
 * work: it drives REAL clear events through the engine and ASSERTS the measured
 * `getAudioState()` (the same data the browser test probe exposes) moves the way
 * the player should hear.
 *
 * Tone.js is mocked with a tiny deterministic fake (no Web Audio needed in node):
 * gains apply ramp targets immediately so `gain.value` reflects the engine's
 * intent, the Transport's beat callback can be pumped manually to simulate idle
 * decay, and players load synchronously. The engine's REAL logic (segment
 * advance, progression bump, grace + decay, band mapping) runs unchanged.
 */

/* The Tone mock below is deliberately a pile of no-op stubs (Web Audio has no
   node-side behaviour we need); the empty methods are intentional. */
/* eslint-disable @typescript-eslint/no-empty-function */

import { beforeEach, describe, expect, it, vi } from "vitest";

// ---- Tiny Tone mock -------------------------------------------------------
// Shared mutable state must go through vi.hoisted (vi.mock's factory is hoisted
// above imports, so it can't close over normal module-level variables).
const mockState = vi.hoisted(() => ({
  beatCallback: null as ((time: number) => void) | null,
}));

vi.mock("tone", () => {
  class FakeParam {
    value: number;
    constructor(v: number) {
      this.value = v;
    }
    // Ramps apply immediately in the fake so the asserted value reflects intent.
    rampTo(v: number) {
      this.value = v;
    }
    setValueAtTime(v: number) {
      this.value = v;
    }
    linearRampToValueAtTime() {}
    cancelScheduledValues() {}
  }
  class FakeGain {
    gain: FakeParam;
    constructor(v = 1) {
      this.gain = new FakeParam(v);
    }
    connect() {
      return this;
    }
    toDestination() {
      return this;
    }
    dispose() {}
  }
  class FakePlayer {
    loop = false;
    volume = new FakeParam(0);
    constructor(opts: { url: string; onload?: () => void; onerror?: () => void }) {
      queueMicrotask(() => opts.onload?.());
    }
    connect() {
      return this;
    }
    sync() {
      return this;
    }
    start() {
      return this;
    }
    dispose() {}
  }
  class FakeVoice {
    volume = new FakeParam(0);
    connect() {
      return this;
    }
    triggerAttackRelease() {}
    dispose() {}
  }
  const fakeTransport = {
    bpm: new FakeParam(112),
    swing: 0,
    swingSubdivision: "16n",
    start() {},
    stop() {},
    cancel() {},
    scheduleOnce(cb: (t: number) => void) {
      cb(0); // fire actions immediately (no real quantise needed for the proof)
    },
    nextSubdivision() {
      return 0;
    },
  };
  return {
    start: () => Promise.resolve(),
    now: () => 0,
    getTransport: () => fakeTransport,
    gainToDb: (g: number) => 20 * Math.log10(g),
    Gain: FakeGain,
    Filter: FakeVoice,
    Player: FakePlayer,
    Players: FakeVoice,
    Synth: class {},
    PolySynth: FakeVoice,
    MembraneSynth: FakeVoice,
    NoiseSynth: FakeVoice,
    MonoSynth: FakeVoice,
    Loop: class {
      constructor(cb: (t: number) => void) {
        mockState.beatCallback = cb; // capture the per-beat decay loop for pumping
      }
      start() {
        return this;
      }
      dispose() {
        mockState.beatCallback = null;
      }
    },
    Sequence: class {
      start() {
        return this;
      }
      dispose() {}
    },
  };
});

// Import AFTER the mock is registered.
import { InteractiveAudioEngine } from "./engine";

const clear = (engine: InteractiveAudioEngine, squares = 1, combo = 0) =>
  engine.fire({ type: "lineClear", squares, combo });

const pumpBeats = (n: number) => {
  for (let i = 0; i < n; i++) mockState.beatCallback?.(0);
};

describe("clearing advances the song (headless proof)", () => {
  let engine: InteractiveAudioEngine;

  beforeEach(async () => {
    // The engine's unlock() is SSR-guarded (`typeof window === "undefined"`
    // bails). The node test env has no window, so stub a minimal one so unlock
    // actually builds the graph + loads the (mocked) segments.
    (globalThis as unknown as { window?: object }).window = globalThis;
    mockState.beatCallback = null;
    engine = new InteractiveAudioEngine();
    engine.setPreset("B");
    await engine.unlock();
    // Let the (synchronous-mock) segment + SFX loads resolve (chained awaits).
    for (let i = 0; i < 80; i++) await Promise.resolve();
  });

  it("loads the recorded segment bed and starts at segment 0, vox silent", () => {
    const s = engine.getAudioState();
    expect(s.recordedBedActive).toBe(true);
    expect(s.segmentCount).toBe(6);
    expect(s.segmentIndex).toBe(0);
    expect(s.layerGains.bed).toBeGreaterThan(0.9); // base bed audible from the start
    expect(s.layerGains.vox).toBeLessThan(0.05); // no clears yet -> vocal silent
    expect(s.progression).toBe(0);
  });

  it("VERTICAL: vox gain RISES as clears accumulate", () => {
    const before = engine.getAudioState().layerGains.vox;
    clear(engine); // one clear
    const afterOne = engine.getAudioState().layerGains.vox;
    clear(engine);
    clear(engine); // a few more
    const afterMore = engine.getAudioState().layerGains.vox;

    expect(afterOne).toBeGreaterThan(before); // measurably rose on the first clear
    expect(afterMore).toBeGreaterThanOrEqual(afterOne);
    expect(afterMore).toBeGreaterThan(0.5); // clearly audible, not subtle
  });

  it("HORIZONTAL: the segment index STEPS FORWARD as clears accumulate", () => {
    expect(engine.getAudioState().segmentIndex).toBe(0);
    // B advances every 3 weight; weight per single clear = 1 + 1 + 0 = 2.
    // ~10 single clears => clearProgress 20 => floor(20/3) = 6 -> capped at 5.
    const seen: number[] = [];
    for (let i = 0; i < 10; i++) {
      clear(engine);
      seen.push(engine.getAudioState().segmentIndex);
    }
    const final = engine.getAudioState();
    expect(final.segmentIndex).toBeGreaterThan(0); // moved off segment 0
    expect(final.maxSegmentReached).toBeGreaterThanOrEqual(2); // crossed several sections
    // monotonic non-decreasing
    for (let i = 1; i < seen.length; i++) {
      expect(seen[i]!).toBeGreaterThanOrEqual(seen[i - 1]!);
    }
  });

  it("the advanced segment's bed is the one now audible (crossfade target)", () => {
    for (let i = 0; i < 8; i++) clear(engine);
    const s = engine.getAudioState();
    expect(s.segmentIndex).toBeGreaterThan(0);
    // The active segment reported by the probe has its bed up...
    expect(s.layerGains.bed).toBeGreaterThan(0.9);
  });

  it("VERTICAL idle: vox RECEDES after the grace window when the player stops", () => {
    clear(engine);
    clear(engine);
    const peak = engine.getAudioState().layerGains.vox;
    expect(peak).toBeGreaterThan(0.5);
    // Pump many idle beats (past the grace window) -> progression decays -> vox down.
    pumpBeats(40);
    const idle = engine.getAudioState();
    expect(idle.progression).toBeLessThan(0.2);
    expect(idle.layerGains.vox).toBeLessThan(peak); // measurably receded
  });

  it("HORIZONTAL does NOT rewind on idle (song only moves forward)", () => {
    for (let i = 0; i < 8; i++) clear(engine);
    const advanced = engine.getAudioState().segmentIndex;
    expect(advanced).toBeGreaterThan(0);
    pumpBeats(60); // long idle
    const after = engine.getAudioState();
    expect(after.segmentIndex).toBe(advanced); // section stays where the player got to
    expect(after.layerGains.vox).toBeLessThan(0.2); // but the vertical vox receded
  });

  it("preset C advances the song faster than A for the same clears", async () => {
    const run = async (mix: "A" | "C") => {
      const e = new InteractiveAudioEngine();
      e.setPreset(mix);
      await e.unlock();
      await new Promise((r) => setTimeout(r, 0));
      for (let i = 0; i < 6; i++) e.fire({ type: "lineClear", squares: 1, combo: 0 });
      return e.getAudioState().segmentIndex;
    };
    const a = await run("A");
    const c = await run("C");
    expect(c).toBeGreaterThan(a);
  });
});

describe("switchTrack: skin swaps the whole song, advance continues", () => {
  let engine: InteractiveAudioEngine;

  beforeEach(async () => {
    (globalThis as unknown as { window?: object }).window = globalThis;
    mockState.beatCallback = null;
    engine = new InteractiveAudioEngine();
    engine.setPreset("B");
    await engine.unlock();
    for (let i = 0; i < 80; i++) await Promise.resolve();
  });

  it("starts on song1 by default", () => {
    expect(engine.getAudioState().trackId).toBe("song1");
  });

  it("switchTrack swaps the live track id + keeps the bed audible", async () => {
    await engine.switchTrack({ id: "pipeline", base: "/audio/song2" });
    for (let i = 0; i < 80; i++) await Promise.resolve();
    const s = engine.getAudioState();
    expect(s.trackId).toBe("pipeline");
    // the new active segment's bed is the crossfade target (ramps to 1 in the fake)
    expect(s.layerGains.bed).toBeGreaterThan(0.9);
    expect(s.recordedBedActive).toBe(true);
  });

  it("PRESERVES segment-advance state across the switch, then keeps advancing", async () => {
    // advance song1 ONE segment first (leave room to advance further after switch)
    for (let i = 0; i < 2; i++) engine.fire({ type: "lineClear", squares: 1, combo: 0 });
    const beforeIdx = engine.getAudioState().segmentIndex;
    expect(beforeIdx).toBeGreaterThan(0);
    expect(beforeIdx).toBeLessThan(5); // headroom to advance on the new song

    await engine.switchTrack({ id: "pipeline", base: "/audio/song2" });
    for (let i = 0; i < 80; i++) await Promise.resolve();
    const afterSwitch = engine.getAudioState();
    // structural position is carried over to the new song (no rewind to 0)
    expect(afterSwitch.trackId).toBe("pipeline");
    expect(afterSwitch.segmentIndex).toBe(beforeIdx);

    // clears now advance SONG2's segments
    for (let i = 0; i < 12; i++) engine.fire({ type: "lineClear", squares: 2, combo: 1 });
    const advanced = engine.getAudioState();
    expect(advanced.segmentIndex).toBeGreaterThan(beforeIdx);
    expect(advanced.trackId).toBe("pipeline");
  });

  it("switching back to song1 works (round-trip)", async () => {
    await engine.switchTrack({ id: "pipeline", base: "/audio/song2" });
    for (let i = 0; i < 60; i++) await Promise.resolve();
    await engine.switchTrack({ id: "song1", base: "/audio" });
    for (let i = 0; i < 60; i++) await Promise.resolve();
    expect(engine.getAudioState().trackId).toBe("song1");
  });

  it("switching to the SAME track is a no-op (no churn)", async () => {
    const before = engine.getAudioState().trackId;
    await engine.switchTrack({ id: "song1", base: "/audio" });
    expect(engine.getAudioState().trackId).toBe(before);
  });
});
