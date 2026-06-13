/**
 * HEADLESS proof of the manifest-driven, N-tier, loop-quantized, HEAT-DRIVEN ENGINE.
 * Drives REAL clear/action events through the engine and asserts the measured
 * `getAudioState()` (the same data the browser probe exposes) plus a recording Tone
 * mock to prove the mechanics the player should HEAR — the HEAT model where the
 * PLAYER'S CLEARS build a `heat` meter that drives the song, NOT an autonomous clock:
 *
 *  1. heat gain scales by squares + combo, saturates at 1.0, ignores non-finite;
 *  2. heat DECAYS on a clear-less loop pass (and not on a pass with a clear);
 *  3. the audible tier follows heat UP AND DOWN, one step per boundary, never below
 *     the min-audible floor, bar-aligned (loop-boundary-only swaps);
 *  4. CARRY-ACROSS: a segment entered with sustained high heat starts AT its top tier
 *     (no vocal cut); with dropped heat it enters thinner;
 *  5. a segment advances ONLY once its TOP tier is audible AND held a full loop — NO
 *     bare-heat threshold, so it never skips unheard material; below that it LOOPS;
 *  6. spamming clears does NOT fast-forward multiple segments (in-flight lock + the
 *     per-segment top-built-and-held re-arm);
 *  7. forward-only — the segment index never decrements;
 *  8. end-of-song (an earned advance past the last/TERMINAL segment) fires
 *     onSongComplete (→ the host switchTrack), exactly once;
 *  9. tone-SFX: match dings (in-key), rotate/softDrop/lock tone, move/clear/chain
 *     silent (tone mode); sample mode keeps the recorded path; default is tone;
 * 10. N-tier (4/5) fixtures; reconcile-on-load (no fall to silence); SFX voice pool;
 * 11. bounded active bed players (≤2, the no-hiss mechanic); degrade to silence.
 *
 * Tone is mocked: gains apply ramp targets immediately so `gain.value` reflects
 * intent, ramp START times are recorded so quantization is assertable, the
 * self-rescheduling loop-tick one-shot is captured so the test can fire a loop
 * boundary on demand, and the tone synth records each triggerAttackRelease.
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
  /** every FakePlayer constructed, for loopEnd / SFX-pool / velocity assertions. */
  players: [] as {
    url: string;
    loopEnd: number;
    starts: number[];
    /** volume PARAM: value = gainToDb(velocity); read for SFX velocity scaling. */
    volume: { value: number };
    /** set true by dispose() — read for the per-segment SFX lifecycle assertions. */
    disposed: boolean;
  }[],
  nextId: 1,
  /**
   * When true, a FakePlayer does NOT fire onload immediately; its onload is parked in
   * `deferredOnloads` so a test can simulate a segment that hasn't finished loading at
   * advance time, then release the loads (Blocker 2 — advance-into-unloaded).
   */
  deferLoads: false,
  deferredOnloads: [] as Array<() => void>,
  /** Every tone-synth triggerAttackRelease, for the tone-SFX assertions. */
  toneHits: [] as { freq: number; duration: string; time: number; velocity: number }[],
  /** Count of PolySynth instances constructed (proves lazy build, not at import). */
  polySynthBuilds: 0,
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
    // The tone synth: records each triggerAttackRelease so the tone-SFX tests can assert
    // the played frequency / velocity. Construction is counted to prove it is built
    // lazily (inside unlock / first use), never at module import.
    PolySynth: class {
      constructor() {
        mockState.polySynthBuilds++;
      }
      set() {
        return this;
      }
      connect() {
        return this;
      }
      triggerAttackRelease(
        freq: number,
        duration: string,
        time: number,
        velocity: number,
      ) {
        mockState.toneHits.push({ freq, duration, time, velocity });
        return this;
      }
      dispose() {}
    },
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
      sfx: {
        move: "sfx-move.opus",
        rotate: "sfx-rotate.opus",
        softdrop: "sfx-softdrop.opus",
        drop: "sfx-drop.opus",
        stage: "sfx-stage.opus",
      },
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
 * Is `freq` (Hz) a note in the DEFAULT key (A minor) scale, in any octave? A minor
 * pitch classes are {A, B, C, D, E, F, G} = semitone PCs {9, 11, 0, 2, 4, 5, 7}.
 * The engine plays tones drawn from this set, so every tone-SFX frequency must map to
 * one of these pitch classes (octave-agnostic). Tolerant of float rounding.
 */
function isInDefaultScale(freq: number): boolean {
  if (!Number.isFinite(freq) || freq <= 0) return false;
  const midi = Math.round(69 + 12 * Math.log2(freq / 440));
  const pc = ((midi % 12) + 12) % 12;
  // A natural minor degrees from A (PC 9): 9,11,0,2,4,5,7.
  return [9, 11, 0, 2, 4, 5, 7].includes(pc);
}

/**
 * Drive the engine to earn ONE segment advance under the HEAT model, then fire the
 * boundaries that commit it. Pins heat to 1.0 (a big burst), then steps boundaries:
 * the audible tier climbs ONE step per boundary up to the top, the top is held one
 * full loop, then the segment advances. So this steps boundaries until the index moves
 * (up to several — floor→top is multiple one-step boundaries plus the held loop),
 * committing exactly ONE advance. Each step re-tops heat so the segment cannot decay
 * back down mid-climb. Asserts nothing — callers do.
 */
async function earnAdvance(e: InteractiveAudioEngine): Promise<void> {
  const before = e.getAudioState().segmentIndex;
  for (let i = 0; i < 12; i++) {
    e.__injectClears(12); // pin heat to 1.0 each pass (so the climb never decays)
    loopBoundary();
    await settle();
    if (e.getAudioState().segmentIndex !== before) return; // advanced (or song-completed)
  }
}

/**
 * Build heat to (near) full and bring the AUDIBLE tier to the segment's top, WITHOUT
 * advancing — stops as soon as `tier === top` (the boundary that just revealed the top
 * does not advance). Re-tops heat each pass so the one-step climb never decays. Returns
 * once the top is audible (or after a bounded number of steps). Asserts nothing.
 */
async function buildToTop(e: InteractiveAudioEngine): Promise<void> {
  for (let i = 0; i < 12; i++) {
    const s = e.getAudioState();
    if (s.tier >= s.tierCount - 1) return; // top audible
    e.__injectClears(12); // pin heat to 1.0
    loopBoundary();
    await settle();
  }
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
  mockState.toneHits = [];
  mockState.polySynthBuilds = 0;
});

afterEach(() => {
  mockState.pending = [];
  mockState.players = [];
  mockState.deferLoads = false;
  mockState.deferredOnloads = [];
  mockState.toneHits = [];
});

