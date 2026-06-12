/**
 * HEADLESS proof of the manifest-driven, N-tier, loop-quantized, CLEAR-GATED ENGINE.
 * Drives REAL clear/action events through the engine and asserts the measured
 * `getAudioState()` (the same data the browser probe exposes) plus a recording Tone
 * mock to prove the mechanics the player should HEAR — the CLEAR-GATED model where the
 * PLAYER'S CLEARS drive the song, NOT an autonomous clock:
 *
 *  1. a segment LOOPS in place with NO clears — segmentIndex stays put across many
 *     boundaries (the song does NOT advance on its own);
 *  2. clears RAISE the cumulative tier within a segment, STICKY — once revealed it
 *     does not drop without cause, bar-aligned (loop-boundary-only swaps);
 *  3. accumulating clears past ADVANCE_THRESHOLD advances exactly ONE segment forward
 *     on a boundary;
 *  4. spamming clears does NOT fast-forward multiple segments (the in-flight lock +
 *     per-segment reset);
 *  5. forward-only — the segment index never decrements;
 *  6. end-of-song (an earned advance past the last/TERMINAL segment) fires
 *     onSongComplete (→ the host switchTrack), exactly once;
 *  7. N-tier (4/5) fixtures; reconcile-on-load (no fall to silence); SFX voice pool;
 *  8. bounded active bed players (≤2, the no-hiss mechanic); degrade to silence.
 *
 * Tone is mocked: gains apply ramp targets immediately so `gain.value` reflects
 * intent, ramp START times are recorded so quantization is assertable, and the
 * self-rescheduling loop-tick one-shot is captured so the test can fire a loop
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
 * Bank ENOUGH clear-progress to earn ONE advance, then fire the boundary that commits
 * it. Uses the engine's own test-only `__injectClears` so the banked weight tracks the
 * real ADVANCE_THRESHOLD without the test hard-coding a clear count (10 weight-4 clears
 * = 40 ≥ the 30 gate, with headroom for the backlog cap). Asserts nothing — callers do.
 */
async function earnAdvance(e: InteractiveAudioEngine): Promise<void> {
  e.__injectClears(10); // 10 × weight-4 = 40, comfortably ≥ ADVANCE_THRESHOLD (30)
  loopBoundary();
  await settle();
}

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

async function freshEngine() {
  (globalThis as unknown as { window?: object }).window = globalThis;
  installFetch();
  const e = new InteractiveAudioEngine();
  await e.unlock();
  await settle();
  return e;
}

