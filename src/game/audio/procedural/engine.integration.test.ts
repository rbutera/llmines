/**
 * HEADLESS proof of the manifest-driven, 4-layer, loop-quantized, segment-advancing
 * ENGINE (Waves 2-4). Drives REAL clear/action events through the engine and asserts
 * the measured `getAudioState()` (the same data the browser probe exposes) plus a
 * recording Tone mock to prove the mechanics the player should HEAR:
 *
 *  1. loop-boundary-only tier changes — tiers swap only on a scheduled loop tick,
 *     and the swap ramp starts at a whole-bar (loop-length) multiple;
 *  2. bias-up HOLD — with no scoring the tier holds for `shedAfterPasses` passes;
 *  3. forward-only single-step advance — a burst advances ≤1 per settled transition;
 *  4. advance requires tier2 AND segmentScore ≥ advanceThreshold;
 *  5. bounded active bed players (≤2, the no-hiss mechanic) — past segments disposed;
 *  6. onSongComplete fires exactly once at the TERMINAL segment;
 *  7. degrade to silence — a missing manifest never throws and starts no players.
 *
 * Tone is mocked: gains apply ramp targets immediately so `gain.value` reflects
 * intent, ramp START times are recorded so quantization is assertable, and the
 * loop-tick `scheduleRepeat` callback is captured so the test can fire a loop
 * boundary on demand (the engine only changes tier / advances on a boundary).
 */

/* eslint-disable @typescript-eslint/no-empty-function */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const SEC_PER_BAR = 0.5; // mock "barSeconds" — clock advances in bars of 0.5s

