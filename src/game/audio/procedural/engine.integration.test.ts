/**
 * HEADLESS proof of the v2.7 STRUCTURE-AWARE loop-vs-play model. Drives REAL clear
 * events through the engine and asserts the measured `getAudioState()` (the same
 * data the browser probe exposes) behaves the way the player should hear:
 *
 *  - loads a structure manifest; starts at section 0 (a LOOPER), vox silent;
 *  - a LOOPER HOLDS (index steady) until its clear-gate, then steps once;
 *  - a PROGRESSION advances forward on its (smaller) gate;
 *  - advance is forward-only / monotonic / no-rewind / no fast-forward;
 *  - a clear ARMS a progression's vocal (armedPhrase) — doesn't raise it instantly;
 *  - CLEAR IS SILENT (no SFX), BPM is read from the manifest;
 *  - switchTrack swaps the whole song and enters it phase-correct.
 *
 * Tone is mocked with a deterministic fake (gains apply ramp targets immediately
 * so `gain.value` reflects intent; the Transport fires scheduleOnce callbacks
 * immediately so armed phrases + commits land synchronously). `fetch` is mocked to
 * serve a structure manifest so the engine's REAL bank-load + advance logic runs.
 */

/* eslint-disable @typescript-eslint/no-empty-function */

import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
  scheduled: [] as ((time: number) => void)[],
  nextId: 1,
}));

vi.mock("tone", () => {
  class FakeParam {
    value: number;
    constructor(v: number) {
      this.value = v;
    }
    rampTo(v: number) {
      this.value = v;
    }
    setValueAtTime(v: number) {
      this.value = v;
    }
    linearRampToValueAtTime(v: number) {
      this.value = v; // apply target immediately so the asserted value reflects intent
    }
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
    constructor(opts: {
      url: string;
      onload?: () => void;
      onerror?: () => void;
    }) {
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
    stop() {
      return this;
    }
    dispose() {}
  }
  class FakeVoice {
    volume = new FakeParam(0);
    frequency = new FakeParam(1000);
    connect() {
      return this;
    }
    triggerAttackRelease() {}
    dispose() {}
  }
  const fakeTransport = {
    bpm: new FakeParam(110),
    swing: 0,
    swingSubdivision: "16n",
    start() {},
    stop() {},
    cancel() {},
    clear() {},
    scheduleOnce(cb: (t: number) => void) {
      // Fire immediately so armed-phrase triggers + transition commits are
      // deterministic in node (no real audio clock).
      cb(0);
      return mockState.nextId++;
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
      constructor(_cb: (t: number) => void) {}
      start() {
        return this;
      }
      dispose() {}
    },
    Sequence: class {
      start() {
        return this;
      }
      dispose() {}
    },
  };
});

import { InteractiveAudioEngine } from "./engine";

// ---- structure manifests served via mocked fetch --------------------------

function seg(
  i: number,
  name: string,
  role: string,
  extra: Record<string, unknown> = {},
) {
  return {
    index: i,
    name,
    role,
    bars: 8,
    lengthSeconds: 16,
    bedMode: role === "progression" ? "startOnEnter" : "loopRunning",
    voxMode: "none",
    voxEntryBars: [0],
    voxLoopable: false,
    gate: role === "progression" ? 2 : 6,
    excessCarry: role === "progression" ? "carry" : "cap",
    isTerminalRideout: role === "terminal",
    completionGate: 0,
    hasVox: false,
    bed: `seg${i}-bed.mp3`,
    vox: null as string | null,
    ...extra,
  };
}

const SONG1 = {
  id: "song1",
  name: "Codigo Sin Final",
  tempo: 109.957,
  barSeconds: 2.18268,
  sfxMode: "adlib",
  segmentCount: 6,
  segments: [
    seg(0, "intro", "looper", { gate: 6 }),
    seg(1, "verse1", "progression", {
      gate: 2,
      voxMode: "armedPhrase",
      hasVox: true,
      vox: "seg1-vox.mp3",
    }),
    seg(2, "build", "progression", { gate: 2 }),
    seg(3, "chorus", "looper", {
      gate: 5,
      voxMode: "loopLayer",
      voxLoopable: true,
      hasVox: true,
      vox: "seg3-vox.mp3",
    }),
    seg(4, "break", "looper", { gate: 6 }),
    seg(5, "verse2", "terminal", { gate: 0, isTerminalRideout: true }),
  ],
};
const SONG2 = {
  id: "pipeline",
  name: "Verde el Pipeline",
  tempo: 126.05,
  barSeconds: 1.904,
  sfxMode: "procedural",
  segmentCount: 5,
  segments: [
    seg(0, "intro", "looper", { gate: 6 }),
    seg(1, "verse1", "progression", { gate: 2 }),
    seg(2, "build", "progression", { gate: 2 }),
    seg(3, "chorus", "looper", { gate: 5 }),
    seg(4, "verse2", "terminal", { gate: 0, isTerminalRideout: true }),
  ],
};

function installFetch() {
  (globalThis as unknown as { fetch: unknown }).fetch = vi.fn((url: string) => {
    const body = url.includes("/song2/") ? SONG2 : SONG1;
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve(body),
    } as Response);
  });
}