/** Spin up an engine on a custom manifest (for N-tier / advance-into-unloaded tests). */
async function freshEngineWith(manifest: unknown) {
  (globalThis as unknown as { window?: object }).window = globalThis;
  installFetch(manifest);
  const e = new InteractiveAudioEngine();
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

describe("clear-gated engine: loop-in-place, sticky reveal, gated advance", () => {
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

  it("loads the manifest, enters intro at the sticky floor (tier1, never silent)", async () => {
    const e = await freshEngine();
    const s = e.getAudioState();
    expect(s.segmentCount).toBe(4);
    expect(s.segmentIndex).toBe(0);
    expect(s.trackId).toBe("song1");
    expect(s.bpm).toBeCloseTo(110, 1);
    // sticky entry floor: a fresh segment is never bare — starts at tier1.
    expect(s.tier).toBe(1);
    expect(s.layerGains[1]).toBeGreaterThan(0.9);
    // no-hiss: exactly one bed player audible at steady state.
    expect(s.activeStems).toBe(1);
  });

  it("(a) a segment LOOPS IN PLACE with NO clears — the index never advances", async () => {
    const e = await freshEngine();
    expect(e.getAudioState().segmentIndex).toBe(0);
    // Fire MANY boundaries with zero clears. The clock must NOT move the song — the
    // segment loops in place. (This is the whole correction: no autonomous advance.)
    for (let k = 0; k < 10; k++) {
      loopBoundary();
      await settle();
      expect(e.getAudioState().segmentIndex).toBe(0);
    }
    // and the segment-count is unchanged (still on the same, still-loaded segment).
    expect(e.getAudioState().segmentIndex).toBe(0);
    expect(e.getAudioState().activeStems).toBeGreaterThanOrEqual(1);
  });

  it("(b) clears RAISE the cumulative tier within a segment, bar-aligned + STICKY", async () => {
    const e = await freshEngine();
    expect(e.getAudioState().tier).toBe(1); // entry floor
    // bank enough clear-progress to reveal tier2 (TIER_REVEAL_STEP=6 → tier2 at ≥12),
    // but NOT enough to advance (ADVANCE_THRESHOLD=30).
    for (let i = 0; i < 4; i++) clear(e, 2, 1); // weight 4 each → segmentScore 16
    await settle();
    // mid-loop the audible tier has NOT changed (swaps are boundary-only).
    expect(e.getAudioState().tier).toBe(1);
    mockState.rampStarts.length = 0;
    loopBoundary();
    await settle();
    // after the boundary the cumulative tier rose to tier2, and stayed on segment 0.
    expect(e.getAudioState().segmentIndex).toBe(0);
    expect(e.getAudioState().tier).toBe(2);
    // every swap ramp STARTS on a bar (loop) multiple — never mid-loop.
    expect(mockState.rampStarts.length).toBeGreaterThan(0);
    for (const t of mockState.rampStarts) {
      const bars = t / SEC_PER_BAR;
      expect(Math.abs(bars - Math.round(bars))).toBeLessThan(1e-6);
    }
    // STICKY: many dry boundaries with no clears must NOT drop the revealed tier.
    for (let k = 0; k < 5; k++) {
      loopBoundary();
      await settle();
      expect(e.getAudioState().tier).toBe(2); // held — no decay within the segment
      expect(e.getAudioState().segmentIndex).toBe(0); // still no advance (score < 30)
    }
  });

  it("(c) accumulating clears past the threshold advances exactly ONE segment forward", async () => {
    const e = await freshEngine();
    expect(e.getAudioState().segmentIndex).toBe(0);
    // bank past ADVANCE_THRESHOLD.
    e.__injectClears(10);
    await settle();
    // mid-loop the index has NOT moved (advance commits on the boundary only).
    expect(e.getAudioState().segmentIndex).toBe(0);
    loopBoundary();
    await settle();
    // exactly one step forward.
    expect(e.getAudioState().segmentIndex).toBe(1);
    expect(e.getAudioState().maxSegmentReached).toBe(1);
    // the new segment reset its clear-progress (re-earns its own advance from 0).
    expect(e.getAudioState().segmentScore).toBe(0);
  });

  it("(d) spamming clears does NOT fast-forward multiple segments (in-flight lock + reset)", async () => {
    const e = await freshEngine();
    const before = e.getAudioState().segmentIndex;
    // a massive burst — far more than enough for several advances if it stacked.
    for (let i = 0; i < 40; i++) clear(e, 4, 4);
    e.fire({ type: "chain", size: 8 });
    e.fire({ type: "chain", size: 8 });
    await settle();
    // backlog cap: segmentScore is bounded (can't bank many advances' worth).
    expect(e.getAudioState().segmentScore).toBeLessThanOrEqual(60); // ADVANCE_THRESHOLD*2
    loopBoundary();
    await settle();
    // ONE boundary = at most ONE advance, never a skip.
    expect(e.getAudioState().segmentIndex - before).toBe(1);
    // and the burst did NOT pre-pay the next advance: the new segment starts at 0.
    expect(e.getAudioState().segmentScore).toBe(0);
    // a SECOND boundary with no fresh clears must NOT advance again (would-be FF).
    loopBoundary();
    await settle();
    expect(e.getAudioState().segmentIndex - before).toBe(1);
  });

  it("(e) forward-only — the segment index NEVER decrements across a full play-through", async () => {
    const e = await freshEngine();
    const seen: number[] = [e.getAudioState().segmentIndex];
    // clear hard every pass and step boundaries; walk toward the end.
    for (let k = 0; k < 20; k++) {
      await earnAdvance(e); // earn an advance each pass
      seen.push(e.getAudioState().segmentIndex);
    }
    // every step is non-decreasing (no rewind) — and never jumps by >1.
    for (let i = 1; i < seen.length; i++) {
      expect(seen[i]!).toBeGreaterThanOrEqual(seen[i - 1]!);
      expect(seen[i]! - seen[i - 1]!).toBeLessThanOrEqual(1);
    }
    // it reached the last segment (a competent clearer walks the whole song).
    expect(Math.max(...seen)).toBe(e.getAudioState().segmentCount - 1);
  });

  it("(f) end-of-song: an earned advance past the TERMINAL segment fires onSongComplete once", async () => {
    const e = await freshEngine();
    let calls = 0;
    e.onSongComplete = () => {
      calls++;
    };
    const count = e.getAudioState().segmentCount; // 4
    // walk to the last (TERMINAL) segment by earning an advance each boundary.
    for (let k = 0; k < count - 1; k++) {
      await earnAdvance(e);
    }
    expect(e.getAudioState().segmentIndex).toBe(count - 1); // on the terminal segment
    expect(calls).toBe(0); // landing on it is NOT end-of-song; advancing PAST it is
    // earn one more advance — past the terminal segment → end-of-song.
    await earnAdvance(e);
    expect(calls).toBe(1); // fired
    // the terminal segment keeps LOOPING (index unchanged), no re-fire on more clears.
    expect(e.getAudioState().segmentIndex).toBe(count - 1);
    await earnAdvance(e);
    await earnAdvance(e);
    expect(calls).toBe(1); // still once (host's switchTrack would rebuild)
  });

  it("the sticky FLOOR carries forward — the next segment never resets to bare", async () => {
    const e = await freshEngine();
    // raise tier2 on segment 0, then advance.
    for (let i = 0; i < 3; i++) clear(e, 2, 1); // score 12 → arms tier2
    loopBoundary();
    await settle();
    expect(e.getAudioState().tier).toBe(2);
    // now earn the advance.
    await earnAdvance(e);
    expect(e.getAudioState().segmentIndex).toBe(1);
    // the carried floor = the tier reached (2), clamped to the new segment's ceiling.
    expect(e.getAudioState().tier).toBe(2); // not reset to tier0/bare
  });

  it("no-hiss: active bed players stay <= 2 throughout a full clear-driven play-through", async () => {
    const e = await freshEngine();
    let maxStems = 0;
    for (let k = 0; k < 16; k++) {
      await earnAdvance(e);
      maxStems = Math.max(maxStems, e.getAudioState().activeStems);
    }
    expect(maxStems).toBeLessThanOrEqual(2);
    expect(maxStems).toBeGreaterThanOrEqual(1);
  });

  it("looping players loop the SPILL-FREE bar window, not the full file (Blocker 1)", async () => {
    await freshEngine();
    await settle();
    const loaded = mockState.players.filter((p) => p.loopEnd > 0);
    expect(loaded.length).toBeGreaterThan(0);
    for (const p of loaded) {
      expect(p.loopEnd).toBeCloseTo(SEC_PER_BAR, 9);
    }
  });

  it("the loop tick is a self-rescheduling one-shot on the bar-window grid (not scheduleRepeat)", async () => {
    await freshEngine();
    await settle();
    expect(mockState.pending.length).toBe(1);
    const tick = mockState.pending[0]!;
    expect(typeof tick.time).toBe("number");
    const phase = tick.time / SEC_PER_BAR;
    expect(Math.abs(phase - Math.round(phase))).toBeLessThan(1e-6);
    const firstTime = tick.time;
    // re-arms itself even with NO clears (the segment must keep looping to reveal/advance).
    loopBoundary();
    await settle();
    expect(mockState.pending.length).toBe(1);
    expect(mockState.pending[0]!.time).toBeCloseTo(firstTime + SEC_PER_BAR, 6);
  });
});

// The showstopper found by the production playtest: long PROGRESSION segments froze
// forever because `${bars}m` scheduleRepeat with a large interval never fired. The
// seconds-based loop tick must keep firing on a multi-bar segment so a CLEARING player
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

  it("a clearing player walks PAST a 34-bar PROGRESSION segment (loop tick keeps firing)", async () => {
    (globalThis as unknown as { window?: object }).window = globalThis;
    installFetch(LONG_MANIFEST);
    const e = new InteractiveAudioEngine();
    await e.unlock();
    await settle();

    let calls = 0;
    e.onSongComplete = () => {
      calls++;
    };

    const s0 = e.getAudioState();
    const seen: number[] = [s0.segmentIndex];
    // Earn an advance every boundary; the long verse's loop tick must keep firing so
    // the CLEAR-GATED advance can fire on it (the old scheduleRepeat froze here).
    for (let k = 0; k < s0.segmentCount; k++) {
      await earnAdvance(e);
      seen.push(e.getAudioState().segmentIndex);
    }

    const s = e.getAudioState();
    // it climbed PAST the long verse (index 1) all the way to the TERMINAL segment.
    expect(Math.max(...seen)).toBe(s.segmentCount - 1);
    expect(s.maxSegmentReached).toBe(s.segmentCount - 1);
    expect(calls).toBe(1); // and earned the end-of-song advance past TERMINAL
  });
});

