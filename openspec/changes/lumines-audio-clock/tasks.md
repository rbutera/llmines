## 1. Clock interface + FakeClock (neutral, no core dependency)

- [ ] 1.1 Create `src/game/time/clock.ts` exporting `interface Clock { now(): number }` (seconds), with a doc comment stating the unit is seconds to match `AudioContext.currentTime`.
- [ ] 1.2 In the same file add `class FakeClock implements Clock` holding an internal `t = 0` (seconds), with `now()`, `set(seconds)`, and `advance(seconds)`.
- [ ] 1.3 Confirm `time/clock.ts` does NOT import anything from `core/**`, the DOM, `Date`, `performance`, or `AudioContext` (keeps the boundary clean both ways).

## 2. Production AudioClock (singleton AudioContext)

- [ ] 2.1 Create `src/game/audio/clock.ts` exporting `createAudioClock(): Clock` that lazily creates ONE shared `AudioContext` (module-level singleton) and returns `{ now: () => ctx.currentTime }`.
- [ ] 2.2 Add a `resume()` path (e.g. `ctx.resume()`) callable on the first user gesture, and ensure that before resume the clock reports no musical time elapsed (frozen/zero) so the board waits rather than jumps.
- [ ] 2.3 Guard for non-browser environments: `createAudioClock()` is only invoked in the browser; never construct `AudioContext` during SSR.

## 3. Inject the clock into the controller (no behaviour change)

- [ ] 3.1 In `src/game/engine/controller.ts`, extend `ControllerOptions` with `clock?: Clock`.
- [ ] 3.2 Store the clock on the controller; default to `new FakeClock()` in test mode and `createAudioClock()` in production.
- [ ] 3.3 Make the controller the ONLY layer that reads time: route the production sweep through `clock.now()` (derive the existing `dtMs` from successive readings) so `advanceSweep` still receives a column delta and behaviour is byte-identical to today.
- [ ] 3.4 On first production input/gesture, resume the `AudioContext` so musical time starts; verify the board does not advance before resume.

## 4. Test seam (additive)

- [ ] 4.1 In `src/game/test-api/install.ts`, expose an additive clock-advance helper (e.g. wrapping `FakeClock.advance` + one logical frame) WITHOUT removing or changing `seed`/`state`/`marked`/`spawn`/`tick`/`sweepNow`/`sweepProgress`.
- [ ] 4.2 Confirm `window.__lumines.state()` shape (grid, score, gameOver, sweepX) is unchanged.

## 5. Tests

- [ ] 5.1 Unit-test `FakeClock`: `set` + `advance` reflected by `now()`; step-size independence (advance `T` once == advance `T` in N steps → identical `now()`).
- [ ] 5.2 Controller test: constructing in test mode yields a `FakeClock`, in production yields an `AudioClock` (or an injected clock is honoured).
- [ ] 5.3 Regression: same seeded inputs produce identical `window.__lumines.state()` before and after the seam (no behaviour drift).
- [ ] 5.4 Assert no module under `src/game/core/**` imports a clock/`Date`/`performance`/`AudioContext` (grep-style or import-lint test).

## 6. Verify

- [ ] 6.1 Run the unit suite (`src/game/core/core.test.ts` + new clock tests) — all green.
- [ ] 6.2 Run lint/typecheck — no new warnings from changed/new files.
- [ ] 6.3 Manually run a production build: confirm the sweep starts only after the first gesture and plays identically to before.