const mockState = vi.hoisted(() => ({
  now: 0,
  bpm: 110,
  /**
   * Pending scheduleOnce callbacks keyed by absolute transport time. The engine's
   * loop tick is now a SELF-RESCHEDULING scheduleOnce (not scheduleRepeat), so the
   * mock queues numeric-time callbacks and drives them deterministically.
   */
  pending: [] as { cb: (t: number) => void; time: number; id: number }[],
  /** every gain ramp start time recorded for quantization assertions. */
  rampStarts: [] as number[],
  /** every FakePlayer constructed, for loopEnd / SFX-pool assertions. */
  players: [] as { url: string; loopEnd: number; starts: number[] }[],
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
    setValueAtTime(v: number, time: number) {
      // the engine anchors a ramp with setValueAtTime(current, START) — record the
      // real START time so quantization (bar-multiple) is assertable.
      if (time != null) mockState.rampStarts.push(time);
      this.value = v;
    }
    linearRampToValueAtTime(v: number) {
      this.value = v; // apply target immediately so the asserted value = intent
    }
    cancelScheduledValues() {}
  }
  class FakeGain {
    gain: FakeParam;
    disposed = false;
    constructor(v = 1) {
      this.gain = new FakeParam(v);
    }
    connect() {
      return this;
    }
    toDestination() {
      return this;
    }
    dispose() {
      this.disposed = true;
    }
  }
  class FakePlayer {
    loop = false;
    loopStart = 0;
    loopEnd = 0;
    disposed = false;
    url: string;
    volume = new FakeParam(0);
    /** every start() time, for the SFX monotonic-nudge / overlap assertions. */
    starts: number[] = [];
    constructor(opts: {
      url: string;
      onload?: () => void;
      onerror?: () => void;
    }) {
      this.url = opts.url;
      mockState.players.push(this);
      queueMicrotask(() => opts.onload?.());
    }
    connect() {
      return this;
    }
    sync() {
      return this;
    }
    start(t?: number) {
      this.starts.push(typeof t === "number" ? t : mockState.now);
      return this;
    }
    stop() {
      return this;
    }
    dispose() {
      this.disposed = true;
    }
  }
  const fakeTransport = {
    bpm: { get value() {
      return mockState.bpm;
    }, set value(v: number) {
      mockState.bpm = v;
    } },
    swing: 0,
    swingSubdivision: "16n",
    // the engine now schedules the loop tick in SECONDS off the transport clock.
    get seconds() {
      return mockState.now;
    },
    start() {},
    stop() {},
    cancel() {
      mockState.pending = [];
    },
    clear(id: number) {
      // a re-schedule / dispose clears a pending one-shot so a stale tick won't fire.
      const i = mockState.pending.findIndex((p) => p.id === id);
      if (i >= 0) mockState.pending.splice(i, 1);
    },
    scheduleOnce(cb: (t: number) => void, time: number | string) {
      const id = mockState.nextId++;
      if (typeof time === "string") {
        // `@16n`-style relative SFX scheduling — fire immediately (current tick).
        cb(mockState.now);
      } else {
        // absolute-time loop tick / settle — queue, driven by settle()/loopBoundary().
        mockState.pending.push({ cb, time, id });
      }
      return id;
    },
    nextSubdivision() {
      // align to the next bar boundary on the mock clock.
      return (Math.floor(mockState.now / SEC_PER_BAR) + 1) * SEC_PER_BAR;
    },
  };
  // Minimal fake of the Tone Context so unlock()'s gesture-safe
  // getContext().resume() path works under the mock (real fix: create+resume the
  // AudioContext synchronously inside the Start gesture).
  const fakeContext = {
    state: "running" as AudioContextState,
    resume: () => Promise.resolve(),
  };
  return {
    start: () => Promise.resolve(),
    getContext: () => fakeContext,
    now: () => mockState.now,
    getTransport: () => fakeTransport,
    gainToDb: (g: number) => 20 * Math.log10(g),
    Gain: FakeGain,
    Filter: FakeGain,
    Player: FakePlayer,
    Players: FakeGain,
    Synth: class {},
    PolySynth: FakeGain,
    MembraneSynth: FakeGain,
    NoiseSynth: FakeGain,
    MonoSynth: FakeGain,
    Loop: class {
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

// ── manifest served via mocked fetch (single /audio/manifest.json, songs[]) ──

function tiers(prefix: string) {
  return {
    tier0: `${prefix}-tier0.opus`,
    tier1: `${prefix}-tier1.opus`,
    tier2: `${prefix}-tier2.opus`,
  };
}
function seg(id: string, type: string, bars = 1) {
  // lengthSeconds carries a spill tail for non-LOOPER (mirrors the real manifest);
  // barWindowSeconds is the spill-free loop length the engine must loop/tick on.
  const barWindow = bars * SEC_PER_BAR;
  const spill = type === "LOOPER" ? 0 : SEC_PER_BAR; // 1-bar spill on play-through
  return {
    id,
    type,
    bars,
    lengthSeconds: barWindow + spill,
    barWindowSeconds: barWindow,
    tiers: tiers(id),
  };
}

const MANIFEST = {
  version: "test",
  songs: [
    {
      id: "song1",
      title: "Song 1",
      tempo: 110,
      barSeconds: SEC_PER_BAR,
      segments: [
        seg("s1-intro", "LOOPER", 1),
        seg("s1-verse1", "PROGRESSION", 1),
        seg("s1-break", "LOOPER", 1),
        seg("s1-outro", "TERMINAL", 1),
      ],
      sfx: { move: "sfx-move.opus", rotate: "sfx-rotate.opus", drop: "sfx-drop.opus" },
    },
    {
      id: "song2",
      title: "Song 2",
      tempo: 126,
      barSeconds: SEC_PER_BAR,
      segments: [
        seg("s2-intro", "LOOPER", 1),
        seg("s2-verse1", "PROGRESSION", 1),
        seg("s2-outro", "TERMINAL", 1),
      ],
      sfx: { move: "sfx-move.opus" },
    },
  ],
};

function installFetch(manifest: unknown = MANIFEST) {
  (globalThis as unknown as { fetch: unknown }).fetch = vi.fn(() =>
    manifest == null
      ? Promise.resolve({ ok: false } as Response)
      : Promise.resolve({
          ok: true,
          json: () => Promise.resolve(manifest),
        } as Response),
  );
}

const clear = (e: InteractiveAudioEngine, squares = 1, combo = 0) =>
  e.fire({ type: "lineClear", squares, combo });

/**
 * Run every pending one-shot whose scheduled time is <= `until`, in time order,
 * advancing the mock clock to each as it fires (so nested schedules see the right
 * `now`). Re-armed loop ticks beyond `until` stay queued.
 */
function runDueUpTo(until: number): void {
  // guard against pathological re-arming (a boundary that re-schedules at the same
  // time would loop forever); bound the drain.
  for (let guard = 0; guard < 10000; guard++) {
    const due = mockState.pending
      .filter((p) => p.time <= until + 1e-9)
      .sort((a, b) => a.time - b.time)[0];
    if (!due) return;
    mockState.pending = mockState.pending.filter((p) => p !== due);
    mockState.now = Math.max(mockState.now, due.time);
    due.cb(due.time);
  }
}

/**
 * Advance to the next loop-tick boundary and fire it (plus the settle callbacks it
 * chains), WITHOUT firing the following re-armed boundary. The next boundary is the
 * earliest pending event; settles land within ~0.45s of it, and the smallest loop
 * interval is SEC_PER_BAR, so a cutoff just below the next interval captures the
 * boundary + its settles but not the subsequent tick.
 */
function loopBoundary(): void {
  const times = mockState.pending.map((p) => p.time);
  if (times.length === 0) return;
  const tb = Math.min(...times);
  runDueUpTo(tb + SEC_PER_BAR - 1e-3);
}

async function settle() {
  for (let i = 0; i < 50; i++) await Promise.resolve();
  // fire any settle/one-shot already due at the current clock (no clock advance).
  runDueUpTo(mockState.now);
}

async function freshEngine(mix: "A" | "B" | "C" = "B") {
  (globalThis as unknown as { window?: object }).window = globalThis;
  installFetch();
  const e = new InteractiveAudioEngine();
  e.setPreset(mix);
  await e.unlock();
  await settle();
  return e;
}

beforeEach(() => {
  mockState.now = 0;
  mockState.bpm = 110;
  mockState.pending = [];
  mockState.rampStarts = [];
  mockState.players = [];
  mockState.nextId = 1;
});

afterEach(() => {
  mockState.pending = [];
  mockState.players = [];
});

describe("manifest-driven 4-layer loop-quantized engine", () => {
  it("degrades to silence on a missing manifest (no throw, no players)", async () => {
    (globalThis as unknown as { window?: object }).window = globalThis;
    installFetch(null);
    const e = new InteractiveAudioEngine();
    await expect(e.unlock()).resolves.toBeUndefined();
    await settle();
    const s = e.getAudioState();
    expect(s.segmentCount).toBe(0);
    expect(s.activeStems).toBe(0);
  });

  it("loads the manifest, enters intro at tier1 (energy floor, never silent)", async () => {
    const e = await freshEngine("B");
    const s = e.getAudioState();
    expect(s.segmentCount).toBe(4);
    expect(s.segmentIndex).toBe(0);
    expect(s.trackId).toBe("song1");
    expect(s.bpm).toBeCloseTo(110, 1);
    // Wave-1 flag: intro tier0 is silent -> floor at tier1.
    expect(s.tier).toBe(1);
    expect(s.layerGains[1]).toBeGreaterThan(0.9);
    // no-hiss: exactly one bed player audible at steady state.
    expect(s.activeStems).toBe(1);
  });

  it("a tier change happens ONLY on a loop boundary, ramp starts on a bar multiple", async () => {
    const e = await freshEngine("B");
    expect(e.getAudioState().tier).toBe(1);
    // score enough to arm tier 1->2 (preset B addThreshold[1] = 9).
    for (let i = 0; i < 6; i++) clear(e, 2); // weight 4 each -> 24 in-pass
    await settle();
    // BEFORE a boundary the tier must NOT have changed (mid-loop is forbidden).
    expect(e.getAudioState().tier).toBe(1);
    mockState.rampStarts.length = 0;
    loopBoundary();
    await settle();
    // AFTER the boundary it swapped up one tier.
    expect(e.getAudioState().tier).toBe(2);
    // every ramp scheduled by the swap STARTS on a bar (loop) multiple — never
    // mid-loop. (rampStarts are recorded from setValueAtTime's anchor time.)
    expect(mockState.rampStarts.length).toBeGreaterThan(0);
    for (const t of mockState.rampStarts) {
      const bars = t / SEC_PER_BAR;
      expect(Math.abs(bars - Math.round(bars))).toBeLessThan(1e-6);
    }
  });

  it("bias-up HOLD: a dry spell does not shed the tier (holds for shedAfterPasses)", async () => {
    const e = await freshEngine("A"); // shedAfterPasses = 6; A advanceThreshold = 16
    // Bank just enough to arm one tier up (intro enters at tier1; A addThreshold[1]
    // = 12). lineClear weight = 1+squares = 3 per clear; 4 clears = 12 (arms 1->2)
    // and segScore 12 < advanceThreshold 16 so we climb WITHOUT advancing.
    for (let i = 0; i < 4; i++) clear(e, 2); // weight 3 each = 12 in-pass + segScore
    loopBoundary();
    await settle();
    const climbed = e.getAudioState();
    expect(climbed.segmentIndex).toBe(0); // did NOT advance (segScore 12 < 16)
    expect(climbed.tier).toBe(2); // armed 1->2 and swapped on the boundary
    // Now go DRY: across passes fewer than shedAfterPasses the tier must HOLD.
    const start = climbed.tier;
    for (let p = 0; p < 5; p++) {
      loopBoundary();
      await settle();
      expect(e.getAudioState().tier).toBe(start); // never thinned (bias up)
      expect(e.getAudioState().segmentIndex).toBe(0); // still no score -> no advance
    }
  });

  it("advance requires tier2 AND segmentScore >= advanceThreshold (forward-only)", async () => {
    const e = await freshEngine("C"); // advanceThreshold = 8, addThreshold [4,6]
    expect(e.getAudioState().segmentIndex).toBe(0);
    // Pour score in; the engine must NOT advance off the intro until it has
    // reached tier2 (boundaries needed to climb) AND banked advanceThreshold.
    for (let i = 0; i < 6; i++) clear(e, 2); // arm 1->2
    loopBoundary(); // swap to tier2
    await settle();
    expect(e.getAudioState().tier).toBe(2);
    // not enough segmentScore banked across the reset boundaries yet OR it is:
    // pour more and tick to let an advance commit.
    for (let i = 0; i < 6; i++) clear(e, 2);
    loopBoundary();
    await settle();
    const s = e.getAudioState();
    expect(s.segmentIndex).toBeGreaterThanOrEqual(1); // advanced forward
    expect(s.maxSegmentReached).toBeGreaterThanOrEqual(1);
  });

  it("does NOT fast-forward: a huge burst advances at most one segment per boundary", async () => {
    const e = await freshEngine("C");
    // climb to tier2.
    for (let i = 0; i < 6; i++) clear(e, 2);
    loopBoundary();
    await settle();
    const before = e.getAudioState().segmentIndex;
    // one massive chain then a single boundary -> at most ONE step.
    e.fire({ type: "chain", size: 8 });
    e.fire({ type: "chain", size: 8 });
    loopBoundary();
    await settle();
    const after = e.getAudioState().segmentIndex;
    expect(after - before).toBeLessThanOrEqual(1);
  });

  it("segmentIndex is monotonic (forward-only, never rewinds)", async () => {
    const e = await freshEngine("C");
    const seen: number[] = [];
    for (let k = 0; k < 12; k++) {
      for (let i = 0; i < 4; i++) clear(e, 2);
      loopBoundary();
      await settle();
      seen.push(e.getAudioState().segmentIndex);
    }
    for (let i = 1; i < seen.length; i++) {
      expect(seen[i]!).toBeGreaterThanOrEqual(seen[i - 1]!);
    }
  });

  it("no-hiss: active bed players stay <= 2 throughout a full play-through", async () => {
    const e = await freshEngine("C");
    let maxStems = 0;
    for (let k = 0; k < 16; k++) {
      for (let i = 0; i < 4; i++) clear(e, 2);
      loopBoundary();
      await settle();
      maxStems = Math.max(maxStems, e.getAudioState().activeStems);
    }
    expect(maxStems).toBeLessThanOrEqual(2);
    expect(maxStems).toBeGreaterThanOrEqual(1);
  });

  it("onSongComplete fires exactly once on reaching TERMINAL", async () => {
    const e = await freshEngine("C");
    let calls = 0;
    e.onSongComplete = () => {
      calls++;
    };
    // drive hard until we reach the last (TERMINAL) segment + settle the transition.
    for (let k = 0; k < 30; k++) {
      for (let i = 0; i < 6; i++) clear(e, 2);
      loopBoundary();
      await settle();
    }
    const s = e.getAudioState();
    expect(s.segmentIndex).toBe(s.segmentCount - 1); // landed on TERMINAL
    expect(calls).toBe(1); // fired, and only once
    // further boundaries do not re-fire.
    loopBoundary();
    await settle();
    expect(calls).toBe(1);
  });

  it("looping players loop the SPILL-FREE bar window, not the full file (Blocker 1)", async () => {
    await freshEngine("B");
    await settle();
    // every loaded tier player set loopEnd = barWindowSeconds (= bars * SEC_PER_BAR),
    // NEVER the file lengthSeconds (which carries the spill tail on non-LOOPER).
    const loaded = mockState.players.filter((p) => p.loopEnd > 0);
    expect(loaded.length).toBeGreaterThan(0);
    for (const p of loaded) {
      // 1-bar segments in the test manifest -> loopEnd == SEC_PER_BAR.
      expect(p.loopEnd).toBeCloseTo(SEC_PER_BAR, 9);
    }
  });

  it("the loop tick is a self-rescheduling one-shot on the bar-window grid (not scheduleRepeat)", async () => {
    await freshEngine("B");
    await settle();
    // exactly one pending loop tick (a numeric-time one-shot), at a multiple of the
    // bar window — proves the self-rescheduling scheduleOnce model on the wrap grid.
    expect(mockState.pending.length).toBe(1);
    const tick = mockState.pending[0]!;
    expect(typeof tick.time).toBe("number");
    const phase = tick.time / SEC_PER_BAR;
    expect(Math.abs(phase - Math.round(phase))).toBeLessThan(1e-6);
    // and it RE-ARMS itself: after firing, there is again exactly one pending tick
    // (the next boundary), one bar-window later — the old scheduleRepeat froze here.
    const firstTime = tick.time;
    loopBoundary();
    await settle();
    expect(mockState.pending.length).toBe(1);
    expect(mockState.pending[0]!.time).toBeCloseTo(firstTime + SEC_PER_BAR, 6);
  });
});

// The showstopper found by the production playtest: long PROGRESSION segments froze
// forever because `${bars}m` scheduleRepeat with a large interval never fired. The
// seconds-based loop tick must keep firing on a multi-bar segment so the song
// advances PAST a long verse instead of stalling.
describe("long-segment progression (showstopper regression)", () => {
  const LONG_MANIFEST = {
    version: "test-long",
    songs: [
      {
        id: "song1",
        title: "Song 1",
        tempo: 110,
        barSeconds: SEC_PER_BAR,
        segments: [
          seg("s1-intro", "LOOPER", 2),
          seg("s1-verse1", "PROGRESSION", 34), // the segment that froze
          seg("s1-break", "LOOPER", 4),
          seg("s1-outro", "TERMINAL", 9),
        ],
        sfx: { move: "sfx-move.opus" },
      },
    ],
  };

  it("a 34-bar PROGRESSION segment advances (does not freeze) + reaches TERMINAL", async () => {
    (globalThis as unknown as { window?: object }).window = globalThis;
    installFetch(LONG_MANIFEST);
    const e = new InteractiveAudioEngine();
    e.setPreset("C"); // advanceThreshold = 8, addThreshold [4,6]
    await e.unlock();
    await settle();

    let calls = 0;
    e.onSongComplete = () => {
      calls++;
    };

    // Drive score and fire each boundary via loopBoundary(), which advances the
    // clock to the next pending tick whatever its interval. The 34-bar verse loop is
    // 68x longer than the intro loop; the self-rescheduling one-shot must keep firing
    // on it (the old scheduleRepeat did not), so the verse climbs + advances.
    const seen: number[] = [];
    for (let k = 0; k < 40; k++) {
      for (let i = 0; i < 6; i++) clear(e, 2);
      loopBoundary();
      await settle();
      seen.push(e.getAudioState().segmentIndex);
    }

    const s = e.getAudioState();
    // it must have climbed off the long verse (index 1) into later segments.
    expect(Math.max(...seen)).toBeGreaterThanOrEqual(2);
    expect(s.segmentIndex).toBe(s.segmentCount - 1); // reached TERMINAL
    expect(calls).toBe(1); // onSongComplete fired
  });
});

// Major 4: rapid same-type actions quantized to the SAME @16n time must not stomp
// one shared player (Tone throws on a non-increasing start). A voice pool round-
// robins across N players and monotonic-nudges the start time so hits overlap.
describe("SFX voice pool (no machine-gun stutter)", () => {
  it("rapid same-type fires spread across pooled voices with increasing start times", async () => {
    const e = await freshEngine("C"); // preset C routes `move` to the "move" SFX
    // first fire lazy-loads the pool; settle so the voices exist.
    e.fire({ type: "move" });
    await settle();
    const moveVoices = mockState.players.filter((p) =>
      p.url.includes("sfx-move"),
    );
    // a POOL of voices, not a single shared player.
    expect(moveVoices.length).toBeGreaterThan(1);

    // fire a burst of same-type actions on the SAME tick (mockState.now fixed).
    for (let i = 0; i < 8; i++) e.fire({ type: "move" });
    await settle();

    // collect every scheduled start across all move voices.
    const starts = moveVoices.flatMap((p) => p.starts).sort((a, b) => a - b);
    expect(starts.length).toBeGreaterThanOrEqual(8);
    // no two starts collide (strictly increasing after the monotonic-nudge) — the
    // exact condition that made a single player throw + drop the one-shot.
    for (let i = 1; i < starts.length; i++) {
      expect(starts[i]!).toBeGreaterThan(starts[i - 1]!);
    }
  });
});

describe("switchTrack (skin swap) on the manifest model", () => {
  it("swaps the live song, keeps a bed audible, updates BPM, bounds players", async () => {
    const e = await freshEngine("B");
    expect(e.getAudioState().trackId).toBe("song1");
    await e.switchTrack({ id: "song2", base: "/audio/song2" });
    await settle();
    const s = e.getAudioState();
    expect(s.trackId).toBe("song2");
    expect(s.segmentCount).toBe(3);
    expect(s.bpm).toBeCloseTo(126, 1);
    expect(s.activeStems).toBeLessThanOrEqual(2);
    expect(s.activeStems).toBeGreaterThanOrEqual(1);
  });

  it("switching to the SAME track is a no-op", async () => {
    const e = await freshEngine("B");
    const before = e.getAudioState().trackId;
    await e.switchTrack({ id: "song1", base: "/audio" });
    await settle();
    expect(e.getAudioState().trackId).toBe(before);
  });

  it("resolves a skin track by base dir when the id differs (pipeline -> song2)", async () => {
    const e = await freshEngine("B");
    await e.switchTrack({ id: "pipeline", base: "/audio/song2" });
    await settle();
    // resolved to song2 by base dir; track id reflects the requested skin id.
    expect(e.getAudioState().trackId).toBe("pipeline");
    expect(e.getAudioState().bpm).toBeCloseTo(126, 1);
  });
});