// Major 4: rapid same-type actions quantized to the SAME @16n time must not stomp
// one shared player (Tone throws on a non-increasing start). A voice pool round-
// robins across N players and monotonic-nudges the start time so hits overlap.
describe("SFX voice pool (no machine-gun stutter)", () => {
  it("rapid same-type fires spread across pooled voices with increasing start times", async () => {
    const e = await freshEngine(); // routing maps `rotate` to the "rotate" SFX
    e.fire({ type: "rotate" });
    await settle();
    const moveVoices = mockState.players.filter((p) =>
      p.url.includes("sfx-rotate"),
    );
    expect(moveVoices.length).toBeGreaterThan(1);

    for (let i = 0; i < 8; i++) e.fire({ type: "rotate" });
    await settle();

    const starts = moveVoices.flatMap((p) => p.starts).sort((a, b) => a - b);
    expect(starts.length).toBeGreaterThanOrEqual(8);
    for (let i = 1; i < starts.length; i++) {
      expect(starts[i]!).toBeGreaterThan(starts[i - 1]!);
    }
  });

  it("a CLEAR is silent — it fires NO SFX voice (only feeds clear-progress)", async () => {
    const e = await freshEngine();
    const before = mockState.players.length;
    for (let i = 0; i < 6; i++) clear(e, 2, 1);
    await settle();
    // no new SFX players were constructed by the clears (clears are silent).
    const sfxPlayers = mockState.players
      .slice(before)
      .filter((p) => p.url.includes("sfx-"));
    expect(sfxPlayers.length).toBe(0);
    // but the clears DID register as clear-progress (the audible effect is the tier).
    expect(e.getAudioState().segmentScore).toBeGreaterThan(0);
  });
});