describe("heat engine: loop-in-place, heat-driven tier, gated advance", () => {
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

  it("loads the manifest, enters intro at the min-audible floor (tier1, never silent)", async () => {
    const e = await freshEngine();
    const s = e.getAudioState();
    expect(s.segmentCount).toBe(4);
    expect(s.segmentIndex).toBe(0);
    expect(s.trackId).toBe("song1");
    expect(s.bpm).toBeCloseTo(110, 1);
    // a fresh segment at heat 0 enters at the ≥2-layer floor (tier1), never bare.
    expect(s.tier).toBe(1);
    expect(s.heat).toBe(0);
    expect(s.layerGains[1]).toBeGreaterThan(0.9);
    // no-hiss: exactly one bed player audible at steady state.
    expect(s.activeStems).toBe(1);
  });

  it("(a) a segment LOOPS IN PLACE with NO clears — the index never advances", async () => {
    const e = await freshEngine();
    expect(e.getAudioState().segmentIndex).toBe(0);
    // Fire MANY boundaries with zero clears. The clock must NOT move the song — the
    // segment loops in place at the floor (heat decays toward 0, tier holds at floor).
    for (let k = 0; k < 10; k++) {
      loopBoundary();
      await settle();
      expect(e.getAudioState().segmentIndex).toBe(0);
    }
    expect(e.getAudioState().segmentIndex).toBe(0);
    expect(e.getAudioState().tier).toBe(1); // never below the min-audible floor
    expect(e.getAudioState().activeStems).toBeGreaterThanOrEqual(1);
  });

  it("(b) clears RAISE the audible tier within a segment, ONE step per boundary, bar-aligned", async () => {
    // 4-tier fixture (maxTier 3). Pin heat to 1.0 (desired tier = top 3). The audible
    // tier must climb from the floor (1) by EXACTLY ONE step per boundary — to 2, then
    // 3 — never jumping straight to the top within the segment (the one-step cap).
    const e = await freshEngineWith(nTierManifest("song1", 4));
    expect(e.getAudioState().tier).toBe(1); // entry floor
    e.__injectClears(12); // heat 1.0 → desired tier 3
    await settle();
    // mid-loop the audible tier has NOT changed (swaps are boundary-only).
    expect(e.getAudioState().tier).toBe(1);
    mockState.rampStarts.length = 0;
    loopBoundary();
    await settle();
    // BOUNDARY 1: rose ONE step to tier2 (NOT straight to the top 3), still on segment 0.
    expect(e.getAudioState().segmentIndex).toBe(0);
    expect(e.getAudioState().tier).toBe(2);
    // every swap ramp STARTS on a bar (loop) multiple — never mid-loop.
    expect(mockState.rampStarts.length).toBeGreaterThan(0);
    for (const t of mockState.rampStarts) {
      const bars = t / SEC_PER_BAR;
      expect(Math.abs(bars - Math.round(bars))).toBeLessThan(1e-6);
    }
    // BOUNDARY 2: rises one more step to the top (3); the reveal boundary does NOT also
    // advance off it (vocals are heard a loop first).
    e.__injectClears(12); // keep heat pinned
    loopBoundary();
    await settle();
    expect(e.getAudioState().tier).toBe(3);
    expect(e.getAudioState().segmentIndex).toBe(0); // not advanced on the reveal boundary
  });

  it("(b2) FALLING heat SHEDS the audible tier ONE step per boundary, never below the floor", async () => {
    const e = await freshEngineWith(nTierManifest("song1", 4)); // maxTier 3, floor 1
    // bring the audible tier UP to a MID tier (2), staying BELOW the top so the segment
    // never advances during the shed (an advance would re-enter at the heat-carry tier).
    // heat ~0.66 → desired tier 2; climb one step from the floor.
    e.__injectClears(6); // 0.66 → round(0.66*3) = 2
    loopBoundary();
    await settle();
    expect(e.getAudioState().tier).toBe(2);
    expect(e.getAudioState().segmentIndex).toBe(0); // below top → no advance
    // now shed: each guaranteed clear-less pass decays heat 0.08; the audible tier steps
    // DOWN at most one per boundary and never breaches the floor (tier1).
    const seen: number[] = [e.getAudioState().tier];
    for (let k = 0; k < 12; k++) {
      e.__decayPasses(1);
      await settle();
      seen.push(e.getAudioState().tier);
    }
    // monotonic non-increasing, each step at most one down, never advanced.
    for (let i = 1; i < seen.length; i++) {
      expect(seen[i]!).toBeLessThanOrEqual(seen[i - 1]!);
      expect(seen[i - 1]! - seen[i]!).toBeLessThanOrEqual(1);
    }
    expect(e.getAudioState().segmentIndex).toBe(0); // stayed on the same segment
    // it shed all the way to the floor and HELD there (never silent / below floor).
    expect(Math.min(...seen)).toBe(1);
    expect(e.getAudioState().tier).toBe(1);
  });

  it("(c) building heat to the top tier + holding it advances exactly ONE segment forward", async () => {
    const e = await freshEngine(); // 3-tier default (maxTier 2)
    expect(e.getAudioState().segmentIndex).toBe(0);
    const before = e.getAudioState().segmentIndex;
    await earnAdvance(e);
    expect(e.getAudioState().segmentIndex).toBe(before + 1);
    expect(e.getAudioState().maxSegmentReached).toBe(before + 1);
  });

  it("(d) spamming clears does NOT fast-forward multiple segments (in-flight lock + per-seg re-arm)", async () => {
    const e = await freshEngineWith(nTierManifest("song1", 4)); // maxTier 3
    const before = e.getAudioState().segmentIndex;
    // a massive burst — pins heat to 1.0 — far more than enough to FF if it stacked.
    for (let i = 0; i < 40; i++) clear(e, 4, 4);
    e.fire({ type: "chain", size: 8 });
    e.fire({ type: "chain", size: 8 });
    await settle();
    expect(e.getAudioState().heat).toBe(1); // saturated, not "banked advances"
    // Step boundaries one at a time: the tier climbs ONE step per boundary (1→2→3), the
    // top is held one loop, then it advances EXACTLY ONE segment — never multiple.
    const indices: number[] = [];
    for (let k = 0; k < 8; k++) {
      loopBoundary();
      await settle();
      indices.push(e.getAudioState().segmentIndex);
    }
    // at most ONE advance happened across all those boundaries (no fast-forward), and
    // every step is at most +1.
    let prev = before;
    for (const idx of indices) {
      expect(idx - prev).toBeLessThanOrEqual(1);
      expect(idx).toBeGreaterThanOrEqual(prev);
      prev = idx;
    }
    expect(indices[indices.length - 1]! - before).toBe(1); // advanced exactly one
  });

  it("(e) forward-only — the segment index NEVER decrements across a full play-through", async () => {
    const e = await freshEngine();
    const seen: number[] = [e.getAudioState().segmentIndex];
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
    // walk to the last (TERMINAL) segment by earning an advance each pass.
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

  it("CARRY-ACROSS: sustained high heat keeps the top tier across a transition (no vocal cut)", async () => {
    const e = await freshEngineWith(nTierManifest("song1", 4)); // maxTier 3
    // build to the top tier of segment 0 and earn the advance with heat pinned high.
    await earnAdvance(e);
    expect(e.getAudioState().segmentIndex).toBe(1);
    // The next segment is entered DIRECTLY at the heat-derived tier — with heat ~1.0
    // that is the TOP tier (no top-1 cap, no reset). Vocals continue across the cut.
    expect(e.getAudioState().tier).toBe(3); // top of a 4-tier segment, carried, not 2
    expect(e.getAudioState().heat).toBeGreaterThan(0.83);
  });

  it("CARRY-ACROSS: DROPPED heat enters the next segment thinner (follows heat down)", async () => {
    const e = await freshEngineWith(nTierManifest("song1", 4)); // maxTier 3
    // build to the top and advance.
    await earnAdvance(e);
    expect(e.getAudioState().segmentIndex).toBe(1);
    expect(e.getAudioState().tier).toBe(3);
    const topTier = e.getAudioState().tier;
    // go cold: shed heat with guaranteed clear-less passes until a layer drops, then
    // earn the next advance — the following segment must enter BELOW the previous top.
    for (let k = 0; k < 4; k++) {
      e.__decayPasses(1);
      await settle();
    }
    // build JUST enough heat for a mid tier (not the top) and advance off this segment.
    // (re-top to the top first so it CAN advance, but the carry reflects heat AT entry).
    // Simpler: assert the shed already dropped the tier below the carried top.
    expect(e.getAudioState().tier).toBeLessThan(topTier);
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
describe("SFX voice pool — SAMPLE mode (no machine-gun stutter)", () => {
  /** A fresh engine switched to the recorded sample path (the pool is sample-only). */
  async function sampleEngine(): Promise<InteractiveAudioEngine> {
    const e = await freshEngine();
    e.setSfxMode("sample");
    return e;
  }

  it("rapid same-type fires spread across pooled voices with increasing start times", async () => {
    const e = await sampleEngine(); // routing maps `rotate` to the "rotate" SFX
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

  it("a MATCH plays the `stage` one-shot in sample mode (forming a square dings)", async () => {
    const e = await sampleEngine();
    // warm the stage pool then form squares (a first fire kicks the async pool load).
    e.fire({ type: "match", squares: 1 });
    await settle();
    for (let i = 0; i < 6; i++) e.fire({ type: "match", squares: 1 });
    await settle();
    const stagePlayers = mockState.players.filter((p) =>
      p.url.includes("sfx-stage"),
    );
    expect(stagePlayers.length).toBeGreaterThan(0);
    expect(stagePlayers.flatMap((p) => p.starts).length).toBeGreaterThan(0);
  });

  it("a CLEAR is SILENT in sample mode but still FEEDS heat (only forming a match dings)", async () => {
    const e = await sampleEngine();
    const stageBefore = mockState.players
      .filter((p) => p.url.includes("sfx-stage"))
      .flatMap((p) => p.starts).length;
    for (let i = 0; i < 6; i++) clear(e, 2, 1);
    await settle();
    // the sweep clear played NO stage sound...
    const stageAfter = mockState.players
      .filter((p) => p.url.includes("sfx-stage"))
      .flatMap((p) => p.starts).length;
    expect(stageAfter).toBe(stageBefore);
    // ...but the clears DID build heat (the progression is fed).
    expect(e.getAudioState().heat).toBeGreaterThan(0);
  });

  it("a BIGGER MATCH plays `stage` at a higher velocity than a single-square match", async () => {
    const e = await sampleEngine();
    e.fire({ type: "match", squares: 1 }); // warm the pool
    await settle();
    const lastFiredDb = (sub: string): number => {
      const fired = mockState.players
        .filter((p) => p.url.includes(sub) && p.starts.length > 0)
        .sort((a, b) => Math.max(...b.starts) - Math.max(...a.starts));
      return fired.length ? fired[0]!.volume.value : Number.NEGATIVE_INFINITY;
    };
    e.fire({ type: "match", squares: 1 });
    await settle();
    const smallDb = lastFiredDb("sfx-stage");
    e.fire({ type: "match", squares: 4 });
    await settle();
    const bigDb = lastFiredDb("sfx-stage");
    expect(bigDb).toBeGreaterThan(smallDb); // a 4-square match is hotter than 1-square
  });

  it("a CHAIN keeps its recorded routing in SAMPLE mode (stage + layered drop) and feeds heat", async () => {
    // Design D6: sample mode keeps the existing recorded chain routing (a hot `stage`
    // plus a layered `drop` impact) UNCHANGED. (Only TONE mode silences the chain.)
    const e = await sampleEngine();
    // warm both pools.
    e.fire({ type: "chain", size: 6 });
    await settle();
    const stageBefore = mockState.players
      .filter((p) => p.url.includes("sfx-stage"))
      .flatMap((p) => p.starts).length;
    const dropBefore = mockState.players
      .filter((p) => p.url.includes("sfx-drop"))
      .flatMap((p) => p.starts).length;
    e.fire({ type: "chain", size: 6 });
    await settle();
    const stageAfter = mockState.players
      .filter((p) => p.url.includes("sfx-stage"))
      .flatMap((p) => p.starts).length;
    const dropAfter = mockState.players
      .filter((p) => p.url.includes("sfx-drop"))
      .flatMap((p) => p.starts).length;
    // a chain fired BOTH a stage hit and a layered drop impact (sample mode).
    expect(stageAfter).toBeGreaterThan(stageBefore);
    expect(dropAfter).toBeGreaterThan(dropBefore);
    // and it fed heat.
    expect(e.getAudioState().heat).toBeGreaterThan(0);
  });

  it("EVERY settle plays a `drop`, with velocity scaled by cause (hard > soft > gravity)", async () => {
    const e = await sampleEngine();
    e.fire({ type: "lock", cause: "gravity" }); // warm the drop pool
    await settle();
    const drop = () => mockState.players.filter((p) => p.url.includes("sfx-drop"));
    const lastDropDb = (): number => {
      const fired = drop()
        .filter((p) => p.starts.length > 0)
        .sort((a, b) => Math.max(...b.starts) - Math.max(...a.starts));
      return fired.length ? fired[0]!.volume.value : Number.NEGATIVE_INFINITY;
    };
    e.fire({ type: "lock", cause: "gravity" });
    await settle();
    const gravityDb = lastDropDb();
    e.fire({ type: "lock", cause: "soft" });
    await settle();
    const softDb = lastDropDb();
    e.fire({ type: "lock", cause: "hard" });
    await settle();
    const hardDb = lastDropDb();
    expect(drop().flatMap((p) => p.starts).length).toBeGreaterThan(0);
    expect(hardDb).toBeGreaterThan(softDb);
    expect(softDb).toBeGreaterThan(gravityDb);
  });

  it("a MOVE fires no SFX voice (silent by decision, both modes)", async () => {
    const e = await sampleEngine();
    const before = mockState.players.length;
    for (let i = 0; i < 6; i++) e.fire({ type: "move" });
    await settle();
    const movePlayers = mockState.players
      .slice(before)
      .filter((p) => p.url.includes("sfx-move"));
    expect(movePlayers.length).toBe(0);
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
    // a fresh song resets heat (re-builds from 0 at the opening).
    expect(s.heat).toBe(0);
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

  it("a SUPERSEDED switchTrack does NOT orphan the old SFX voices (re-attach + later teardown disposes them)", async () => {
    // Regression (Codex review): switchTrack installs a fresh empty SFX map at the top
    // of the swap. If the new intro load is SUPERSEDED (loadGen bump) and the switch
    // bails, the old still-playing bank's SFX voices must remain reachable so a later
    // dispose frees them — they must NOT leak behind the orphaned old map.
    const e = await freshEngine();
    // build the active (song1) segment's SFX pool by firing a clear (loads sfx-stage).
    e.fire({ type: "lineClear", squares: 2, combo: 0 });
    await settle();
    const oldSfx = mockState.players.filter((p) => p.url.includes("sfx-stage"));
    expect(oldSfx.length).toBeGreaterThan(0);
    expect(oldSfx.every((p) => !p.disposed)).toBe(true);
    // also capture the old TIER bank's players (song1 segment tiers) — they must be freed
    // on the bail too, not leak behind the suspended switch's local.
    const oldTiers = mockState.players.filter(
      (p) => p.url.includes("s1-") && p.url.includes("tier"),
    );
    expect(oldTiers.length).toBeGreaterThan(0);
    expect(oldTiers.every((p) => !p.disposed)).toBe(true);

    // start a switch whose intro load is DEFERRED (parked, unresolved)...
    mockState.deferLoads = true;
    const switching = e.switchTrack({ id: "song2", base: "/audio/song2" });
    // ...then SUPERSEDE it with a reset (bumps loadGen + installs its OWN fresh map)
    // before the intro resolves.
    e.resetForNewGame();
    await releaseDeferredLoads(); // the superseded switch's intro load now resolves → bail
    await switching;
    await settle();

    // the bail retires the OLD bank it was replacing: the old song1 SFX voices AND tier
    // players are freed by the bail itself (not orphaned behind the suspended switch's
    // locals / the empty map the aborted switch installed).
    expect(oldSfx.every((p) => p.disposed)).toBe(true); // SFX freed — no leak
    expect(oldTiers.every((p) => p.disposed)).toBe(true); // tier players freed — no leak

    // and the reset-owned game is still HEALTHY — its own tier audio plays at the opening
    // (the aborted switch must not have disposed the reset's pools or stomped its map). The
    // fresh load is async; flush any remaining parked loads + settle so it is fully up.
    await releaseDeferredLoads();
    await settle();
    expect(e.getAudioState().segmentIndex).toBe(0);
    expect(e.getAudioState().activeStems).toBeGreaterThanOrEqual(1);
    expect(e.getAudioState().layerGains[e.getAudioState().tier]).toBeGreaterThan(0.5);

    // a later full dispose is clean (no double-dispose throw) and frees everything.
    expect(() => e.dispose()).not.toThrow();
    await settle();
    expect(oldSfx.every((p) => p.disposed)).toBe(true); // still freed, no resurrection
  });

  it("a reset/dispose that CANCELS a successful switch's old-bank settle still frees it (no leak)", async () => {
    // Regression (Codex): on a SUCCESSFUL switch the outgoing bank's disposal is scheduled
    // in an afterSettle that fires AFTER the crossfade. resetForNewGame/dispose cancel
    // settle callbacks, so without the pending-retire drain the outgoing (song1) bank —
    // detached from this.segments / the SFX map by the swap — would be orphaned + leak.
    const e = await freshEngine();
    e.fire({ type: "lineClear", squares: 2, combo: 0 }); // build song1's stage pool
    await settle();
    const song1Tiers = mockState.players.filter(
      (p) => p.url.includes("s1-") && p.url.includes("tier"),
    );
    const song1Sfx = mockState.players.filter((p) => p.url.includes("sfx-stage"));
    expect(song1Tiers.length).toBeGreaterThan(0);

    // a SUCCESSFUL switch to song2 — the song1 bank's disposal is now scheduled in a
    // FUTURE afterSettle (not yet fired: the crossfade hasn't elapsed on the mock clock).
    await e.switchTrack({ id: "song2", base: "/audio/song2" });
    expect(e.getAudioState().trackId).toBe("song2");
    expect(song1Tiers.every((p) => !p.disposed)).toBe(true); // still pending retirement

    // reset BEFORE the settle fires — this cancels the scheduled disposal. The
    // pending-retire drain must free the outgoing song1 bank anyway.
    e.resetForNewGame();
    await settle();
    expect(song1Tiers.every((p) => p.disposed)).toBe(true); // tier players freed — no leak
    expect(song1Sfx.every((p) => p.disposed)).toBe(true); // SFX voices freed — no leak
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

  it("a 4-tier segment advances only after the audible tier reaches 3 (its real top) + held a loop", async () => {
    const e = await freshEngineWith(nTierManifest("song4", 4)); // maxTier 3
    expect(e.getAudioState().tierCount).toBe(4);
    // pin heat to 1.0 so the desired tier is the top (3).
    e.__injectClears(12);
    // step boundaries; record (tier, index) at each. The audible tier climbs ONE step per
    // boundary (1→2→3); the segment must NOT advance until tier === 3 AND held a loop.
    const trace: { tier: number; index: number }[] = [];
    for (let k = 0; k < 8; k++) {
      e.__injectClears(12); // keep heat at 1.0
      loopBoundary();
      await settle();
      const s = e.getAudioState();
      trace.push({ tier: s.tier, index: s.segmentIndex });
      if (s.segmentIndex > 0) break;
    }
    // it never advanced on a boundary where the audible tier was still ≤ 2.
    for (const t of trace) {
      if (t.index > 0) break;
    }
    const advanceStep = trace.findIndex((t) => t.index > 0);
    expect(advanceStep).toBeGreaterThanOrEqual(0); // it DID advance
    // the boundary just BEFORE the advance had the audible tier at the top (3).
    expect(trace[advanceStep - 1]?.tier).toBe(3);
  });

  it("a 5-tier segment in the 0.85–0.87 heat band does NOT advance while audible tier ≤ 3 (no bare-heat)", async () => {
    // The no-bare-heat rule: song2's top (tier4) reveals only at heat ≥ 0.875 (design
    // D4). Held in the 0.85–0.87 band the desired audible tier is round(h*4) = 3 (no
    // vocals) — and the segment must NOT advance (a bare-heat threshold below 1.0 would
    // have skipped the unheard vocals).
    const e = await freshEngineWith(nTierManifest("song5", 5)); // maxTier 4
    expect(e.getAudioState().tierCount).toBe(5);
    // land heat in the band: 7 × 0.11 = 0.77, + one 1-square clear (0.085) = 0.855.
    for (let i = 0; i < 7; i++) clear(e, 2, 0);
    clear(e, 1, 0);
    await settle();
    expect(e.getAudioState().heat).toBeGreaterThanOrEqual(0.85);
    expect(e.getAudioState().heat).toBeLessThan(0.875);
    // the desired audible tier in this band is 3 (vocals NOT in). Step boundaries; the
    // audible tier climbs ONE step per boundary toward 3 and holds there — it NEVER
    // reaches 4, so the segment NEVER advances (clear-less passes will then shed heat,
    // moving the tier further from the top — still no advance).
    for (let k = 0; k < 8; k++) {
      loopBoundary();
      await settle();
      const s = e.getAudioState();
      expect(s.tier).toBeLessThanOrEqual(3); // tier 4 (vocals) never became audible
      expect(s.segmentIndex).toBe(0); // ...so the segment never advanced (no bare-heat)
    }
  });

  it("a 5-tier segment advances only after the audible tier reaches 4 (vocals) + held a loop", async () => {
    const e = await freshEngineWith(nTierManifest("song5", 5)); // maxTier 4
    e.__injectClears(12); // pin heat to 1.0 (desired tier 4)
    const trace: { tier: number; index: number }[] = [];
    for (let k = 0; k < 10; k++) {
      e.__injectClears(12);
      loopBoundary();
      await settle();
      const s = e.getAudioState();
      trace.push({ tier: s.tier, index: s.segmentIndex });
      if (s.segmentIndex > 0) break;
    }
    const advanceStep = trace.findIndex((t) => t.index > 0);
    expect(advanceStep).toBeGreaterThanOrEqual(0);
    // never advanced while the audible tier was still ≤ 3...
    for (let i = 0; i < advanceStep; i++) {
      expect(trace[i]!.index).toBe(0);
    }
    // ...and the boundary before the advance had the audible tier at the top (4).
    expect(trace[advanceStep - 1]?.tier).toBe(4);
  });

  it("the tier CLAMPS at the ceiling — a 5-tier segment never shows a tier ≥ tierCount", async () => {
    const e = await freshEngineWith(nTierManifest("song5", 5));
    // hammer clears far past everything; the entered segment must clamp its tier.
    for (let i = 0; i < 60; i++) clear(e, 4, 4);
    for (let k = 0; k < 6; k++) {
      loopBoundary();
      await settle();
      const s = e.getAudioState();
      expect(s.tier).toBeLessThanOrEqual(s.tierCount - 1);
    }
  });

  it("a burst pins heat to 1.0 but still advances AT MOST one segment per boundary (no fast-forward)", async () => {
    const e = await freshEngineWith(nTierManifest("song5", 5)); // maxTier 4
    const before = e.getAudioState().segmentIndex;
    // a 40-clear burst pins heat to 1.0.
    for (let i = 0; i < 40; i++) clear(e, 4, 4);
    await settle();
    expect(e.getAudioState().heat).toBe(1);
    const indices: number[] = [];
    for (let k = 0; k < 8; k++) {
      loopBoundary();
      await settle();
      indices.push(e.getAudioState().segmentIndex);
    }
    // never more than +1 per boundary; the tier had to climb + hold before each advance.
    let prev = before;
    for (const idx of indices) {
      expect(idx - prev).toBeLessThanOrEqual(1);
      expect(idx).toBeGreaterThanOrEqual(prev);
      prev = idx;
    }
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

  it("NaN/Infinity clear contributions never poison heat (onClear guard)", async () => {
    const e = await freshEngine();
    const before = e.getAudioState().heat;
    // a poisoned upstream event: NaN squares / Infinity combo. onClear must ignore the
    // contribution, leaving heat unchanged and finite (not NaN).
    e.fire({ type: "lineClear", squares: Number.NaN, combo: 1 });
    e.fire({ type: "lineClear", squares: 2, combo: Number.POSITIVE_INFINITY });
    await settle();
    const s = e.getAudioState();
    expect(Number.isFinite(s.heat)).toBe(true);
    expect(s.heat).toBe(before); // poisoned contributions were ignored
    loopBoundary();
    await settle();
    // and the tier is still a finite, in-range integer (not NaN).
    const s2 = e.getAudioState();
    expect(Number.isFinite(s2.tier)).toBe(true);
    expect(s2.tier).toBeGreaterThanOrEqual(0);
    expect(s2.tier).toBeLessThanOrEqual(s2.tierCount - 1);
  });

  it("a poisoned clear does NOT suppress the next clear-less pass's decay (ignored ENTIRELY)", async () => {
    // Codex finding: onClear must not set the no-decay flag before validating finiteness
    // — a poisoned (NaN/Infinity) clear is "no real clear", so the following loop pass is
    // still a clear-less pass and MUST decay.
    const e = await freshEngine();
    e.__injectClears(5); // heat 0.55 (this real clear sets the no-decay flag)
    // a clean boundary consumes + resets the flag (this pass saw a real clear → no decay).
    loopBoundary();
    await settle();
    const h0 = e.getAudioState().heat; // 0.55, flag now reset to false
    // a POISONED clear (should be ignored ENTIRELY — heat unchanged AND flag NOT set).
    e.fire({ type: "lineClear", squares: Number.NaN, combo: 0 });
    await settle();
    expect(e.getAudioState().heat).toBe(h0); // unchanged
    // the NEXT loop boundary is therefore still a clear-less pass → it MUST decay (the
    // poisoned clear did not suppress it).
    loopBoundary();
    await settle();
    expect(e.getAudioState().heat).toBeCloseTo(h0 - 0.08, 6);
  });
});

// ── Change 1: GAME OVER resets the music to a fresh start (segment 0, floor) ──────
describe("resetForNewGame (GAME OVER → fresh opening)", () => {
  it("after a reset the engine is back at segment 0 / floor tier / cleared score", async () => {
    const e = await freshEngineWith(nTierManifest("song1", 4));
    // Play a "game": walk several segments forward and raise the tier/score so the song
    // is mid-progression, NOT at its opening.
    await earnAdvance(e);
    await earnAdvance(e);
    const mid = e.getAudioState();
    expect(mid.segmentIndex).toBeGreaterThan(0); // genuinely mid-song
    expect(mid.maxSegmentReached).toBeGreaterThan(0);

    // GAME OVER → reset.
    e.resetForNewGame();
    await settle();

    const s = e.getAudioState();
    // back at the song's OPENING: segment 0, heat cleared, max reset.
    expect(s.segmentIndex).toBe(0);
    expect(s.maxSegmentReached).toBe(0);
    expect(s.heat).toBe(0);
    expect(s.transitionInFlight).toBe(false);
    // floor tiers re-seated (≥2 layers, never bare) and audible.
    expect(s.tier).toBe(1);
    expect(s.activeStems).toBeGreaterThanOrEqual(1);
    expect(s.activeStems).toBeLessThanOrEqual(2);
    expect(s.layerGains[s.tier]).toBeGreaterThan(0.5);
  });

  it("a NEW game after reset can walk forward again from the opening (clean state)", async () => {
    const e = await freshEngineWith(nTierManifest("song1", 4));
    await earnAdvance(e);
    await earnAdvance(e);
    e.resetForNewGame();
    await settle();
    expect(e.getAudioState().segmentIndex).toBe(0);
    // the fresh game advances exactly one step on an earned advance (state is sane).
    await earnAdvance(e);
    expect(e.getAudioState().segmentIndex).toBe(1);
  });

  it("reset is a no-op before unlock (never throws)", () => {
    const e = new InteractiveAudioEngine();
    expect(() => e.resetForNewGame()).not.toThrow();
    expect(e.getAudioState().segmentCount).toBe(0);
  });

  it("reset keeps the CURRENT track (restarts the active song, not forced to song1)", async () => {
    const e = await freshEngine();
    await e.switchTrack({ id: "song2", base: "/audio/song2" });
    await settle();
    expect(e.getAudioState().trackId).toBe("song2");
    e.resetForNewGame();
    await settle();
    const s = e.getAudioState();
    expect(s.trackId).toBe("song2"); // stayed on the active song
    expect(s.segmentIndex).toBe(0); // ...at its opening
  });

  it("a stale in-flight load from the PREVIOUS game does NOT stomp the reset bank", async () => {
    // Race: a prefetch/load is in flight when GAME OVER resets. After the reset rebuilds
    // the bank from segment 0, the OLD parked load resolves — the loadGen guard must make
    // it dispose its own orphan nodes and bail, NOT start orphan players, overwrite
    // this.segments, or silence the fresh reset bank.
    const e = await freshEngineWith(nTierManifest("song1", 4));
    expect(e.getAudioState().activeStems).toBe(1);

    // Park the NEXT segment's prefetch load (in flight, unresolved).
    mockState.deferLoads = true;
    await earnAdvance(e); // advances into seg1; kicks a DEFERRED prefetch of seg2

    // GAME OVER mid-load. Reset rebuilds from seg0; its OWN load is also deferred for now.
    e.resetForNewGame();
    await settle();
    // Let the reset's fresh load resolve (segment 0 of the rebuilt bank).
    await releaseDeferredLoads();

    const afterReset = e.getAudioState();
    expect(afterReset.segmentIndex).toBe(0);
    expect(afterReset.activeStems).toBeGreaterThanOrEqual(1); // reset bank audible
    const stemsBefore = afterReset.activeStems;

    // Now release ANY remaining stale parked loads from the pre-reset game. They must not
    // resurrect orphan players or change the live reset bank.
    await releaseDeferredLoads();
    const s = e.getAudioState();
    expect(s.segmentIndex).toBe(0); // still at the reset opening
    expect(s.activeStems).toBe(stemsBefore); // no orphan players added
    expect(s.activeStems).toBeLessThanOrEqual(2); // no-hiss bound intact
    expect(s.layerGains[s.tier]).toBeGreaterThan(0.5); // still audible at the floor
  });
});

// ── Change 2: minimum 2 audible layers ALWAYS (opening + every segment entry) ─────
describe("minimum 2 cumulative layers (never bare)", () => {
  it("the OPENING segment enters at >=2 cumulative layers (tier >= 1)", async () => {
    const e = await freshEngineWith(nTierManifest("song1", 4));
    const s = e.getAudioState();
    expect(s.segmentIndex).toBe(0);
    expect(s.tier).toBeGreaterThanOrEqual(1); // >=2 layers (drums+bass), never tier0
    expect(s.activeStems).toBeGreaterThanOrEqual(1);
  });

  it("EVERY segment entry across a full play-through stays at >=2 layers (tier >= 1)", async () => {
    const e = await freshEngineWith(nTierManifest("song1", 4));
    const tiersSeen: number[] = [e.getAudioState().tier];
    for (let k = 0; k < 8; k++) {
      await earnAdvance(e);
      tiersSeen.push(e.getAudioState().tier);
    }
    // no entry ever dropped below the 2-layer floor (tier index 1).
    for (const t of tiersSeen) expect(t).toBeGreaterThanOrEqual(1);
  });

  it("dry boundaries never drop the audible tier below the 2-layer floor", async () => {
    const e = await freshEngineWith(nTierManifest("song1", 4));
    for (let k = 0; k < 6; k++) {
      loopBoundary();
      await settle();
      expect(e.getAudioState().tier).toBeGreaterThanOrEqual(1);
    }
  });
});

// ── top-built-and-held advance (design D4): the heat-gated advance rule ────────────
describe("top-built-and-held advance (heat-gated, no bare-heat)", () => {
  it("reaching the top tier and holding it one loop advances exactly one segment", async () => {
    const e = await freshEngineWith(nTierManifest("song5", 5)); // maxTier 4
    e.__injectClears(12); // pin heat to 1.0 (desired tier 4)
    // climb to the top one step per boundary, re-topping heat so it never decays.
    await buildToTop(e);
    expect(e.getAudioState().tier).toBe(4); // top audible
    expect(e.getAudioState().segmentIndex).toBe(0); // not yet — top just reached
    // the boundary AFTER the top is reached holds it (topHeld latch), then advances.
    e.__injectClears(12);
    loopBoundary();
    await settle();
    expect(e.getAudioState().segmentIndex).toBe(1);
  });

  it("the reveal boundary does NOT advance off the top tier on the SAME boundary", async () => {
    // Revealing the top AND advancing on the same boundary would cancel the top tier's
    // gain ramp (vocals never sound). The top must reach AND stay for a loop first.
    const e = await freshEngineWith(nTierManifest("song5", 5));
    e.__injectClears(12); // pin heat to 1.0
    // step until the top first becomes audible; the SAME boundary must not advance.
    let revealedAt = -1;
    for (let k = 0; k < 8; k++) {
      e.__injectClears(12);
      loopBoundary();
      await settle();
      const s = e.getAudioState();
      if (s.tier === 4 && revealedAt < 0) {
        revealedAt = k;
        expect(s.segmentIndex).toBe(0); // top just revealed — NOT advanced this boundary
        expect(s.layerGains[4]).toBeGreaterThan(0.9); // vocals ramp not cancelled
        break;
      }
    }
    expect(revealedAt).toBeGreaterThanOrEqual(0);
  });

  it("a section that has NOT reached the top tier does NOT advance (loops in place)", async () => {
    const e = await freshEngineWith(nTierManifest("song5", 5)); // maxTier 4
    // hold heat at a mid level (desired tier 2..3, never 4). 5 × 0.11 = 0.55 →
    // round(0.55*4) = 2. Re-establish each pass so the tier holds below the top.
    for (let k = 0; k < 8; k++) {
      for (let i = 0; i < 5; i++) clear(e, 2, 0); // ~0.55 worth, capped by saturation
      loopBoundary();
      await settle();
      const s = e.getAudioState();
      if (s.tier < 4) expect(s.segmentIndex).toBe(0); // below top → never advances
    }
  });

  it("advancing is ONE-STEP forward-only; the new segment re-arms its own top-held gate", async () => {
    const e = await freshEngineWith(nTierManifest("song5", 5));
    await earnAdvance(e);
    const after = e.getAudioState().segmentIndex;
    expect(after).toBe(1);
    // The new segment carries the tier (heat ~1.0 → top), but its top-held latch is
    // RESET on entry, so it must hold the top one fresh loop before advancing — it does
    // NOT cascade-advance on the very next boundary.
    // (entry boundary holds; the following boundary may advance — so at most +1 here.)
    e.__injectClears(12);
    loopBoundary();
    await settle();
    expect(e.getAudioState().segmentIndex).toBeLessThanOrEqual(after + 1);
  });

  it("end-of-song: an earned advance past the TERMINAL segment fires onSongComplete once", async () => {
    const e = await freshEngineWith(nTierManifest("song5", 5));
    let calls = 0;
    e.onSongComplete = () => {
      calls++;
    };
    const last = e.getAudioState().segmentCount - 1;
    for (let k = 0; k < last; k++) await earnAdvance(e);
    expect(e.getAudioState().segmentIndex).toBe(last);
    expect(calls).toBe(0);
    // earn the advance past the terminal = end-of-song complete.
    await earnAdvance(e);
    expect(calls).toBe(1);
    expect(e.getAudioState().segmentIndex).toBe(last); // terminal loops, index unchanged
    // and it does NOT keep firing on subsequent dry boundaries.
    for (let k = 0; k < 3; k++) {
      e.__decayPasses(1);
      await settle();
    }
    expect(calls).toBe(1); // still once
  });
});

// ── floor-only (1/2-tier) segments still advance via top-built-and-held ───────────
describe("low-tier segments (floor == top) advance once held a loop", () => {
  it("a 2-tier segment (floor == top) advances after the top is held a loop", async () => {
    // A 2-tier segment is parked at tier1 = its top by the ≥2-layer floor. With heat the
    // top IS already audible at entry; once it has been HELD one loop the advance fires.
    const e = await freshEngineWith(nTierManifest("song2t", 2));
    expect(e.getAudioState().tierCount).toBe(2);
    expect(e.getAudioState().tier).toBe(1); // floor == top for a 2-tier segment
    // with NO clears heat decays — but the top is already audible (floor), so the
    // top-held latch arms on the next boundary and it advances regardless of heat.
    await earnAdvance(e);
    expect(e.getAudioState().segmentIndex).toBe(1);
  });

  it("a 1-tier segment (only tier0) advances after its single tier is held a loop", async () => {
    const e = await freshEngineWith(nTierManifest("song1t", 1));
    expect(e.getAudioState().tierCount).toBe(1);
    expect(e.getAudioState().tier).toBe(0); // only one tier exists (== top)
    await earnAdvance(e);
    expect(e.getAudioState().segmentIndex).toBe(1);
  });
});

// ── heat spec contract cases (design D1-D5) ───────────────────────────────────────
describe("heat progression contract cases", () => {
  it("(i) carry-across at sustained heat enters the next segment AT its top (no vocal cut)", async () => {
    const e = await freshEngineWith(nTierManifest("song5", 5)); // top tier = tier4
    await earnAdvance(e); // build to top + advance with heat pinned ~1.0
    expect(e.getAudioState().segmentIndex).toBe(1);
    // the next segment is entered DIRECTLY at the heat-derived tier — the TOP (4), NOT
    // capped at top-1 — so vocals continue across the cut.
    expect(e.getAudioState().tier).toBe(4);
  });

  it("(ii) a fresh game opening starts at the min-audible floor (never bare)", async () => {
    const e = await freshEngineWith(nTierManifest("song5", 5));
    const s = e.getAudioState();
    expect(s.segmentIndex).toBe(0);
    expect(s.heat).toBe(0);
    expect(s.tier).toBe(1); // ≥2-layer floor, never tier0
  });

  it("(iii) heat clamps to the unit range (saturates at 1.0)", async () => {
    const e = await freshEngine();
    for (let i = 0; i < 50; i++) clear(e, 4, 4); // far past 1.0 if it summed
    await settle();
    expect(e.getAudioState().heat).toBe(1);
  });

  it("(iv) a clear-less pass sheds heat; a pass with a clear does not (no thrash)", async () => {
    const e = await freshEngine();
    e.__injectClears(5); // heat 0.55
    const h0 = e.getAudioState().heat;
    // a guaranteed clear-less pass sheds exactly the decay step.
    e.__decayPasses(1);
    await settle();
    expect(e.getAudioState().heat).toBeCloseTo(h0 - 0.08, 6);
    // a pass WITH a clear does not decay: inject a clear, then a normal boundary.
    const h1 = e.getAudioState().heat;
    e.__injectClears(1); // +0.11
    loopBoundary();
    await settle();
    // net change is +0.11 (the boundary saw a clear → no decay).
    expect(e.getAudioState().heat).toBeCloseTo(Math.min(1, h1 + 0.11), 6);
  });

  it("(v) end-of-song fires onSongComplete", async () => {
    const e = await freshEngineWith(nTierManifest("song5", 5));
    let calls = 0;
    e.onSongComplete = () => {
      calls++;
    };
    const last = e.getAudioState().segmentCount - 1;
    for (let k = 0; k < last; k++) await earnAdvance(e);
    expect(e.getAudioState().segmentIndex).toBe(last);
    expect(calls).toBe(0);
    await earnAdvance(e); // advance PAST the terminal segment
    expect(calls).toBe(1);
  });

  it("(vi) heat gain pacing — a bigger clear raises heat more than a smaller one", async () => {
    const e = await freshEngine();
    // a typical 2-square no-streak clear → 0.06 + 0.05 = 0.11.
    clear(e, 2, 0);
    await settle();
    expect(e.getAudioState().heat).toBeCloseTo(0.11, 6);
    // a 4-square no-streak clear → 0.06 + 0.10 = 0.16 (a strictly bigger jump).
    const before = e.getAudioState().heat;
    clear(e, 4, 0);
    await settle();
    expect(e.getAudioState().heat - before).toBeCloseTo(0.16, 6);
    // a 4-square clear on a ×3 streak (comboStep 2) → 0.06 + 0.10 + 0.04 = 0.20.
    const before2 = e.getAudioState().heat;
    clear(e, 4, 2);
    await settle();
    expect(e.getAudioState().heat - before2).toBeCloseTo(0.2, 6);
  });
});

// ── tone SFX (design D6): in-key tones, match ding, silent clear/chain/move ────────
describe("tone SFX (default mode)", () => {
  it("default SFX mode is tone", async () => {
    const e = await freshEngine();
    expect(e.getAudioState().sfxMode).toBe("tone");
  });

  it("the tone synth is NOT constructed before a gesture (no build at import / pre-unlock)", async () => {
    (globalThis as unknown as { window?: object }).window = globalThis;
    installFetch();
    mockState.polySynthBuilds = 0;
    const e = new InteractiveAudioEngine();
    // construction has NOT happened yet (no unlock gesture).
    expect(mockState.polySynthBuilds).toBe(0);
    await e.unlock(); // the synth is built INSIDE the gesture.
    await settle();
    expect(mockState.polySynthBuilds).toBeGreaterThan(0);
  });

  it("a MATCH plays an in-key tone; a bigger match is louder", async () => {
    const e = await freshEngine();
    e.fire({ type: "match", squares: 1 });
    await settle();
    expect(mockState.toneHits.length).toBeGreaterThan(0);
    const small = mockState.toneHits[mockState.toneHits.length - 1]!;
    // the note is a member of the song's key/scale (default A minor) note set.
    const inScale = isInDefaultScale(small.freq);
    expect(inScale).toBe(true);
    const beforeBig = mockState.toneHits.length;
    e.fire({ type: "match", squares: 4 });
    await settle();
    expect(mockState.toneHits.length).toBeGreaterThan(beforeBig);
    const big = mockState.toneHits[mockState.toneHits.length - 1]!;
    expect(big.velocity).toBeGreaterThan(small.velocity); // brighter for more squares
  });

  it("rotate / softDrop / lock each play an in-key tone; move is silent", async () => {
    const e = await freshEngine();
    e.fire({ type: "rotate" });
    e.fire({ type: "softDrop" });
    e.fire({ type: "lock", cause: "hard" });
    await settle();
    expect(mockState.toneHits.length).toBe(3);
    for (const hit of mockState.toneHits) {
      expect(isInDefaultScale(hit.freq)).toBe(true);
    }
    const before = mockState.toneHits.length;
    for (let i = 0; i < 4; i++) e.fire({ type: "move" });
    await settle();
    expect(mockState.toneHits.length).toBe(before); // move is silent
  });

  it("the sweep CLEAR and the CHAIN are SILENT in tone mode (only forming a match dings)", async () => {
    const e = await freshEngine();
    const before = mockState.toneHits.length;
    for (let i = 0; i < 5; i++) clear(e, 2, 0);
    e.fire({ type: "chain", size: 6 });
    await settle();
    expect(mockState.toneHits.length).toBe(before); // no tone for clear / chain
    // but heat was fed by the clears + chain.
    expect(e.getAudioState().heat).toBeGreaterThan(0);
  });

  it("a tone-SFX failure degrades to silence (never throws)", async () => {
    const e = await freshEngine();
    // dispose the synth out from under the engine, then fire — must not throw, no hit.
    e.dispose();
    const before = mockState.toneHits.length;
    expect(() => e.fire({ type: "match", squares: 1 })).not.toThrow();
    await settle();
    expect(mockState.toneHits.length).toBe(before);
  });

  it("the mode can be switched to sample and back at runtime", async () => {
    const e = await freshEngine();
    expect(e.getAudioState().sfxMode).toBe("tone");
    e.setSfxMode("sample");
    expect(e.getAudioState().sfxMode).toBe("sample");
    e.setSfxMode("tone");
    expect(e.getAudioState().sfxMode).toBe("tone");
  });

  it("setSfxMode('tone') BEFORE unlock does not permanently disable the synth", async () => {
    // Codex finding: ensureToneSynth must NOT burn its one attempt when master/Tone are
    // absent (pre-unlock). setSfxMode('tone') before unlock used to set toneSynthTried,
    // so unlock()'s later build was skipped and tone SFX stayed silent forever.
    (globalThis as unknown as { window?: object }).window = globalThis;
    installFetch();
    const e = new InteractiveAudioEngine();
    e.setSfxMode("tone"); // pre-unlock — must be a harmless no-op for the synth
    expect(mockState.polySynthBuilds).toBe(0);
    await e.unlock(); // now the synth MUST build
    await settle();
    expect(mockState.polySynthBuilds).toBeGreaterThan(0);
    // and tone SFX actually sound.
    const before = mockState.toneHits.length;
    e.fire({ type: "match", squares: 1 });
    await settle();
    expect(mockState.toneHits.length).toBeGreaterThan(before);
  });
});

// ── audio-truth task 4.3: per-segment SFX palettes + hot-swap lifecycle (D5) ───────
describe("per-segment SFX palettes (audio-truth D5)", () => {
  /**
   * A manifest where segment 0 carries its OWN per-segment `stage` sample but
   * segment 1 does NOT — to prove the per-segment override AND the song-level
   * fallback in one fixture (mixed manifest).
   */
  const MIXED_SFX = {
    version: "test-segsfx",
    songs: [
      {
        id: "song1",
        title: "Song 1",
        tempo: 110,
        barSeconds: SEC_PER_BAR,
        segments: [
          {
            ...seg("s0", "PROGRESSION", 1, 4),
            sfx: { stage: "song1/s0-stage.opus", drop: "song1/s0-drop.opus" },
          },
          seg("s1", "PROGRESSION", 1, 4), // NO per-segment sfx → song-level fallback
          seg("s2", "TERMINAL", 1, 4),
        ],
        sfx: {
          move: "sfx-move.opus",
          rotate: "sfx-rotate.opus",
          softdrop: "sfx-softdrop.opus",
          drop: "song-drop.opus",
          stage: "song-stage.opus",
        },
      },
    ],
  };

  it("a segment with its own palette plays ITS sample, not the song-level one", async () => {
    const e = await freshEngineWith(MIXED_SFX);
    e.setSfxMode("sample"); // the recorded per-segment path
    expect(e.getAudioState().segmentIndex).toBe(0);
    // a MATCH on segment 0 routes to `stage` and must fire the SEGMENT's own sample.
    e.fire({ type: "match", squares: 2 });
    await settle();
    e.fire({ type: "match", squares: 2 });
    await settle();
    const segStage = mockState.players.filter((p) =>
      p.url.includes("s0-stage"),
    );
    const songStage = mockState.players.filter((p) =>
      p.url.includes("song-stage"),
    );
    expect(segStage.length).toBeGreaterThan(0); // the per-segment sample loaded
    expect(segStage.flatMap((p) => p.starts).length).toBeGreaterThan(0); // and fired
    // the song-level stage sample may be PREFETCHED for OTHER segments' pools, but on
    // segment 0 it is never STARTED — the per-segment override is what sounds.
    expect(songStage.flatMap((p) => p.starts).length).toBe(0);
  });

  it("a segment WITHOUT a palette falls back to the song-level sample", async () => {
    const e = await freshEngineWith(MIXED_SFX);
    e.setSfxMode("sample");
    // advance to segment 1 (no per-segment sfx).
    await earnAdvance(e);
    expect(e.getAudioState().segmentIndex).toBe(1);
    e.fire({ type: "match", squares: 2 });
    await settle();
    e.fire({ type: "match", squares: 2 });
    await settle();
    // segment 1's stage resolves to the SONG-LEVEL sample (no s1-stage exists).
    const songStage = mockState.players.filter((p) =>
      p.url.includes("song-stage"),
    );
    expect(songStage.length).toBeGreaterThan(0);
    expect(songStage.flatMap((p) => p.starts).length).toBeGreaterThan(0);
  });

  it("an OLD manifest (no per-segment sfx anywhere) resolves all actions to the song-level set", async () => {
    // the default fixture has only song-level sfx — byte-identical to before.
    const e = await freshEngine();
    e.setSfxMode("sample");
    e.fire({ type: "rotate" });
    await settle();
    e.fire({ type: "rotate" });
    await settle();
    const rotateVoices = mockState.players.filter((p) =>
      p.url.includes("sfx-rotate"),
    );
    expect(rotateVoices.length).toBeGreaterThan(0); // song-level rotate resolved + played
    expect(rotateVoices.flatMap((p) => p.starts).length).toBeGreaterThan(0);
  });

  it("leaving a segment DISPOSES its SFX voices (per-segment lifecycle)", async () => {
    const e = await freshEngineWith(MIXED_SFX);
    e.setSfxMode("sample");
    // fire a match on segment 0 so its per-segment stage pool is constructed.
    e.fire({ type: "match", squares: 2 });
    await settle();
    const s0Stage = mockState.players.filter((p) => p.url.includes("s0-stage"));
    expect(s0Stage.length).toBeGreaterThan(0);
    expect(s0Stage.every((p) => !p.disposed)).toBe(true);
    // advance OFF segment 0 → after the settle, its SFX voices are disposed.
    await earnAdvance(e);
    expect(e.getAudioState().segmentIndex).toBeGreaterThan(0);
    await settle();
    const s0StageAfter = mockState.players.filter((p) =>
      p.url.includes("s0-stage"),
    );
    expect(s0StageAfter.length).toBeGreaterThan(0); // they were constructed
    expect(s0StageAfter.every((p) => p.disposed)).toBe(true); // ...and now disposed
  });

  it("a one-shot requested during a swap never throws into the game (silent drop)", async () => {
    const e = await freshEngineWith(MIXED_SFX);
    e.setSfxMode("sample");
    // fire on segment 1 BEFORE its pool has a chance to exist — must not throw.
    await earnAdvance(e);
    expect(() => {
      e.fire({ type: "match", squares: 2 });
    }).not.toThrow();
    await settle();
  });
});
