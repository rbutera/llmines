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
 * Bank ENOUGH clear-progress to earn ONE advance, then fire the boundary(ies) that
 * commit it. Uses the engine's own test-only `__injectClears` so the banked weight
 * tracks the real ADVANCE_THRESHOLD without hard-coding a clear count (10 weight-4
 * clears = 40 ≥ the 30 gate, with headroom for the backlog cap).
 *
 * A burst from BELOW the top tier reveals the top tier on the FIRST boundary and (so the
 * vocals are actually heard) advances on the SECOND — the engine never reveals the top
 * and advances off it on the same boundary. So this steps boundaries until the index
 * moves (max a couple), committing exactly ONE advance. Asserts nothing — callers do.
 */
async function earnAdvance(e: InteractiveAudioEngine): Promise<void> {
  e.__injectClears(10); // 10 × weight-4 = 40, comfortably ≥ ADVANCE_THRESHOLD (30)
  const before = e.getAudioState().segmentIndex;
  for (let i = 0; i < 3; i++) {
    loopBoundary();
    await settle();
    if (e.getAudioState().segmentIndex !== before) return; // advanced (or song-completed)
    const s = e.getAudioState();
    if (s.segmentIndex === s.segmentCount - 1 && s.segmentScore === 0) return; // terminal: completed
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
    // 4-tier fixture so revealing tier2 stays BELOW the top tier (tier3) — this test
    // proves the in-place sticky reveal WITHOUT advancing, so the revealed tier must
    // not be the section's top (which would now mandatorily advance — see the
    // "full reveal forces advance" test).
    const e = await freshEngineWith(nTierManifest("song1", 4));
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
    // BOUNDARY 1: a burst from the entry floor reveals the TOP tier here (the burst maxes
    // it); the engine reveals the top + holds (it never advances off the top on the same
    // boundary it reveals it, so the full mix is heard).
    loopBoundary();
    await settle();
    expect(e.getAudioState().segmentIndex).toBe(0); // revealed top, not advanced yet
    // BOUNDARY 2: now it steps exactly one segment forward.
    loopBoundary();
    await settle();
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
    // BOUNDARY 1: the burst reveals the TOP tier from the entry floor; the engine holds
    // (no advance off the just-revealed top — full mix heard first).
    loopBoundary();
    await settle();
    expect(e.getAudioState().segmentIndex - before).toBe(0);
    // BOUNDARY 2: now exactly ONE advance, never a skip.
    loopBoundary();
    await settle();
    expect(e.getAudioState().segmentIndex - before).toBe(1);
    // and the burst did NOT pre-pay the next advance: the new segment starts at 0.
    expect(e.getAudioState().segmentScore).toBe(0);
    // a further boundary with no fresh clears must NOT advance again (would-be FF).
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

  it("the sticky FLOOR carries forward but is CAPPED below the new top (vocals re-earned)", async () => {
    const e = await freshEngine(); // 3-tier default fixture (top tier = tier2)
    // raise tier2 on segment 0, then advance.
    for (let i = 0; i < 3; i++) clear(e, 2, 1); // score 12 → arms tier2
    loopBoundary();
    await settle();
    expect(e.getAudioState().tier).toBe(2);
    // now earn the advance (clear-gate). The carried floor is CAPPED at top-1 (D3) so
    // the new segment does NOT enter at vocals — it re-earns the top via clears.
    await earnAdvance(e);
    expect(e.getAudioState().segmentIndex).toBe(1);
    // carried floor = min(reached, top-1) = min(2, 1) = 1: not reset to bare (tier0),
    // not carried all the way to the top (tier2) — vocals are re-earned per segment.
    expect(e.getAudioState().tier).toBe(1);
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

  it("a CLEAR plays the `stage` one-shot AND feeds clear-progress (B3 — no longer silent)", async () => {
    const e = await freshEngine();
    // warm the stage pool then clear (a first fire kicks the async pool load).
    e.fire({ type: "lineClear", squares: 2, combo: 1 });
    await settle();
    const before = mockState.players.length;
    for (let i = 0; i < 6; i++) clear(e, 2, 1);
    await settle();
    // the clear-stage one-shot fired (stage SFX players exist + got start()s).
    const stagePlayers = mockState.players.filter((p) =>
      p.url.includes("sfx-stage"),
    );
    expect(stagePlayers.length).toBeGreaterThan(0);
    const stageStarts = stagePlayers.flatMap((p) => p.starts);
    expect(stageStarts.length).toBeGreaterThan(0);
    // AND the clears still register as clear-progress (the progression is untouched).
    expect(e.getAudioState().segmentScore).toBeGreaterThan(0);
    void before;
  });

  it("a BIGGER clear plays `stage` at a higher velocity than a single-square clear", async () => {
    const e = await freshEngine();
    e.fire({ type: "lineClear", squares: 1, combo: 0 }); // warm the pool
    await settle();
    // Read the volume of the voice that ACTUALLY fired last (most recent start), not
    // the max across all pooled voices (untriggered voices keep their default 0 dB,
    // which would read as "louder" than any real attenuated hit). gainToDb(velocity).
    const lastFiredDb = (sub: string): number => {
      const fired = mockState.players
        .filter((p) => p.url.includes(sub) && p.starts.length > 0)
        .sort((a, b) => Math.max(...b.starts) - Math.max(...a.starts));
      return fired.length ? fired[0]!.volume.value : Number.NEGATIVE_INFINITY;
    };
    // a 1-square clear (velocity 0.7) then a 4-square clear (velocity 1.0).
    e.fire({ type: "lineClear", squares: 1, combo: 0 });
    await settle();
    const smallDb = lastFiredDb("sfx-stage");
    e.fire({ type: "lineClear", squares: 4, combo: 0 });
    await settle();
    const bigDb = lastFiredDb("sfx-stage");
    expect(bigDb).toBeGreaterThan(smallDb); // 4-square is hotter than 1-square
  });

  it("a CHAIN is audibly distinct — it fires `stage` AND a layered `drop`", async () => {
    const e = await freshEngine();
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
    // a chain fired BOTH a stage hit and a layered drop impact.
    expect(stageAfter).toBeGreaterThan(stageBefore);
    expect(dropAfter).toBeGreaterThan(dropBefore);
  });

  it("EVERY settle plays a `drop`, with velocity scaled by cause (hard > soft > gravity)", async () => {
    const e = await freshEngine();
    e.fire({ type: "lock", cause: "gravity" }); // warm the drop pool
    await settle();
    const drop = () => mockState.players.filter((p) => p.url.includes("sfx-drop"));
    // volume of the drop voice that fired most recently (default 0-dB untriggered
    // voices would otherwise mask the real attenuated hits).
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
    // a gravity lock (the common case) is audible at all — B4 (not only hard drops).
    expect(drop().flatMap((p) => p.starts).length).toBeGreaterThan(0);
    expect(hardDb).toBeGreaterThan(softDb);
    expect(softDb).toBeGreaterThan(gravityDb);
  });

  it("a MOVE fires no SFX voice (silent by decision)", async () => {
    const e = await freshEngine();
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

  it("reaching the top tier on a 4-tier segment forces the MANDATORY advance (vocals → move on)", async () => {
    const e = await freshEngineWith(nTierManifest("song4", 4));
    expect(e.getAudioState().tierCount).toBe(4);
    // pour clear-progress to the TOP reveal step (tier3 at ≥18) but BELOW the advance
    // threshold (30): 6 weight-3 clears (squares 2, combo 0 → 1+2+0=3) → segmentScore 18.
    for (let i = 0; i < 6; i++) clear(e, 2, 0);
    expect(e.getAudioState().segmentScore).toBeLessThan(30); // below the clear-gate
    // BOUNDARY 1: the top tier is REVEALED here (vocals in); the section does NOT advance
    // on the same boundary it reveals the top (vocals must sound for a loop first).
    loopBoundary();
    await settle();
    expect(e.getAudioState().tier).toBe(3); // top of a 4-tier segment, revealed
    expect(e.getAudioState().segmentIndex).toBe(0); // not yet — vocals heard this loop
    // BOUNDARY 2: the top tier was audible the prior loop → MANDATORY advance now, EVEN
    // THOUGH clear-progress is still below ADVANCE_THRESHOLD.
    loopBoundary();
    await settle();
    expect(e.getAudioState().segmentIndex).toBe(1);
  });

  it("reaching the top tier on a 5-tier segment forces the MANDATORY advance (vocals → move on)", async () => {
    const e = await freshEngineWith(nTierManifest("song5", 5));
    expect(e.getAudioState().tierCount).toBe(5);
    // tier4 (the top) reveals at score ≥24; the clear-gate sits ABOVE it (30). Bank 24
    // (between the top reveal and the advance gate): 8 weight-3 clears (squares 2,
    // combo 0 → 3) → segmentScore 24, < 30.
    for (let i = 0; i < 8; i++) clear(e, 2, 0); // score 24 → reveals tier4, < advance (30)
    expect(e.getAudioState().segmentScore).toBeLessThan(30); // below the clear-gate
    // BOUNDARY 1: reveal the top tier (tier4, vocals); no advance on the reveal boundary.
    loopBoundary();
    await settle();
    expect(e.getAudioState().tier).toBe(4); // top of a 5-tier segment, revealed
    expect(e.getAudioState().segmentIndex).toBe(0);
    // BOUNDARY 2: top was audible the prior loop → MANDATORY advance, below the gate.
    loopBoundary();
    await settle();
    expect(e.getAudioState().segmentIndex).toBe(1);
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

  it("a single HOT bar banking BOTH thresholds reveals the top tier BEFORE it advances (vocals heard, then carried)", async () => {
    // The invariant: a bar that earns the top-tier reveal AND the clear-gate advance in
    // ONE pass must be FULLY revealed and HEARD before it moves on — the reveal boundary
    // does NOT also advance off the top (that would cancel the vocals ramp). So the top
    // is revealed on boundary 1 (no advance), heard for a loop, then the section advances
    // on boundary 2 carrying the fully-revealed top tier forward (not a bare floor).
    const e = await freshEngineWith(nTierManifest("song5", 5));
    expect(e.getAudioState().tierCount).toBe(5);
    expect(e.getAudioState().tier).toBe(1); // entry floor, nothing revealed yet
    // bank PAST both the top reveal (tier4 at 24) AND the advance gate (30) in one pass.
    e.__injectClears(10); // 10 × weight-4 = 40 ≥ 30, and ≥ 24 (top reveal)
    // BOUNDARY 1: reveal the top tier; do NOT advance off it on the same boundary.
    loopBoundary();
    await settle();
    expect(e.getAudioState().segmentIndex).toBe(0); // still here — vocals just revealed
    expect(e.getAudioState().tier).toBe(4); // top revealed + audible
    expect(e.getAudioState().layerGains[4]).toBeGreaterThan(0.9); // vocals ramp not cancelled
    // BOUNDARY 2: now it advances (clear-gate score still ≥ 30, sticky), carrying the
    // floor — CAPPED at top-1 (D3) so the next segment re-earns its own vocals.
    loopBoundary();
    await settle();
    expect(e.getAudioState().segmentIndex).toBe(1);
    expect(e.getAudioState().tier).toBe(3); // carried floor capped at top-1 (4-1), not 4
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
    // back at the song's OPENING: segment 0, progress cleared, max reset.
    expect(s.segmentIndex).toBe(0);
    expect(s.maxSegmentReached).toBe(0);
    expect(s.segmentScore).toBe(0);
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

// ── Change 3: full reveal (top tier / vocals) forces a MANDATORY advance ──────────
describe("mandatory advance on full reveal (vocals in → must move on)", () => {
  it("reaching the top tier advances ON THE NEXT loop (vocals heard first), below the gate", async () => {
    const e = await freshEngineWith(nTierManifest("song5", 5));
    // reveal the top tier (tier4 at score >=24) while staying below ADVANCE_THRESHOLD (30).
    for (let i = 0; i < 8; i++) clear(e, 2, 0); // score 24
    expect(e.getAudioState().segmentScore).toBeLessThan(30);
    // boundary 1 REVEALS the top tier but does NOT advance (vocals must sound a loop).
    loopBoundary();
    await settle();
    expect(e.getAudioState().tier).toBe(4);
    expect(e.getAudioState().segmentIndex).toBe(0);
    // boundary 2: top was audible the prior loop → mandatory advance fires below the gate.
    loopBoundary();
    await settle();
    expect(e.getAudioState().segmentIndex).toBe(1);
  });

  it("the reveal boundary does NOT advance off the top tier on the SAME boundary", async () => {
    // Regression: revealing the top tier AND advancing on the same boundary would cancel
    // the top tier's gain ramp (vocals never sound). The audible tier must reach the top
    // and stay for at least one loop before the section moves on.
    const e = await freshEngineWith(nTierManifest("song5", 5));
    for (let i = 0; i < 8; i++) clear(e, 2, 0); // score 24 → arms top tier
    expect(e.getAudioState().tier).toBeLessThan(4); // not revealed mid-loop
    loopBoundary();
    await settle();
    // the top tier is now AUDIBLE and the section is still here (not advanced past it).
    expect(e.getAudioState().tier).toBe(4);
    expect(e.getAudioState().segmentIndex).toBe(0);
    expect(e.getAudioState().layerGains[4]).toBeGreaterThan(0.9); // vocals gained UP
  });

  it("a section that has NOT reached the top tier does NOT mandatorily advance", async () => {
    const e = await freshEngineWith(nTierManifest("song5", 5));
    // reveal tier3 (score >=18) but not the top tier4 (needs >=24); stay below advance.
    for (let i = 0; i < 6; i++) clear(e, 2, 0); // score 18 → tier3 < top, < 30
    loopBoundary();
    await settle();
    expect(e.getAudioState().tier).toBe(3);
    expect(e.getAudioState().segmentIndex).toBe(0); // held — not at top, below gate
    // many more dry boundaries: still loops in place (no mandatory advance).
    for (let k = 0; k < 4; k++) {
      loopBoundary();
      await settle();
      expect(e.getAudioState().segmentIndex).toBe(0);
    }
  });

  it("full-reveal advance is still ONE-STEP forward-only (no fast-forward / cascade)", async () => {
    const e = await freshEngineWith(nTierManifest("song5", 5));
    for (let i = 0; i < 8; i++) clear(e, 2, 0); // reveal top tier
    loopBoundary(); // boundary 1: reveal
    await settle();
    loopBoundary(); // boundary 2: mandatory advance
    await settle();
    const after = e.getAudioState().segmentIndex;
    expect(after).toBe(1); // exactly one step
    // the next section carries the top floor but its OWN top reveal is NOT yet EARNED
    // (segmentScore reset to 0 on entry), so it does NOT cascade-advance on the next
    // dry boundaries — it loops in place until the player re-earns the reveal.
    for (let k = 0; k < 3; k++) {
      loopBoundary();
      await settle();
      expect(e.getAudioState().segmentIndex).toBe(after);
    }
  });

  it("a carried floor is capped below top → the next section does NOT cascade (re-earns its reveal)", async () => {
    // Section A built to top, advances. B's carried floor is CAPPED at top-1 (D3), so B
    // enters BELOW its top with score 0 → it cannot be at-top on entry, and the held flag
    // resets, so the mandatory advance can't fire until B re-earns the top by clears. B
    // loops in place rather than cascading.
    const e = await freshEngineWith(nTierManifest("song5", 5));
    for (let i = 0; i < 10; i++) clear(e, 2, 0); // score 30 → clear-gate advance + top
    loopBoundary(); // boundary 1: reveals top tier4 (held — not advanced off the reveal)
    await settle();
    expect(e.getAudioState().segmentIndex).toBe(0);
    loopBoundary(); // boundary 2: now advances, carrying the capped floor into B
    await settle();
    expect(e.getAudioState().segmentIndex).toBe(1);
    expect(e.getAudioState().tier).toBe(3); // carried floor capped at top-1 (4-1), below top
    expect(e.getAudioState().segmentScore).toBe(0); // ...and re-earns from zero
    // dry boundaries: B is below its top and earns nothing → it never reaches top, never
    // arms the mandatory advance → no cascade.
    for (let k = 0; k < 4; k++) {
      loopBoundary();
      await settle();
      expect(e.getAudioState().segmentIndex).toBe(1); // no cascade
    }
  });

  it("full reveal on the TERMINAL segment fires onSongComplete (end of song), once", async () => {
    const e = await freshEngineWith(nTierManifest("song5", 5));
    let calls = 0;
    e.onSongComplete = () => {
      calls++;
    };
    const last = e.getAudioState().segmentCount - 1;
    // walk to the terminal segment.
    for (let k = 0; k < last; k++) await earnAdvance(e);
    expect(e.getAudioState().segmentIndex).toBe(last);
    expect(calls).toBe(0);
    // build the terminal up to its top tier (earned) and let it sound a loop → mandatory
    // advance PAST the terminal = end-of-song complete.
    for (let i = 0; i < 8; i++) clear(e, 2, 0);
    loopBoundary(); // reveal top
    await settle();
    loopBoundary(); // mandatory advance past terminal → complete
    await settle();
    expect(calls).toBe(1);
    expect(e.getAudioState().segmentIndex).toBe(last); // terminal loops, index unchanged
    // and it does NOT keep firing / churning on subsequent dry boundaries.
    for (let k = 0; k < 3; k++) {
      loopBoundary();
      await settle();
    }
    expect(calls).toBe(1); // still once
  });
});

// ── low-tier (1/2-tier) segments must NOT cascade with zero clears ────────────────
describe("low-tier segments never auto-advance (no cascade with zero clears)", () => {
  it("a 2-tier segment (floor == top) does NOT mandatorily advance on dry boundaries", async () => {
    // The ≥2-layer floor parks a 2-tier segment at tier1 = its top. The mandatory advance
    // must NOT fire just because tier == top: gate (a) (no headroom above floor) blocks it,
    // so the section loops in place until the player earns a clear-gate advance.
    const e = await freshEngineWith(nTierManifest("song2t", 2));
    expect(e.getAudioState().tierCount).toBe(2);
    expect(e.getAudioState().tier).toBe(1); // floor == top for a 2-tier segment
    for (let k = 0; k < 8; k++) {
      loopBoundary();
      await settle();
      expect(e.getAudioState().segmentIndex).toBe(0); // loops in place, no cascade
    }
    // it CAN still advance via the normal clear-gate (score ≥ 30).
    await earnAdvance(e);
    expect(e.getAudioState().segmentIndex).toBe(1);
  });

  it("a 1-tier segment does NOT mandatorily advance on dry boundaries", async () => {
    const e = await freshEngineWith(nTierManifest("song1t", 1));
    expect(e.getAudioState().tierCount).toBe(1);
    expect(e.getAudioState().tier).toBe(0); // only one tier exists
    for (let k = 0; k < 8; k++) {
      loopBoundary();
      await settle();
      expect(e.getAudioState().segmentIndex).toBe(0); // loops in place, no cascade
    }
    await earnAdvance(e);
    expect(e.getAudioState().segmentIndex).toBe(1); // clear-gate still advances it
  });
});

// ── audio-truth task 2.5: the D3 clear-gated-progression contract, all 6 cases ─────
describe("clear-gated progression (audio-truth D3) — the 6 contract cases", () => {
  // (i) carried full-reveal floor caps at top-1, the top is RE-EARNED, then advances
  //     after one loop at top.
  it("(i) carried floor caps at top-1, top is re-earned, then advances after one loop", async () => {
    const e = await freshEngineWith(nTierManifest("song5", 5)); // top tier = tier4
    // Build segment 0 to its top + earn the clear-gate, advance into segment 1.
    for (let i = 0; i < 10; i++) clear(e, 2, 0); // score 30 → top + clear-gate
    loopBoundary(); // reveal top
    await settle();
    loopBoundary(); // advance into seg 1 (carried floor capped at top-1 = 3)
    await settle();
    expect(e.getAudioState().segmentIndex).toBe(1);
    expect(e.getAudioState().tier).toBe(3); // entered at top-1, NOT at vocals
    // RE-EARN the top in segment 1: bank to the top reveal (tier4 at score ≥24), below
    // the clear-gate (30), so only the mandatory full-reveal path can advance it.
    for (let i = 0; i < 8; i++) clear(e, 2, 0); // score 24, < 30
    expect(e.getAudioState().segmentScore).toBeLessThan(30);
    loopBoundary(); // boundary A: re-reveal the top tier (vocals) — NO advance here
    await settle();
    expect(e.getAudioState().tier).toBe(4);
    expect(e.getAudioState().segmentIndex).toBe(1); // held this loop (vocals sound)
    loopBoundary(); // boundary B: top held a full loop → mandatory advance fires
    await settle();
    expect(e.getAudioState().segmentIndex).toBe(2);
  });

  // (ii) a low-tier / floor-only segment never auto-advances with zero clears.
  it("(ii) a floor-only (top == min-audible floor) segment never auto-advances with zero clears", async () => {
    const e = await freshEngineWith(nTierManifest("song2t", 2)); // floor == top
    for (let k = 0; k < 10; k++) {
      loopBoundary();
      await settle();
      expect(e.getAudioState().segmentIndex).toBe(0); // loops forever with no clears
    }
  });

  // (iii) no advance on the reveal boundary (ramp-cancel guard, gate c).
  it("(iii) no advance on the boundary that first reveals the top (ramp-cancel guard)", async () => {
    const e = await freshEngineWith(nTierManifest("song5", 5));
    e.__injectClears(10); // banks BOTH the top reveal AND the clear-gate in one pass
    loopBoundary(); // reveals top — must NOT advance off it on this same boundary
    await settle();
    expect(e.getAudioState().tier).toBe(4); // top revealed + audible
    expect(e.getAudioState().segmentIndex).toBe(0); // not advanced (gate c held)
    expect(e.getAudioState().layerGains[4]).toBeGreaterThan(0.9); // reveal ramp intact
  });

  // (iv) no cascade — a fresh advance needs a fresh full loop in the new segment.
  it("(iv) the new segment needs a fresh full loop at top — no cascade", async () => {
    const e = await freshEngineWith(nTierManifest("song5", 5));
    for (let i = 0; i < 10; i++) clear(e, 2, 0);
    loopBoundary(); // reveal
    await settle();
    loopBoundary(); // advance into seg 1 (capped floor, held flag reset, score 0)
    await settle();
    const idx = e.getAudioState().segmentIndex;
    expect(idx).toBe(1);
    for (let k = 0; k < 5; k++) {
      loopBoundary();
      await settle();
      expect(e.getAudioState().segmentIndex).toBe(idx); // no cascade on dry boundaries
    }
  });

  // (v) end-of-song fires onSongComplete.
  it("(v) an earned advance past the TERMINAL segment fires onSongComplete", async () => {
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

  // (vi) weight pacing: typical clear = 3, big clear = 5 (< 30), streak = 7.
  it("(vi) clear weight pacing — typical=3, big harvest=5, streak=7, all under the 30 gate", async () => {
    const e = await freshEngine();
    // a typical 2-square, no-streak clear → weight 1 + 2 + 0 = 3.
    clear(e, 2, 0);
    await settle();
    expect(e.getAudioState().segmentScore).toBe(3);
    // a big 4-square single-sweep harvest, no streak → 1 + 4 + 0 = 5 (rewarded, ≪ 30).
    clear(e, 4, 0);
    await settle();
    expect(e.getAudioState().segmentScore).toBe(3 + 5);
    // a 4-square pass on a ×3 streak (combo = streak-1 = 2) → 1 + 4 + 2 = 7.
    clear(e, 4, 2);
    await settle();
    expect(e.getAudioState().segmentScore).toBe(3 + 5 + 7);
    // none of these single clears alone crosses ADVANCE_THRESHOLD (30) → no fast-forward.
    expect(e.getAudioState().segmentScore).toBeLessThan(30);
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
    expect(e.getAudioState().segmentIndex).toBe(0);
    // a clear on segment 0 must load + fire the SEGMENT's own stage sample.
    e.fire({ type: "lineClear", squares: 2, combo: 0 });
    await settle();
    e.fire({ type: "lineClear", squares: 2, combo: 0 });
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
    // advance to segment 1 (no per-segment sfx).
    await earnAdvance(e);
    expect(e.getAudioState().segmentIndex).toBe(1);
    e.fire({ type: "lineClear", squares: 2, combo: 0 });
    await settle();
    e.fire({ type: "lineClear", squares: 2, combo: 0 });
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
    // fire on segment 0 so its per-segment stage pool is constructed.
    e.fire({ type: "lineClear", squares: 2, combo: 0 });
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
    // fire on segment 1 BEFORE its pool has a chance to exist — must not throw.
    await earnAdvance(e);
    expect(() => {
      e.fire({ type: "lineClear", squares: 2, combo: 0 });
    }).not.toThrow();
    await settle();
  });
});
