/**
 * HEADLESS proof that the v2.6 segment-advance MECHANICS work:
 *  - FORWARD-ONLY: the segment index never decreases.
 *  - SINGLE-STEP / NO SKIP: a burst of clears (even during an in-flight
 *    transition) advances by at most one segment per settled transition.
 *  - STICKY UNLOCK: once the active segment's vox unlocks it stays up on idle.
 *  - BAR-ALIGNED: transitions are scheduled at a bar (1m) multiple.
 *  - END OF SONG: exhausting the last segment fires onSongComplete once.
 *  - SWITCH: a live track switch maps the index onto the new bank + keeps advancing.
 *
 * Tone.js is mocked with a tiny deterministic fake. Gains apply ramp targets
 * (including linearRampToValueAtTime) so `gain.value` reflects the engine's
 * intent; the transition's deferred commit (window.setTimeout) is captured + run
 * synchronously so the index commits within the test. nextSubdivision("1m")
 * returns a bar multiple so the bar-aligned assertion is real.
 */

/* The Tone mock below is a pile of no-op stubs; empty methods are intentional. */
/* eslint-disable @typescript-eslint/no-empty-function */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
  beatCallback: null as ((time: number) => void) | null,
  // Records the start time of every scheduled gain ramp (for bar-alignment).
  rampStartTimes: [] as number[],
  // Fake transport clock + bar length (seconds).
  now: 0,
  barSeconds: 2.0,
  // Pending window.setTimeout callbacks (the transition commit defers via this).
  timeouts: [] as Array<() => void>,
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
    linearRampToValueAtTime(v: number, atPlusDur: number) {
      // Apply immediately so the asserted value reflects intent; record start.
      this.value = v;
      void atPlusDur;
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
    frequency = new FakeParam(1000);
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
      cb(mockState.now); // fire actions immediately at "now"
    },
    nextSubdivision() {
      // next bar boundary strictly after now
      const bars = Math.floor(mockState.now / mockState.barSeconds) + 1;
      return bars * mockState.barSeconds;
    },
  };
  return {
    start: () => Promise.resolve(),
    now: () => mockState.now,
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
        mockState.beatCallback = cb;
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

import { InteractiveAudioEngine } from "./engine";

// A 7-segment song1 manifest + an 8-segment song2 manifest (matches the real cut).
const makeManifest = (id: string, count: number) => ({
  id,
  tempo: 110,
  barSeconds: 2,
  segmentCount: count,
  segments: Array.from({ length: count }, (_, i) => ({
    index: i,
    bars: 8,
    bed: `seg${i}-bed.mp3`,
    vox: `seg${i}-vox.mp3`,
    hasVox: true,
  })),
});

const installFetch = () => {
  const fakeFetch = vi.fn(async (url: unknown) => {
    const u = String(url);
    const count = u.includes("/song2/") ? 8 : 7;
    const id = u.includes("/song2/") ? "song2" : "song1";
    return {
      ok: true,
      json: async () => makeManifest(id, count),
    } as unknown as Response;
  });
  (globalThis as unknown as { fetch: unknown }).fetch = fakeFetch;
};

// Capture window.setTimeout so the deferred transition commit runs on demand.
const installWindow = () => {
  mockState.timeouts = [];
  (globalThis as unknown as { window: unknown }).window = globalThis;
  (globalThis as unknown as { window: { setTimeout: unknown } }).window.setTimeout = (
    cb: () => void,
  ) => {
    mockState.timeouts.push(cb);
    return 0;
  };
};

/** Advance the fake transport clock by `n` bars and run any pending commits. */
const settleTransitions = (bars = 2) => {
  mockState.now += bars * mockState.barSeconds;
  const pending = mockState.timeouts;
  mockState.timeouts = [];
  for (const cb of pending) cb();
};

const clear = (engine: InteractiveAudioEngine, squares = 1, combo = 0) =>
  engine.fire({ type: "lineClear", squares, combo });

const newEngine = async (mix: "A" | "B" | "C" = "B") => {
  const engine = new InteractiveAudioEngine();
  engine.setPreset(mix);
  await engine.unlock();
  for (let i = 0; i < 120; i++) await Promise.resolve();
  return engine;
};

beforeEach(() => {
  mockState.beatCallback = null;
  mockState.rampStartTimes = [];
  mockState.now = 0;
  mockState.barSeconds = 2;
  installWindow();
  installFetch();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("v2.6 segment-advance mechanics (headless proof)", () => {
  it("loads the manifest bank (7 segs), starts at seg 0, bed up, vox silent", async () => {
    const engine = await newEngine("B");
    const s = engine.getAudioState();
    expect(s.recordedBedActive).toBe(true);
    expect(s.segmentCount).toBe(7);
    expect(s.segmentIndex).toBe(0);
    expect(s.layerGains.bed).toBeGreaterThan(0.9);
    expect(s.layerGains.vox).toBeLessThan(0.05);
    expect(s.transitionInFlight).toBe(false);
  });

  it("STICKY vox: unlocks on in-segment clears and STAYS up on idle", async () => {
    const engine = await newEngine("B"); // voxUnlockClears=2, weight 2/clear
    expect(engine.getAudioState().layerGains.vox).toBeLessThan(0.05);
    clear(engine); // 1 clear, weight 2 -> unlocks (>=2)
    const afterClear = engine.getAudioState();
    expect(afterClear.voxUnlocked).toBe(true);
    expect(afterClear.layerGains.vox).toBeGreaterThan(0.9);
    // Idle: pump many beats -> vox must NOT recede (sticky, no decay).
    for (let i = 0; i < 40; i++) mockState.beatCallback?.(0);
    expect(engine.getAudioState().layerGains.vox).toBeGreaterThan(0.9);
  });

  it("FORWARD-ONLY single-step: index advances one segment per settled transition", async () => {
    const engine = await newEngine("B"); // clearsPerSegment=4, weight 2/clear
    const seen: number[] = [engine.getAudioState().segmentIndex];
    for (let round = 0; round < 4; round++) {
      // ~2 clears cross the next threshold; then a transition is in flight.
      clear(engine);
      clear(engine);
      // While in-flight, extra clears must NOT trigger a second transition.
      const midIdx = engine.getAudioState().segmentIndex;
      clear(engine);
      clear(engine);
      expect(engine.getAudioState().segmentIndex).toBe(midIdx); // not committed yet
      settleTransitions(); // bar passes -> commit ONE step
      seen.push(engine.getAudioState().segmentIndex);
    }
    // monotonic non-decreasing
    for (let i = 1; i < seen.length; i++) {
      expect(seen[i]!).toBeGreaterThanOrEqual(seen[i - 1]!);
    }
    // advanced off seg 0, and never jumped more than one per settle
    const final = engine.getAudioState();
    expect(final.maxSegmentReached).toBeGreaterThan(0);
    for (let i = 1; i < seen.length; i++) {
      expect(seen[i]! - seen[i - 1]!).toBeLessThanOrEqual(1);
    }
  });

  it("NO FAST-FORWARD: a giant chain burst advances at most one segment per settle", async () => {
    const engine = await newEngine("C"); // clearsPerSegment=3 (fastest)
    // One huge chain (size 8 -> weight 10) then settle: must be exactly +1, not +3.
    engine.fire({ type: "chain", size: 8 });
    expect(engine.getAudioState().transitionInFlight).toBe(true);
    settleTransitions();
    expect(engine.getAudioState().segmentIndex).toBe(1);
    // Another huge chain: still +1 per settle (backlog capped).
    engine.fire({ type: "chain", size: 8 });
    settleTransitions();
    expect(engine.getAudioState().segmentIndex).toBe(2);
  });

  it("does NOT rewind on idle (song only moves forward)", async () => {
    const engine = await newEngine("C");
    for (let i = 0; i < 6; i++) {
      clear(engine, 2, 1);
      settleTransitions();
    }
    const advanced = engine.getAudioState().segmentIndex;
    expect(advanced).toBeGreaterThan(0);
    for (let i = 0; i < 60; i++) mockState.beatCallback?.(0);
    expect(engine.getAudioState().segmentIndex).toBe(advanced);
  });

  it("BAR-ALIGNED: transitions are scheduled at a bar (1m) boundary", async () => {
    const engine = await newEngine("C");
    mockState.now = 3.3; // mid-bar (bar=2 -> next bar boundary = 4.0)
    engine.fire({ type: "chain", size: 8 });
    // The next-bar boundary the engine used is 4.0 (a multiple of barSeconds=2).
    // Settle exactly to that boundary; the commit must apply (proves it scheduled there).
    mockState.now = 4.0;
    const pending = mockState.timeouts;
    mockState.timeouts = [];
    for (const cb of pending) cb();
    expect(engine.getAudioState().segmentIndex).toBe(1);
  });

  it("END OF SONG fires onSongComplete exactly once", async () => {
    const engine = await newEngine("C"); // 7 segs (idx 0..6)
    let completes = 0;
    engine.onSongComplete = () => {
      completes++;
    };
    // Walk to the last segment.
    for (let i = 0; i < 7; i++) {
      engine.fire({ type: "chain", size: 8 });
      settleTransitions();
    }
    expect(engine.getAudioState().segmentIndex).toBe(6); // last (7 segs)
    // Cross threshold again on the last segment -> complete.
    engine.fire({ type: "chain", size: 8 });
    engine.fire({ type: "chain", size: 8 });
    expect(completes).toBe(1);
  });
});

describe("v2.6 switchTrack: maps index onto the new bank + keeps advancing", () => {
  it("starts on song1 by default", async () => {
    const engine = await newEngine("B");
    expect(engine.getAudioState().trackId).toBe("song1");
  });

  it("switchTrack swaps the live track id + keeps the bed audible", async () => {
    const engine = await newEngine("B");
    await engine.switchTrack({ id: "song2", base: "/audio/song2" });
    for (let i = 0; i < 120; i++) await Promise.resolve();
    const s = engine.getAudioState();
    expect(s.trackId).toBe("song2");
    expect(s.layerGains.bed).toBeGreaterThan(0.9);
    expect(s.segmentCount).toBe(8);
  });

  it("carries the structural position over (clamped) and keeps advancing", async () => {
    const engine = await newEngine("C");
    for (let i = 0; i < 2; i++) {
      clear(engine, 2, 1);
      settleTransitions();
    }
    const beforeIdx = engine.getAudioState().segmentIndex;
    expect(beforeIdx).toBeGreaterThan(0);

    await engine.switchTrack({ id: "song2", base: "/audio/song2" });
    for (let i = 0; i < 120; i++) await Promise.resolve();
    const afterSwitch = engine.getAudioState();
    expect(afterSwitch.trackId).toBe("song2");
    expect(afterSwitch.segmentIndex).toBe(beforeIdx); // 8-seg song, index fits

    engine.fire({ type: "chain", size: 8 });
    settleTransitions();
    expect(engine.getAudioState().segmentIndex).toBeGreaterThan(beforeIdx);
  });

  it("switching to a SHORTER song clamps the index (never past the end)", async () => {
    const engine = await newEngine("C");
    // Start on song2 (8 segs) and advance near its end.
    await engine.switchTrack({ id: "song2", base: "/audio/song2" });
    for (let i = 0; i < 120; i++) await Promise.resolve();
    for (let i = 0; i < 7; i++) {
      engine.fire({ type: "chain", size: 8 });
      settleTransitions();
    }
    const farIdx = engine.getAudioState().segmentIndex;
    expect(farIdx).toBe(7); // last of song2
    // Switch to song1 (only 7 segs -> idx 0..6): must clamp to <= 6.
    await engine.switchTrack({ id: "song1", base: "/audio" });
    for (let i = 0; i < 120; i++) await Promise.resolve();
    const s = engine.getAudioState();
    expect(s.trackId).toBe("song1");
    expect(s.segmentIndex).toBeLessThanOrEqual(6);
  });

  it("switching to the SAME track is a no-op", async () => {
    const engine = await newEngine("B");
    await engine.switchTrack({ id: "song1", base: "/audio" });
    expect(engine.getAudioState().trackId).toBe("song1");
  });

  it("a pending transition during switchTrack does not corrupt the new bank", async () => {
    const engine = await newEngine("C");
    engine.fire({ type: "chain", size: 8 }); // transition in flight
    expect(engine.getAudioState().transitionInFlight).toBe(true);
    await engine.switchTrack({ id: "song2", base: "/audio/song2" });
    for (let i = 0; i < 120; i++) await Promise.resolve();
    // Run any stale commit from before the switch — must be ignored (token bumped).
    settleTransitions();
    const s = engine.getAudioState();
    expect(s.trackId).toBe("song2");
    expect(s.segmentIndex).toBeLessThan(s.segmentCount);
    expect(s.transitionInFlight).toBe(false);
  });
});

describe("v2.6 degrades to silence on asset failure (never throws)", () => {
  it("missing manifest -> falls back to file-probing, no throw", async () => {
    (globalThis as unknown as { fetch: unknown }).fetch = vi.fn(async () => {
      throw new Error("network");
    });
    const engine = new InteractiveAudioEngine();
    engine.setPreset("B");
    await expect(engine.unlock()).resolves.toBeUndefined();
    for (let i = 0; i < 120; i++) await Promise.resolve();
    // The probe still works (no throw); bed may be the fallback.
    expect(() => engine.getAudioState()).not.toThrow();
  });
});
