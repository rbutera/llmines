## Context

The codebase is a four-layer Lumines clone: a pure `core/**` (no DOM/Pixi/time imports — enforced and load-bearing for the eval), a `GameController` (`engine/controller.ts`) that owns `GameState`, the rAF loop, and all wall-clock timing, a throwaway Pixi `render/**` layer, and a deterministic test seam at `window.__lumines` (installed only under `NEXT_PUBLIC_TEST_MODE=1`) that drives the core with the loop **off**.

Today the controller advances the sweep from an accumulated frame delta:

```ts
// engine/controller.ts, production frame
private advance(dtMs: number): void {
  this.state = advanceSweep(this.state, dtMs / SWEEP_MS_PER_COL);
  // ...gravity on a fixed tick...
}
```

`advanceSweep(state, columns)` is already a **pure function of a column count**, not of wall-clock — exactly the right shape. The problem is the *source* of `columns`: an accumulator drifts (dropped frames, GC, tab-out, the `Math.min(dt, 100)` clamp) and has no relationship to a musical playhead. Real Lumines advances one column per eighth-note of the track, so the sweep must derive from an audio clock. This change adds that clock seam without touching any game logic; proposal A then uses it to make the sweep beat-derived, and future proposal C uses the same `AudioContext` for audio so the two never drift.

## Goals / Non-Goals

**Goals:**
- A single `Clock` abstraction (`now(): seconds`) is the only thing the controller reads for time.
- Production reads `AudioContext.currentTime`; tests advance a fake clock manually, keeping timing deterministic and inspectable.
- The `core/**` purity boundary, the `window.__lumines` shape, scoring, RNG order, and the rendered feel are all unchanged.
- The seam is shaped so proposal A (sweep timing) and proposal C (audio scheduling) read the *same* clock.

**Non-Goals:**
- No beat-derived sweep math yet (that is proposal A; this change keeps the existing `dtMs`-accumulator path working, now sourced from a clock).
- No stems, one-shots, SFX, or any actual audio playback (that is proposal C). This change only stands up the `AudioContext` as a clock source.
- No change to gravity timing, soft/hard-drop, spawn, or any core op.

## Decisions

### Decision 1: A `Clock` interface with `now(): seconds`, defined once in a neutral module

`interface Clock { now(): number }` returning **seconds** (matching `AudioContext.currentTime`'s unit) lives in a neutral `src/game/time/clock.ts` alongside `FakeClock`. The interface and the fake are placed in `time/` (not `core/`) deliberately: `core/**` must stay free of even the *concept* of ambient time. The controller imports `Clock` and is the sole consumer.

**Why seconds, not ms:** `AudioContext.currentTime` is seconds; using the same unit avoids a conversion bug between the prod clock and the fake clock. The controller converts to columns using existing constants (`SECONDS_PER_BEAT`, `COLS`).

**Alternative considered — leave time as `dtMs` deltas threaded through:** rejected; that is the drifting accumulator this change exists to remove the dependency on, and it gives proposal C nothing to share.

### Decision 2: `AudioClock` wraps a singleton `AudioContext`, resumed on first gesture

`createAudioClock(): Clock` (in `src/game/audio/clock.ts`) lazily creates one shared `AudioContext` and returns `{ now: () => ctx.currentTime }`. Browsers suspend a context until a user gesture, so the clock must:
- Expose a way to resume the context on the first input/gesture (`ctx.resume()`), and
- Define a pre-resume state: before resume, `currentTime` is `0`/frozen, so the controller treats "clock not yet started" as "no musical time elapsed" — the board waits, it does not jump. The very first input resumes the context and starts musical time.

Only **one** `AudioContext` is ever created; proposal C will attach stems and one-shots to this same context so audio scheduling and the sweep share `currentTime`.

**Alternative considered — create a context per use:** rejected; multiple contexts have independent `currentTime` origins, which is exactly the drift this seam prevents.

### Decision 3: `FakeClock` is a manually-advanced test clock

`FakeClock` holds an internal `t` (seconds), `now()` returns it, and `advance(seconds)` / `set(seconds)` move it. Tests drive timing by advancing the fake clock then running one logical frame — preserving the current deterministic driver style. Because the sweep position will (in proposal A) be computed from **absolute** clock time, "advance 3 eighths in one step" and "advance one eighth three times" must yield the identical final clock reading, which a fake clock makes trivial to assert.

**Alternative considered — mock `performance.now`/`Date.now` globally:** rejected; global mocking is brittle, leaks across tests, and does not give the controller a single injected seam.

### Decision 4: Inject the `Clock` via `ControllerOptions`, defaulting per mode

`ControllerOptions` gains `clock?: Clock`. The controller stores it; default is a `FakeClock` in test mode and an `AudioClock` in production. This keeps construction explicit and lets the test seam pass a fake it can advance. The controller is now the **only** layer that touches time; the core stays a pure `(state, columnDelta)` function.

### Decision 5: Keep the existing sweep path working; do not change semantics in this change

This change is a pure plumbing addition. The production `advance(dtMs)` may continue to feed `advanceSweep` exactly as today (it can derive `dtMs` from successive `clock.now()` readings) so behaviour is byte-identical and the change is safely landable before proposal A. Proposal A then replaces the accumulator with absolute-time-derived column positions. Splitting it this way keeps this change zero-risk and the bug fix in A clean.

## Risks / Trade-offs

- **AudioContext autoplay gate** → Production has no musical time until the first user gesture. Mitigation: defined pre-start state (clock reads frozen/zero ⇒ no time elapsed ⇒ board waits); first input calls `ctx.resume()` and starts time. Does not affect tests (FakeClock needs no gesture).
- **Unit mismatch (seconds vs ms)** → A subtle source of drift if mixed. Mitigation: `Clock.now()` is seconds everywhere; conversions to columns use the existing `SECONDS_PER_BEAT`/`COLS` constants, asserted by tests.
- **Over-engineering for a clock that today only feeds the existing path** → Accepted deliberately: defining `Clock` once is the whole point of the master-clock decision; A and C both depend on it, so the seam pays for itself immediately.
- **Server-side rendering** → `AudioContext` is browser-only. Mitigation: `createAudioClock()` is only called in the browser (the controller already guards production-only behaviour; `installTestApi` already early-returns when `window` is undefined).

## Migration Plan

Additive, in-place. New files `time/clock.ts` and `audio/clock.ts`; controller gains an optional injected clock with safe defaults. No data/state migration. Rollback = drop the injected clock and the two new files; the controller falls back to its current `dtMs` path (which this change leaves intact).

## Open Questions

- None blocking. The autoplay-resume UX (resume silently on first input vs an explicit "click to start" affordance) is a render/UX detail deferred to proposal C's audio work; for this change the silent-resume-on-first-input default is sufficient and testable via the FakeClock path.
