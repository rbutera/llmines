## 0. Global acceptance (the green-but-broken guard)

- [x] 0.1 **Production Start still works**: `npx playwright test --config=playwright.production-start.config.ts` is GREEN — clicking Start spawns a piece (`hasActive`), the sweep advances (`sweepX > 0`), the orthographic camera zoom stays positive (`cameraZoom > 0`), and there are 0 console/page errors. AutoFitCamera's MIN_ZOOM floor + bail-until-finite guards remain in `ThreeRenderer.tsx`.
- [x] 0.2 **Deterministic core + seam unchanged**: `core/**` imports no time/DOM/audio; the `window.__lumines` interface keeps its exact shape (no removed/renamed methods); the existing determinism + purity + scoring suites stay green.
- [x] 0.3 **Full gate green**: `npx vitest run` green (incl. all new tests below); `npx tsc --noEmit` clean (baseUrl deprecation excepted); real `eslint` (`npx next lint`) exit 0; `npx next build` succeeds.

## 1. Score-delta transient

- [x] 1.1 Add a pure helper `scoreDeltaVisible(elapsedMs, lifetimeMs)` to `fx/scoreFx.ts` and make `ScoreFx` show the count-up number only within the gain window, fading to hidden when idle. The authoritative `data-testid="score"` HUD value is untouched.
- [x] 1.2 **Acceptance**: a vitest unit test asserts `scoreDeltaVisible` is true at `elapsed < lifetime` and false at/after `lifetime` (and false for elapsed `>= lifetime`); manual self-verify confirms the floating "+N" / count-up appears on a clear then fades, leaving only the HUD score.

## 2. ~90% viewport width + overlaid auto-hiding chrome

- [x] 2.1 Restructure the playing layout so the canvas fills ~90% of viewport width (aspect-locked, well/preview never clipped), and move title/account/controls/preview/skin chrome into an absolutely-positioned overlay that is shown when not playing / paused / game-over and hidden during active play.
- [x] 2.2 Keep the in-canvas PreviewDock so the next piece is still visible in-play; keep `aspectRatio: BOARD_ASPECT` on the canvas container.
- [x] 2.3 **Acceptance**: production-start e2e (task 0.1) stays green (no zoom-0); manual self-verify at a real viewport shows the canvas ~90% wide with chrome hidden during play and visible when paused/over.

## 3. Escape = pause

- [x] 3.1 Add `pause()` / `resume()` / `isPaused()` to `GameController`: pause cancels the rAF loop and freezes time; resume re-anchors the sweep baseline (no rewind) and restarts the loop. Wire Escape in `GameShell` to toggle pause during play.
- [x] 3.2 **Acceptance**: a vitest controller test asserts that while paused, `testProductionFrame()` advances neither `sweepX` nor gravity, and that after `resume()` a subsequent frame advances the sweep again. (If feasible) the production-start e2e gains an Escape-pauses assertion: after Escape, `sweepX` stops advancing.

## 4. Subtle light/dark gem variants

- [x] 4.1 Replace the oversized amber gem marker in `Cube.tsx` with a subtle, smaller marker that has a LIGHT variant (reads on bright cells) and a DARK variant (reads on dark cells), preserving the underlying block colour; add the supporting settings + lower the `gemIntensity` default.
- [x] 4.2 **Acceptance**: a vitest settings test asserts the new gem defaults exist and the default `gemIntensity` is dialled down vs the old value; manual self-verify (force-gem) shows the marker is clear but subtle and the block colour is still visible underneath.

## 5. Flat 2D next-preview

- [x] 5.1 Render preview pieces as FLAT 2D squares (no per-column shear, no 3D tilt) in `PreviewDock.tsx` (flat quads / `shear: 0` path), keeping the bright/dark colour mapping.
- [x] 5.2 **Acceptance**: a vitest test asserts the preview render path applies no shear (shear factor resolves to 0 for any column) — distinct from the board path which shears by column; manual self-verify shows flat preview squares.

## 6. ESDF controls

- [x] 6.1 Extend `keyToAction` with ESDF (E=rotate, S=left, D=softDrop, F=right; case-insensitive) alongside arrows + hjkl; update the on-screen cheatsheet to list all schemes.
- [x] 6.2 **Acceptance**: a vitest keymap test asserts `e/E→rotate`, `s/S→left`, `d/D→softDrop`, `f/F→right`, and that existing arrow + hjkl mappings are unchanged and space still hard-drops.

## 7. Gem flood animation obvious

- [x] 7.1 Make the gem-clear cascade clearly visible/impactful (wavefront travel + every-cell flash + shockwave ring), tuning render-only state only, gated on the existing record-only `lastChainClear` payload (no core change).
- [x] 7.2 **Acceptance**: manual self-verify with the force-gem dev seam shows an obvious cascade radiating from the gem across its connected region; production-start e2e + determinism suites stay green (no core/timing change).

## 8. Rework slow/fast fall FX

- [x] 8.1 Redo soft-drop and hard-drop feedback so each reads clearly (soft = sustained warm trail/speed-lines; hard = sharper slam streak + tighter shake + impact spark); render-only tuning.
- [x] 8.2 **Acceptance**: manual self-verify shows soft-drop and hard-drop read distinctly and well; no determinism/test regressions.

## 9. Hold-to-sustain slow fall (KEY MECHANIC)

- [x] 9.1 Add sustained soft-drop to `GameController`: a fresh soft-drop press engages sustained mode (descends at `SOFT_DROP_INTERVAL_MS`, faster than gravity, slower than hard-drop); a key-up disengages; lock/spawn clears it; the spawn-hold guard + fresh-press-vs-key-repeat behaviour is preserved. Wire `keyup` in `GameShell`.
- [x] 9.2 **Acceptance**: a vitest controller test (production-frame path) asserts that after a fresh soft-drop press, repeated frames each advancing the clock by less than one gravity interval produce CONTINUOUS multi-row descent (faster than gravity would give in the same time), and that releasing reverts to the slow gravity cadence. Existing hold + determinism tests stay green.

## 10. Music volume slider

- [x] 10.1 Add `musicVolume` (default 0.5) to the visual settings (persisted via the existing localStorage path), expose a slider, and set `audioRef.current.volume = musicVolume` on change.
- [x] 10.2 **Acceptance**: a vitest settings test asserts `DEFAULT_SETTINGS.musicVolume === 0.5` and that it round-trips through load/save; manual self-verify shows the slider changes music loudness.

## 11. Close-out

- [x] 11.1 Re-run the full gate (task 0.3) + the production-start e2e (task 0.1); record results.
- [x] 11.2 Self-verify in a real browser (non-TEST_MODE) on a private port; screenshot; stop the server.
- [x] 11.3 Commit on `feat/lumines-v2-complete` (clear message, NO Co-Authored-By); do not push.