describe("switchTrack (skin swap) on the manifest model", () => {
  it("swaps the live song, keeps a bed audible, updates BPM, bounds players", async () => {
    const e = await freshEngine();
    expect(e.getAudioState().trackId).toBe("song1");
    await e.switchTrack({ id: "song2", base: "/audio/song2" });
    await settle();
    const s = e.getAudioState();
    expect(s.trackId).toBe("song2");
    expect(s.segmentCount).toBe(3);
    expect(s.bpm).toBeCloseTo(126, 1);
    expect(s.activeStems).toBeLessThanOrEqual(2);
    expect(s.activeStems).toBeGreaterThanOrEqual(1);
    // a fresh song resets clear-progress (re-earns its first advance from 0).
    expect(s.segmentScore).toBe(0);
    expect(s.segmentIndex).toBe(0);
  });

  it("switching to the SAME track is a no-op", async () => {
    const e = await freshEngine();
    const before = e.getAudioState().trackId;
    await e.switchTrack({ id: "song1", base: "/audio" });
    await settle();
    expect(e.getAudioState().trackId).toBe(before);
  });

  it("resolves a skin track by base dir when the id differs (pipeline -> song2)", async () => {
    const e = await freshEngine();
    await e.switchTrack({ id: "pipeline", base: "/audio/song2" });
    await settle();
    expect(e.getAudioState().trackId).toBe("pipeline");
    expect(e.getAudioState().bpm).toBeCloseTo(126, 1);
  });
});

