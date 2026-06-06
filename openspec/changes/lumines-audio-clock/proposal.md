## Why

The timeline sweep is the heartbeat of Lumines, and in the real game it is locked to the music: the bar advances one column per eighth-note of the backing track. Today the controller drives the sweep off an accumulated wall-clock delta (`advanceSweep(state, dtMs / SWEEP_MS_PER_COL)` in `engine/controller.ts`), which drifts under dropped frames, GC pauses, and tab-outs and has no relationship to a real audio playhead. Before either the beat-synced sweep (proposal A `lumines-grid-and-sweep`) or interactive audio (future proposal C) can be faithful, the game needs a single authoritative source of musical time that both can read. This change introduces that source — an injected `Clock` seam — with **no game-logic change**, so it can land first and the two downstream proposals never disagree about "what time is it."

## What Changes

- Introduce a `Clock` interface (`now(): number`, seconds) as the single abstraction for "current time" the controller may read.
- Add `AudioClock`, a production implementation backed by a singleton `AudioContext` whose `currentTime` is the master clock. The context is created/resumed on the first user gesture (browser autoplay policy) and exposes a defined pre-start state until then.
- Add `FakeClock`, a manually-advanced test implementation (`now()` returns an internally held time the test sets), so audio-driven timing is as deterministic and inspectable as the current `sweepProgress(dtMs)` driver.
- Inject a `Clock` into `GameController` via `ControllerOptions` (default `FakeClock` in test mode, `AudioClock` in production). The controller becomes the **only** layer that touches time.
- Preserve the existing deterministic test seam exactly: `window.__lumines` keeps its shape; a clock-advancing test helper augments (does not replace) `sweepProgress`.
- **No change** to the pure core (`core/**` stays free of time/DOM/audio imports), the sweep math, scoring, RNG/determinism, or the rendered feel. The sweep stays a pure delta function fed from the controller; only the *source* of the delta is now a clock reading.

## Capabilities

### New Capabilities
- `time-clock-seam`: A single injected `Clock` abstraction (`now(): seconds`) with a production `AudioClock` (singleton `AudioContext.currentTime`) and a deterministic `FakeClock` for tests; the controller is the sole consumer of time and the pure core never reads a clock.

### Modified Capabilities
<!-- None — openspec/specs/ is empty; this is the first captured capability for the time seam. -->

## Impact

- **Code**: new `src/game/time/clock.ts` (the `Clock` interface + `FakeClock`); new `src/game/audio/clock.ts` (`createAudioClock()` wrapping a singleton `AudioContext`); `src/game/engine/controller.ts` (accept a `Clock` in `ControllerOptions`, store it, route the production sweep through `clock.now()` instead of accumulated `dtMs`); `src/game/test-api/install.ts` (optional clock-advance helper, additive).
- **Determinism**: unchanged and strengthened — `FakeClock` makes time injection reproducible; the pure core stays a function of `(state, columnDelta)` only.
- **Dependencies**: no new packages — Web Audio API is a platform primitive.
- **No impact** on: the `core/**` purity boundary, scoring, sweep semantics, RNG order, the `window.__lumines.state()` shape, or the renderer.
- **Downstream**: proposal A consumes this `Clock` for beat-derived sweep timing; future proposal C consumes the same `AudioContext` for stems/one-shots, so sweep and audio cannot drift.