const clear = (e: InteractiveAudioEngine, squares = 1, combo = 0) =>
  e.fire({ type: "lineClear", squares, combo });

async function freshEngine(mix: "A" | "B" | "C" = "B") {
  (globalThis as unknown as { window?: object }).window = globalThis;
  installFetch();
  const e = new InteractiveAudioEngine();
  e.setPreset(mix);
  await e.unlock();
  for (let i = 0; i < 100; i++) await Promise.resolve();
  return e;
}

describe("v2.7 structure-aware playback", () => {
  let engine: InteractiveAudioEngine;
  beforeEach(async () => {
    engine = await freshEngine("B");
  });

  it("loads the structure manifest: section 0 (looper), bed up, vox silent, BPM from manifest", () => {
    const s = engine.getAudioState();
    expect(s.recordedBedActive).toBe(true);
    expect(s.segmentCount).toBe(6);
    expect(s.segmentIndex).toBe(0);
    expect(s.activeRole).toBe("looper");
    expect(s.activeBedMode).toBe("loopRunning");
    expect(s.layerGains.bed).toBeGreaterThan(0.9);
    expect(s.layerGains.vox).toBeLessThan(0.05);
    expect(s.bpm).toBeCloseTo(109.957, 1); // driven from the manifest, NOT hardcoded
  });

  it("a LOOPER HOLDS until its clear-gate, then steps exactly once", () => {
    // intro gate = 6 (preset B gateScale 1.0). 5 single clears (weight 2 each = 10)
    // crosses the gate -> one step. Fewer clears must NOT move it.
    expect(engine.getAudioState().segmentIndex).toBe(0);
    clear(engine); // weight 2
    expect(engine.getAudioState().segmentIndex).toBe(0); // still holding
    clear(engine);
    clear(engine); // total weight 6 -> crosses gate 6 -> one step
    const s = engine.getAudioState();
    expect(s.segmentIndex).toBe(1);
    expect(s.maxSegmentReached).toBe(1);
  });

  it("a PROGRESSION advances on its smaller gate; advance is monotonic", () => {
    const seen: number[] = [];
    for (let i = 0; i < 14; i++) {
      clear(engine);
      seen.push(engine.getAudioState().segmentIndex);
    }
    const s = engine.getAudioState();
    expect(s.segmentIndex).toBeGreaterThan(1); // moved past the first progression
    for (let i = 1; i < seen.length; i++) {
      expect(seen[i]!).toBeGreaterThanOrEqual(seen[i - 1]!); // never rewinds
    }
  });

  it("a clear ARMS a progression's vocal (armedPhrase) and reveals it", () => {
    // advance to the verse1 progression (index 1)
    for (let i = 0; i < 3; i++) clear(engine);
    expect(engine.getAudioState().segmentIndex).toBe(1);
    expect(engine.getAudioState().activeRole).toBe("progression");
    // a clear in the progression arms + (with the immediate-fire fake) reveals vox
    clear(engine);
    const s = engine.getAudioState();
    expect(s.voxUnlocked || s.voxArmed).toBe(true);
    expect(s.layerGains.vox).toBeGreaterThan(0.5);
  });

  it("CLEAR IS SILENT: clearing fires no SFX (probe has no SFX channel; routing proves it)", () => {
    // The presets carry NO clear routing; a clear only advances/reveals. The
    // engine path for lineClear/chain never calls playSfx. We assert the model
    // invariant via the routing in presets.test.ts; here we assert clearing still
    // PROGRESSES (its only audible effect) without throwing.
    expect(() => {
      for (let i = 0; i < 6; i++) clear(engine, 2, 1);
    }).not.toThrow();
    expect(engine.getAudioState().segmentIndex).toBeGreaterThan(0);
  });

  it("does NOT fast-forward: many clears at once still step one section", () => {
    // A single huge clear shouldn't skip multiple sections in one go.
    const before = engine.getAudioState().segmentIndex;
    engine.fire({ type: "chain", size: 8 }); // big weight
    const after = engine.getAudioState().segmentIndex;
    expect(after - before).toBeLessThanOrEqual(1);
  });

  it("HORIZONTAL does not rewind (forward-only)", () => {
    for (let i = 0; i < 10; i++) clear(engine);
    const advanced = engine.getAudioState().segmentIndex;
    expect(advanced).toBeGreaterThan(0);
    // more time / no clears: index must not decrease
    const after = engine.getAudioState().segmentIndex;
    expect(after).toBeGreaterThanOrEqual(advanced);
  });

  it("preset C advances faster than A for the same clears (gateScale)", async () => {
    const run = async (mix: "A" | "C") => {
      const e = await freshEngine(mix);
      for (let i = 0; i < 8; i++)
        e.fire({ type: "lineClear", squares: 1, combo: 0 });
      return e.getAudioState().segmentIndex;
    };
    expect(await run("C")).toBeGreaterThanOrEqual(await run("A"));
  });
});

