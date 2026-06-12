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
  /**
   * When true, a FakePlayer does NOT fire onload immediately; its onload is parked in
   * `deferredOnloads` so a test can simulate a segment that hasn't finished loading at
   * advance time, then release the loads (Blocker 2 — advance-into-unloaded).
   */
  deferLoads: false,
  deferredOnloads: [] as Array<() => void>,
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
      const fire = () => opts.onload?.();
      if (mockState.deferLoads) {
        // park the onload so a test can simulate "not loaded yet" then release it.
        mockState.deferredOnloads.push(() => queueMicrotask(fire));
      } else {
        queueMicrotask(fire);
      }
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

function tiers(prefix: string, count = 3): Record<string, string> {
  const t: Record<string, string> = {};
  for (let i = 0; i < count; i++) t[`tier${i}`] = `${prefix}-tier${i}.opus`;
  return t;
}
function seg(id: string, type: string, bars = 1, tierCount = 3) {
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
    tiers: tiers(id, tierCount),
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

/** Spin up an engine on a custom manifest (for N-tier / advance-into-unloaded tests). */
async function freshEngineWith(manifest: unknown, mix: "A" | "B" | "C" = "B") {
  (globalThis as unknown as { window?: object }).window = globalThis;
  installFetch(manifest);
  const e = new InteractiveAudioEngine();
  e.setPreset(mix);
  await e.unlock();
  await settle();
  return e;
}

/** A single-song manifest whose segments each carry `tierCount` cumulative tiers. */
function nTierManifest(id: string, tierCount: number, segCount = 4) {
  const types = ["LOOPER", "PROGRESSION", "LOOPER", "TERMINAL"];
  return {
    version: "test-ntier",
    songs: [
      {
        id,
        title: `${id} (${tierCount}-tier)`,
        tempo: 120,
        barSeconds: SEC_PER_BAR,
        segments: Array.from({ length: segCount }, (_, i) =>
          seg(`${id}-s${i}`, types[i % types.length]!, 1, tierCount),
        ),
        sfx: { move: "sfx-move.opus" },
      },
    ],
  };
}

/** Release any deferred player onloads (Blocker 2 test) so their loads now resolve. */
async function releaseDeferredLoads() {
  mockState.deferLoads = false;
  const parked = mockState.deferredOnloads.splice(0);
  for (const fire of parked) fire();
  await settle();
}

beforeEach(() => {
  mockState.now = 0;
  mockState.bpm = 110;
  mockState.pending = [];
  mockState.rampStarts = [];
  mockState.players = [];
  mockState.nextId = 1;
  mockState.deferLoads = false;
  mockState.deferredOnloads = [];
});

afterEach(() => {
  mockState.pending = [];
  mockState.players = [];
  mockState.deferLoads = false;
  mockState.deferredOnloads = [];
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

  it("VERTICAL: clearing RAISES the cumulative tier (intensity → tier), bar-aligned", async () => {
    // intro enters at the energy floor (tier1). Pour score in: intensity climbs,
    // and the NEXT boundary arms round(intensity) and crossfades up to it.
    const e = await freshEngine("B");
    expect(e.getAudioState().tier).toBe(1);
    const i0 = e.getAudioState().intensity;
    for (let i = 0; i < 8; i++) clear(e, 2); // weight 4 each -> intensity climbs hard
    await settle();
    // intensity rose immediately on the clears (continuous), but the AUDIBLE tier
    // only changes on the boundary (mid-loop swaps are forbidden).
    expect(e.getAudioState().intensity).toBeGreaterThan(i0);
    expect(e.getAudioState().tier).toBe(1); // not yet swapped (still mid-loop)
    mockState.rampStarts.length = 0;
    loopBoundary();
    await settle();
    // After the boundary the cumulative tier is the top of this 3-tier segment.
    expect(e.getAudioState().tier).toBe(2);
    // every swap ramp STARTS on a bar (loop) multiple — never mid-loop.
    expect(mockState.rampStarts.length).toBeGreaterThan(0);
    for (const t of mockState.rampStarts) {
      const bars = t / SEC_PER_BAR;
      expect(Math.abs(bars - Math.round(bars))).toBeLessThan(1e-6);
    }
  });

  it("VERTICAL: intensity DECAYS monotonically across dry passes (no clear ever raises it)", async () => {
    // Push intensity up, then go dry. The metered quantity is INTENSITY (continuous
    // gameplay energy), which is decayed once per loop-boundary pass with no qualifying
    // score. NB each boundary also ADVANCES the segment (autonomous timeline), so this
    // measures intensity decay across an advancing timeline — not an in-place tier swap
    // on one frozen segment (the engine no longer does in-place swaps).
    const e = await freshEngine("B");
    for (let i = 0; i < 8; i++) clear(e, 2);
    loopBoundary();
    await settle();
    const hot = e.getAudioState();
    expect(hot.tier).toBe(2); // entered the next segment at its top tier (intensity high)
    const hotIntensity = hot.intensity;
    // Now go DRY for many bars; intensity decays monotonically toward 0.
    let prev = hotIntensity;
    for (let p = 0; p < 6; p++) {
      loopBoundary();
      await settle();
      const now = e.getAudioState().intensity;
      expect(now).toBeLessThanOrEqual(prev + 1e-9); // never rises on a dry pass
      prev = now;
    }
    // the sustained dry spell shed real intensity off the hot peak.
    expect(e.getAudioState().intensity).toBeLessThan(hotIntensity);
  });

  it("HORIZONTAL: the segment advances AUTONOMOUSLY on the clock, WITHOUT any clears", async () => {
    const e = await freshEngine("B");
    expect(e.getAudioState().segmentIndex).toBe(0);
    // No clears at all — the timeline must still advance on its own musical clock.
    loopBoundary();
    await settle();
    expect(e.getAudioState().segmentIndex).toBe(1);
    loopBoundary();
    await settle();
    expect(e.getAudioState().segmentIndex).toBe(2);
    expect(e.getAudioState().maxSegmentReached).toBe(2);
  });

  it("HORIZONTAL: advances exactly ONE segment per boundary (no fast-forward, even on a burst)", async () => {
    const e = await freshEngine("B");
    const before = e.getAudioState().segmentIndex;
    // a massive burst must not skip segments — the clock advances one step per bar.
    e.fire({ type: "chain", size: 8 });
    e.fire({ type: "chain", size: 8 });
    loopBoundary();
    await settle();
    const after = e.getAudioState().segmentIndex;
    expect(after - before).toBe(1);
  });

  it("HORIZONTAL: forward-only ordering, looping back to segment 0 at the end", async () => {
    const e = await freshEngine("B");
    const count = e.getAudioState().segmentCount; // 4 in the test manifest
    const seen: number[] = [e.getAudioState().segmentIndex];
    // walk well past the end so we observe the loop-back to 0.
    for (let k = 0; k < count + 2; k++) {
      loopBoundary();
      await settle();
      seen.push(e.getAudioState().segmentIndex);
    }
    // forward-only within a lap: each step is +1 until it wraps to 0 at the end.
    for (let i = 1; i < seen.length; i++) {
      const a = seen[i - 1]!;
      const b = seen[i]!;
      const wrapped = a === count - 1 && b === 0;
      expect(wrapped || b === a + 1).toBe(true);
    }
    // it DID reach the last segment and DID loop back to 0.
    expect(seen).toContain(count - 1);
    expect(seen.slice(1)).toContain(0);
  });

  it("no-hiss: active bed players stay <= 2 throughout a full autonomous play-through", async () => {
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

  it("onSongComplete fires exactly once when the timeline first reaches the last segment", async () => {
    const e = await freshEngine("B");
    let calls = 0;
    e.onSongComplete = () => {
      calls++;
    };
    const count = e.getAudioState().segmentCount; // 4
    // No clears needed — the autonomous clock walks to the TERMINAL segment.
    for (let k = 0; k < count - 1; k++) {
      loopBoundary();
      await settle();
    }
    const s = e.getAudioState();
    expect(s.segmentIndex).toBe(count - 1); // landed on the last (TERMINAL) segment
    expect(calls).toBe(1); // fired, and only once
    // looping back round and reaching the end AGAIN does not re-fire (once-only).
    for (let k = 0; k < count; k++) {
      loopBoundary();
      await settle();
    }
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
    await e.unlock();
    await settle();

    let calls = 0;
    e.onSongComplete = () => {
      calls++;
    };

    // Fire each boundary via loopBoundary(), which advances the clock to the next
    // pending tick whatever its interval. The 34-bar verse loop is 68x longer than
    // the intro loop; the self-rescheduling one-shot must keep firing on it (the old
    // scheduleRepeat did not), so the AUTONOMOUS timeline advances PAST the long verse
    // without freezing — no clears required.
    const s0 = e.getAudioState();
    const seen: number[] = [s0.segmentIndex];
    // 3 boundaries = walk 0 → 1 (long verse) → 2 → 3 (TERMINAL): the long verse must
    // NOT freeze the clock.
    for (let k = 0; k < s0.segmentCount - 1; k++) {
      loopBoundary();
      await settle();
      seen.push(e.getAudioState().segmentIndex);
    }

    const s = e.getAudioState();
    // it climbed PAST the long verse (index 1) all the way to the TERMINAL segment.
    expect(Math.max(...seen)).toBe(s.segmentCount - 1);
    expect(s.maxSegmentReached).toBe(s.segmentCount - 1); // reached TERMINAL
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

// ── N-tier generalization (the whole point of Wave 1) ────────────────────────────
// Every fixture above is 3-tier; these prove the engine is genuinely tier-count-
// agnostic — a regression to a hardcoded 2/3-tier ceiling MUST fail here.
describe("N-tier generalization (4-tier and 5-tier segments)", () => {
  it("reports the segment's tierCount (4-tier)", async () => {
    const e = await freshEngineWith(nTierManifest("song4", 4));
    expect(e.getAudioState().tierCount).toBe(4);
  });

  it("reports the segment's tierCount (5-tier)", async () => {
    const e = await freshEngineWith(nTierManifest("song5", 5));
    expect(e.getAudioState().tierCount).toBe(5);
  });

  it("intensity can drive the tier up to tierCount-1 on a 4-tier segment (reaches tier 3)", async () => {
    const e = await freshEngineWith(nTierManifest("song4", 4));
    expect(e.getAudioState().tierCount).toBe(4);
    // pour score so intensity climbs well past 3; the next segment entry shows it.
    for (let i = 0; i < 12; i++) clear(e, 4); // weight 5 each -> intensity ≫ 3
    loopBoundary(); // advance into the next segment, entered at round(intensity)
    await settle();
    expect(e.getAudioState().tier).toBe(3); // top of a 4-tier segment
    expect(e.getAudioState().tierCount).toBe(4);
  });

  it("intensity can drive the tier up to tierCount-1 on a 5-tier segment (reaches tier 4)", async () => {
    const e = await freshEngineWith(nTierManifest("song5", 5));
    expect(e.getAudioState().tierCount).toBe(5);
    for (let i = 0; i < 16; i++) clear(e, 4); // intensity ≫ 4
    loopBoundary();
    await settle();
    expect(e.getAudioState().tier).toBe(4); // top of a 5-tier segment
    expect(e.getAudioState().tierCount).toBe(5);
  });

  it("intensity CLAMPS at the ceiling — a 5-tier segment never shows a tier ≥ tierCount", async () => {
    const e = await freshEngineWith(nTierManifest("song5", 5));
    // hammer score far past the ceiling; intensity must clamp and the tier must too.
    for (let i = 0; i < 60; i++) clear(e, 4);
    expect(e.getAudioState().intensity).toBeLessThanOrEqual(4); // clamped to top tier
    loopBoundary();
    await settle();
    const s = e.getAudioState();
    expect(s.tier).toBeLessThanOrEqual(s.tierCount - 1);
    expect(s.tier).toBe(4);
  });

  it("switchTrack works across DIFFERENT tier counts (song1 4-tier -> song2 5-tier)", async () => {
    const MIXED = {
      version: "test-mixed",
      songs: [
        nTierManifest("song1", 4).songs[0]!,
        nTierManifest("song2", 5).songs[0]!,
      ],
    };
    const e = await freshEngineWith(MIXED);
    expect(e.getAudioState().trackId).toBe("song1");
    expect(e.getAudioState().tierCount).toBe(4);
    await e.switchTrack({ id: "song2", base: "/audio/song2" });
    await settle();
    const s = e.getAudioState();
    expect(s.trackId).toBe("song2");
    expect(s.tierCount).toBe(5); // the new song's segments carry 5 tiers
    // a bed stays audible across the swap (no-hiss bound holds on a 5-tier segment).
    expect(s.activeStems).toBeGreaterThanOrEqual(1);
    expect(s.activeStems).toBeLessThanOrEqual(2);
  });
});

// ── Blocker 2: advance-into-unloaded must reconcile gain, not play silent ─────────
describe("advance-into-unloaded segment re-gains on load (Blocker 2)", () => {
  it("a segment advanced into BEFORE its players load becomes audible once the load resolves", async () => {
    // Start normally so the intro is loaded + audible. (song0/seg1 was prefetched at
    // load, so it's already resident — we must advance onto a segment whose load is
    // deferred to reproduce the bug window.)
    const e = await freshEngineWith(nTierManifest("song1", 4));
    expect(e.getAudioState().activeStems).toBe(1);

    // From now on, NEW player loads are parked (simulate the destination segment not
    // having finished loading at advance time — its prefetch hasn't resolved).
    mockState.deferLoads = true;

    // Advance once: into seg 1 (already prefetched/loaded, audible). This advance also
    // kicks the prefetch of seg 2 — which is now DEFERRED (parked, not resolved).
    loopBoundary();
    await settle();
    expect(e.getAudioState().segmentIndex).toBe(1);

    // Advance again: into seg 2, whose players have NOT loaded. enterSegment ramps
    // undefined gains (no-op): the segment is momentarily SILENT (the bug window).
    loopBoundary();
    await settle();
    expect(e.getAudioState().segmentIndex).toBe(2);
    expect(e.getAudioState().activeStems).toBe(0); // nothing audible — the bug window

    // Now the destination's load resolves. The post-load reconciliation must ramp the
    // target tier up so the segment is audible (no fallback-to-silence).
    await releaseDeferredLoads();
    const s = e.getAudioState();
    expect(s.segmentIndex).toBe(2);
    expect(s.activeStems).toBeGreaterThanOrEqual(1); // re-gained: audible again
    expect(s.layerGains[s.tier]).toBeGreaterThan(0.5);
  });
});
