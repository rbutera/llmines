# Design — lumines-polish-round

## Constraints (non-negotiable)

- **Determinism**: the pure core (`core/**`) stays free of time/DOM/audio and unchanged in behaviour. The `window.__lumines` seam keeps its exact shape and is the only deterministic driver. All new FX/render/audio state is render-only and never feeds the core, RNG, scoring, gravity, or the sweep.
- **Production Start must keep working**: `e2e/production-start.spec.ts` (piece spawns + sweep advances + camera zoom positive + 0 console errors) must stay green. The AutoFitCamera zoom-0 guards (MIN_ZOOM floor + bail-until-finite) must remain.
- **Test mode parity**: changes guarded so test paths (`testMode`) stay observationally identical where existing tests assert on them. New controller state added with the same production-only discipline as `softDropEngaged` / `softDropPulses`.

## Item designs

### 1. Score-delta transient (ScoreFx)
The floating "+N" already self-animates and is removed after `FLOAT_MS`. The persistent piece is the big count-up number rendered always. Make the whole cosmetic overlay transient: track a "recent gain" window — on a positive score change, show the count-up number and fade it out after the float lifetime; when idle it is hidden (opacity 0 / unmounted), leaving only the authoritative HUD `data-testid="score"`. Add a pure helper in `fx/scoreFx.ts` — `scoreDeltaVisible(elapsedMs, lifetimeMs)` — returning whether the transient is still showing, so transience is unit-testable without DOM. The authoritative score testid is never touched.

### 2. ~90% width + overlaid auto-hiding chrome (GameShell)
Restructure the playing layout: the canvas is the base layer at ~90% viewport width (`w-[90vw]` capped, aspect-locked so the well never clips). Chrome — title/header, account/sign-in, controls cheatsheet, next preview, skin/BPM panel — moves into an ABSOLUTELY-positioned overlay above the canvas. The overlay is shown when `phase !== "playing"` OR paused; hidden (pointer-events-none + opacity 0) during active play. The pre-existing in-canvas PreviewDock keeps the next-piece read visible in-play, so hiding the DOM preview panel does not lose information. AutoFitCamera is untouched (its guards stay), and the container keeps `aspectRatio: BOARD_ASPECT` so a wider box never produces a degenerate size.

### 3. Escape = pause (controller + GameShell)
Add a paused flag to the controller: `pause()` cancels the rAF loop and freezes the clock baseline; `resume()` re-anchors the sweep baseline (same re-anchor path the suspend/re-suspend frame already uses, so no rewind/jump) and restarts the loop. `isPaused()` for the HUD. Escape in GameShell toggles it (production only; in test mode the loop is already quiescent). Pause does not clear the active piece or score. The sweep and gravity both halt because both live in the (cancelled) loop. A pure-ish controller test asserts: while paused, `testProductionFrame()` advances neither sweep nor gravity; after resume the next frame advances again.

### 4. Subtle light/dark gem variants (Cube + settings)
Today the gem is a big spinning octahedron at fixed amber, oversized and obscuring. Replace with a subtle inlaid marker that adapts to the cell: a LIGHT variant (for bright cells — a darker/cooler inset so it reads on a bright block) and a DARK variant (for dark cells — a lighter/warmer inset so it reads on a dark block), sized down (smaller scale, lower emissive default), positioned so it does not cover the block's colour. New settings: `gemLightColor` / `gemDarkColor` (or a single subtle scale + per-variant emissive), and a lowered `gemIntensity` default. The marker still animates gently but no longer dominates. Drives off the same `isGem` + `bright` props already passed to Cube.

### 5. Flat 2D next-preview (PreviewDock)
The PreviewDock currently reuses the full sheared `Cube` (it passes `cols={2}` so shear is applied per local column → it looks 3D/sheared). Render preview cells as FLAT quads instead: plain `planeGeometry` (or a flat-shaded box with shear forced to 0) facing the camera, no per-column shear, no tilt. Expose a `flat`/`noShear` path so preview cubes pass `shear: 0` equivalent. A pure test asserts the preview path applies no shear transform (shear factor 0) regardless of column.

### 6. ESDF controls (keymap)
Extend `keyToAction`: add `e`→rotate, `s`→left, `d`→softDrop, `f`→right (case-insensitive), alongside existing arrows + hjkl. No hard-drop letter in ESDF (space stays the hard-drop). Update the on-screen cheatsheet to list all three schemes. A pure keymap test asserts each ESDF key maps to the right action and existing mappings are unchanged.