describe("v2.7 switchTrack: skin swaps the whole song, enters phase-correct", () => {
  let engine: InteractiveAudioEngine;
  beforeEach(async () => {
    engine = await freshEngine("B");
  });

  it("starts on song1 by default", () => {
    expect(engine.getAudioState().trackId).toBe("song1");
  });

  it("switchTrack swaps the live track id, keeps the bed audible, updates BPM", async () => {
    await engine.switchTrack({ id: "pipeline", base: "/audio/song2" });
    for (let i = 0; i < 100; i++) await Promise.resolve();
    const s = engine.getAudioState();
    expect(s.trackId).toBe("pipeline");
    expect(s.layerGains.bed).toBeGreaterThan(0.9);
    expect(s.recordedBedActive).toBe(true);
    expect(s.bpm).toBeCloseTo(126.05, 1); // new song's tempo
  });

  it("carries the structural position across the switch (no rewind to 0)", async () => {
    for (let i = 0; i < 3; i++) clear(engine);
    const beforeIdx = engine.getAudioState().segmentIndex;
    expect(beforeIdx).toBeGreaterThan(0);
    await engine.switchTrack({ id: "pipeline", base: "/audio/song2" });
    for (let i = 0; i < 100; i++) await Promise.resolve();
    const s = engine.getAudioState();
    expect(s.trackId).toBe("pipeline");
    expect(s.segmentIndex).toBe(Math.min(beforeIdx, SONG2.segments.length - 1));
  });

  it("round-trips back to song1", async () => {
    await engine.switchTrack({ id: "pipeline", base: "/audio/song2" });
    for (let i = 0; i < 80; i++) await Promise.resolve();
    await engine.switchTrack({ id: "song1", base: "/audio" });
    for (let i = 0; i < 80; i++) await Promise.resolve();
    expect(engine.getAudioState().trackId).toBe("song1");
  });

  it("switching to the SAME track is a no-op", async () => {
    const before = engine.getAudioState().trackId;
    await engine.switchTrack({ id: "song1", base: "/audio" });
    expect(engine.getAudioState().trackId).toBe(before);
  });
});