// ── N-tier generalization (the whole point of the N-tier work) ───────────────────
// Every default fixture is 3-tier; these prove the engine is genuinely tier-count-
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

  it("clears can drive the tier up to tierCount-1 on a 4-tier segment (reaches tier 3)", async () => {
    const e = await freshEngineWith(nTierManifest("song4", 4));
    expect(e.getAudioState().tierCount).toBe(4);
    // pour clear-progress to the top reveal step (tier3 at ≥18) but below advance (30):
    // 6 weight-3 clears (squares 2, combo 0 → 1+2+0=3) → segmentScore 18.
    for (let i = 0; i < 6; i++) clear(e, 2, 0);
    loopBoundary();
    await settle();
    expect(e.getAudioState().segmentIndex).toBe(0); // not yet advanced (score < 30)
    expect(e.getAudioState().tier).toBe(3); // top of a 4-tier segment
    expect(e.getAudioState().tierCount).toBe(4);
  });

  it("clears can drive the tier up to tierCount-1 on a 5-tier segment (reaches tier 4)", async () => {
    const e = await freshEngineWith(nTierManifest("song5", 5));
    expect(e.getAudioState().tierCount).toBe(5);
    // tier4 reveals at score ≥24; the advance gate sits ABOVE it (30), so the top tier
    // is fully revealed in place BEFORE the segment would advance. Bank 24 (between the
    // top reveal and the advance gate): 8 weight-3 clears (squares 2, combo 0 → 3).
    for (let i = 0; i < 8; i++) clear(e, 2, 0); // score 24 → tier4, < advance (30)
    loopBoundary();
    await settle();
    expect(e.getAudioState().segmentIndex).toBe(0); // revealed, not yet advanced
    expect(e.getAudioState().tier).toBe(4); // top of a 5-tier segment
    expect(e.getAudioState().tierCount).toBe(5);
  });

  it("the tier CLAMPS at the ceiling — a 5-tier segment never shows a tier ≥ tierCount", async () => {
    const e = await freshEngineWith(nTierManifest("song5", 5));
    // hammer clears far past everything; the entered segment must clamp its tier.
    for (let i = 0; i < 60; i++) clear(e, 4, 4);
    loopBoundary();
    await settle();
    const s = e.getAudioState();
    expect(s.tier).toBeLessThanOrEqual(s.tierCount - 1);
  });

  it("a single HOT bar banking BOTH thresholds reveals the top tier BEFORE it advances (carried floor is high)", async () => {
    // The invariant: a bar that earns the top-tier reveal AND the advance in ONE pass
    // must be FULLY revealed before it moves on, and carry that high tier forward as the
    // next segment's sticky floor — NOT advance off a bare tier. (Reveal-before-advance.)
    const e = await freshEngineWith(nTierManifest("song5", 5));
    expect(e.getAudioState().tierCount).toBe(5);
    expect(e.getAudioState().tier).toBe(1); // entry floor, nothing revealed yet
    // bank PAST both the top reveal (tier4 at 24) AND the advance gate (30) in one pass.
    e.__injectClears(10); // 10 × weight-4 = 40 ≥ 30, and ≥ 24 (top reveal)
    loopBoundary();
    await settle();
    // it advanced exactly one segment...
    expect(e.getAudioState().segmentIndex).toBe(1);
    // ...AND carried the fully-revealed top tier forward (not a bare floor). Before the
    // fix this was the un-bumped entry tier (1) because advance pre-empted the reveal.
    expect(e.getAudioState().tier).toBe(4); // top of the 5-tier segment, carried forward
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
    expect(s.tierCount).toBe(5);
    expect(s.activeStems).toBeGreaterThanOrEqual(1);
    expect(s.activeStems).toBeLessThanOrEqual(2);
  });
});

// ── Blocker 2: advance-into-unloaded must reconcile gain, not play silent ─────────
describe("advance-into-unloaded segment re-gains on load (Blocker 2)", () => {
  it("a segment advanced into BEFORE its players load becomes audible once the load resolves", async () => {
    const e = await freshEngineWith(nTierManifest("song1", 4));
    expect(e.getAudioState().activeStems).toBe(1);

    mockState.deferLoads = true;

    // earn an advance into seg 1 (already prefetched/loaded). This kicks the prefetch
    // of seg 2 — now DEFERRED (parked, not resolved).
    await earnAdvance(e);
    expect(e.getAudioState().segmentIndex).toBe(1);

    // earn an advance into seg 2, whose players have NOT loaded. enterSegment ramps
    // undefined gains: the segment is momentarily SILENT (the bug window).
    await earnAdvance(e);
    expect(e.getAudioState().segmentIndex).toBe(2);
    expect(e.getAudioState().activeStems).toBe(0); // nothing audible — the bug window

    // the destination's load resolves → reconcile must ramp the target tier up.
    await releaseDeferredLoads();
    const s = e.getAudioState();
    expect(s.segmentIndex).toBe(2);
    expect(s.activeStems).toBeGreaterThanOrEqual(1); // re-gained: audible again
    expect(s.layerGains[s.tier]).toBeGreaterThan(0.5);
  });

  it("NaN/Infinity clear weights never poison the tier (onScore guard)", async () => {
    const e = await freshEngine();
    const before = e.getAudioState().segmentScore;
    // a poisoned upstream event: NaN squares. onScore must ignore it, not corrupt state.
    e.fire({ type: "lineClear", squares: Number.NaN, combo: 1 });
    e.fire({ type: "lineClear", squares: 2, combo: Number.POSITIVE_INFINITY });
    await settle();
    const s = e.getAudioState();
    expect(Number.isFinite(s.segmentScore)).toBe(true);
    expect(s.segmentScore).toBe(before); // poisoned weights were ignored
    loopBoundary();
    await settle();
    // and the tier is still a finite, in-range integer (not NaN).
    const s2 = e.getAudioState();
    expect(Number.isFinite(s2.tier)).toBe(true);
    expect(s2.tier).toBeGreaterThanOrEqual(0);
    expect(s2.tier).toBeLessThanOrEqual(s2.tierCount - 1);
  });
});