### 7. Gem flood animation obvious (Scene3D / ChainWavefront)
The cascade fires on `lastChainClear.id` but reads weakly. Make it obvious: slow the wavefront slightly (more visible travel), raise default `chainIntensity`, ensure every cleared cell flashes and the shockwave fires, and add a clearer expanding ring. Tuning-only on render-only state; gated on the existing record-only `lastChainClear` payload (no core change). Verified by the force-gem dev seam in the browser self-verify (cannot unit-assert "looks obvious").

### 8. Rework slow/fast fall FX (Scene3D / settings)
Redo soft-drop and hard-drop feedback: soft-drop = a clear continuous warm trail/speed-lines that sustains while held (ties to item 9); hard-drop = a sharper slam (brighter streak + tighter screen-shake + impact spark). Re-tune the drop-feedback settings and the trail decay so soft reads as "gliding faster" and hard reads as "slammed". Render-only. Browser self-verify (not unit-assertable as "feels good").

### 9. Hold-to-sustain slow fall (controller) — KEY MECHANIC
**Problem to reconcile**: today a held soft-drop key is a no-op while the spawn-hold is active (so a carried-over key from the previous piece cannot fast-fall the new one), and a fresh press does exactly one row. There is no continuous soft-drop.

**Design**: introduce a sustained soft-drop mode on the controller, driven by a soft-drop interval timer (`SOFT_DROP_INTERVAL_MS = 60`, already defined, faster than `GRAVITY_INTERVAL_MS = 700`, slower than instant hard-drop):
- A FRESH soft-drop press (`pressSoftDrop`) ends the spawn-hold, does its immediate step, AND engages "soft-drop sustained" mode.
- While sustained AND not held, the production gravity accumulator uses `SOFT_DROP_INTERVAL_MS` instead of `GRAVITY_INTERVAL_MS`, so the piece descends continuously at soft-drop speed (each step still routes through the pure `softDrop` core op, banking +1/row exactly as before).
- A key-up (`releaseSoftDrop`) disengages sustained mode → back to normal gravity.
- The spawn-hold guard is preserved: sustained mode only descends once the hold has lapsed; a carried-over key (OS key-repeat) still routes to `input()` and is a no-op while held. The FRESH-press-vs-repeat distinction in GameShell is the trigger.
- On lock/spawn, sustained mode is cleared so the next piece's spawn-hold is honoured (the player must press again, matching the existing deliberate-placement model).

GameShell wires `keyup` for the soft-drop keys to call `releaseSoftDrop()`. Test mode stays quiescent (sustained mode is production-loop-only; test paths drive single steps via the seam, unchanged).

**Tests**: a controller test in production-frame mode asserts that after a fresh soft-drop press, repeated `testProductionFrame()`s (advancing the fake clock by < one gravity interval each) descend the piece multiple rows — i.e. continuous descent FASTER than gravity — and that releasing reverts to the slow gravity cadence. Determinism tests stay green (test seam paths untouched).

### 10. Music volume slider (GameShell / settings)
The backing track plays via an `<audio>` element. Wire its volume: add `musicVolume` (default 0.5) to the visual settings (persisted with the rest via the existing localStorage path), expose a slider, and set `audioRef.current.volume = musicVolume` whenever it changes. Default 0.5 is asserted in a settings unit test. (HTMLMediaElement.volume is the music gain for an `<audio>` element; no extra GainNode needed.)

## Verification strategy
- Unit (vitest): items 1, 3, 5, 6, 9, 10 each get a pure/controller test.
- e2e (Playwright production bundle): existing production-start spec stays green; add an Escape-pauses assertion if the probe can expose paused/sweep-frozen state.
- Browser self-verify (non-test-mode, own port): items 2, 4, 7, 8 (the "looks good / obvious" ones) verified by screenshot + interaction, since they cannot be unit-asserted.

## Risks
- **Re-introducing zoom-0**: mitigated by leaving AutoFitCamera + its guards untouched and keeping `aspectRatio: BOARD_ASPECT` on the container.
- **Breaking spawn-hold**: mitigated by keeping the held-guard and clearing sustained mode on lock/spawn; covered by existing hold tests + the new sustain test.
- **Determinism drift**: all new state production-only and render-only; covered by the existing determinism + purity suites staying green.
