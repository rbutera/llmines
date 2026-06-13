## 1. Event truth — deriver consumes real telemetry (code, no asset/core runtime dependency)

- [x] 1.1 Add a `readTelemetry(rs)` adapter in `events.ts` that reads the controller's pass-completion (`lastPass`: `{id, squares, comboMultiplier, groupErases}`) and lock (`lastLock`: `{id, cause}`) telemetry fields, returning a normalized `{pass?, lock?}` for the frame; mark it `// TODO(core-lumines-fidelity)` and make absent fields return `undefined` (no pass / no lock) — never a score-based estimate.
- [x] 1.2 Rewrite `AudioEventDeriver.derive` to emit `lineClear` from `lastPass.id` advancing AND `pass.squares >= 1` (a zero-square pass-id bump emits nothing) (`squares = pass.squares`, `combo = pass.comboMultiplier - 1`), and `lock` from `lastLock.id` advancing (carrying `cause`); keep `chain` from `lastChainClear.id`, and `move`/`rotate`/`softDrop` unchanged.
- [x] 1.3 Delete the `score`-delta branch and the `round(delta/40)` estimate entirely from `events.ts` (no fallback path that infers clears from score) and drop `score` from the deriver `Snapshot`.
- [x] 1.4 Extend `AudioEvent` in `engine.ts`: `lock` gains optional `cause: "hard" | "soft" | "gravity"`; confirm `lineClear.combo` now carries the streak offset. Keep the union otherwise stable.
- [x] 1.5 Rewrite `events.test.ts` against the real contract: real-clear → one truthful `lineClear`; score-only event (soft-drop/board bonus) → no `lineClear`; multiplied pass not inflated; lock-per-settle for gravity/soft/hard; missing telemetry → silent (no inference). (covers `audio-event-truth`)

## 2. Clear-gated progression — weight + mandatory advance (code)

- [x] 2.1 In `engine.play`, change the clear-weight to `lineClear → 1 + squares + combo` (combo already = streak-1) and keep `chain → 2 + min(8, size)`; update the docstring's weight rationale to reference the real inputs against `ADVANCE_THRESHOLD = 30` / `TIER_REVEAL_STEP = 6` (keep the knobs unchanged, keep the `onScore` cap + NaN guard).
- [x] 2.2 In `enterSegment`, cap the carried `entryFloor` below the segment's top: `startTier = min(startTier, max(tierFloorFor(seg), top - 1))` (vocals re-earned per segment), preserving the ≥2-layer min-audible floor and the loaded-tier clamp.
- [x] 2.3 Add per-segment state `topHeldSinceBoundary` (reset on `enterSegment`): set it true on the boundary AFTER the one that first makes `this.tier === top`, so the top is heard a full loop before it can arm the advance.
- [x] 2.4 Rewrite `shouldAdvance` gate (b): replace "top reveal earned in-segment (`segmentScore ≥ top·TIER_REVEAL_STEP`)" with `topHeldSinceBoundary`; keep gate (a) (`top > tierFloorFor` headroom / low-tier exclusion) and gate (c) (`tierBefore >= top` ramp-cancel guard) verbatim; keep the in-flight lock and TERMINAL→`complete()` routing.
- [x] 2.5 Add engine integration tests (`engine.test.ts` or a focused spec): (i) carried full-reveal floor caps at top-1, top is re-earned, then advances after one loop; (ii) a low-tier/floor-only segment never auto-advances with zero clears; (iii) no advance on the reveal boundary (ramp-cancel); (iv) no cascade (the new segment needs a fresh full loop); (v) end-of-song fires `onSongComplete`; (vi) weight pacing (typical clear = 3, big clear = 5 < 30, streak = 7). (covers `clear-gated-progression`)

## 3. Action SFX — clear-stage, universal lock, name cleanup (code)

- [x] 3.1 In `sfxRouting.ts`: rename `SfxName` member `harddrop` → `drop` (manifest-aligned 1:1), route `lineClear` → `stage`, `chain` → distinct (hot `stage`, optionally layered `drop`), `lock` → `drop`, keep `rotate`/`softDrop`, leave `move` unrouted; delete the "clear is SILENT by design" comment.
- [x] 3.2 Remove the early `return` in `engine.play` for `lineClear`/`chain` so they BOTH feed `onScore` AND route SFX; compute `stage` velocity from `squares` (`clamp(0.6 + 0.1*squares, 0.6, 1.0)`) and `drop` velocity from `lock.cause` (`hard 1.0 / soft 0.7 / gravity 0.6`).
- [x] 3.3 Remove the `harddrop`→`drop` special case in `sfxUrlFor` now that names match the manifest keys.
- [x] 3.4 Rewrite `sfxRouting.test.ts`: clear plays `stage` (and feeds progress); bigger clear = higher velocity; chain distinct from plain clear; every settle plays `drop` scaled by cause; move silent; rotate/softDrop mapped. (covers `action-sfx` routing requirements)

## 4. Per-segment SFX palettes — schema + engine pool hot-swap (code, song-level fallback)

- [x] 4.1 Extend the manifest types in `engine.ts`: add optional `ManifestSegment.sfx?: ManifestSfx`; add `segmentSfxUrlFor(name, seg, song, base)` resolving segment → song-level → undefined.
- [x] 4.2 Make the SFX pool segment-scoped: prefetch the entering segment's pool in `enterSegment`/`prefetch` (using `segmentSfxUrlFor`, falling back to song-level), dispose a left-behind segment's SFX voices in the advance-settle disposal path, and have `playSfx`/`ensureSfx` read the ACTIVE segment's pool.
- [x] 4.3 Verify an old manifest (no `segments[].sfx`) resolves every action to the song-level set with no behaviour change; add a test for the mixed-manifest fallback + the per-segment override + the prefetch/dispose lifecycle. (covers `action-sfx` per-segment + hot-swap requirements)

## 5. Gates for the code waves

- [x] 5.1 `pnpm test` (vitest) green incl. the rewritten events/sfx/engine specs.
- [x] 5.2 `pnpm typecheck` and `pnpm lint` clean.
- [x] 5.3 `pnpm build` succeeds.
- [x] 5.4 `pnpm test:e2e:production-start` passes and `node scripts/repro-autoplay.mjs <baseURL>` passes under real `--autoplay-policy=document-user-activation-required` (sustained RMS, no autoplay error) — and additionally asserts that a fully-revealed segment's vocals sound and then the song advances (the B2 fix observable, not a proxy).

## 6. Merge ordering with core-lumines-fidelity

- [ ] 6.1 Reconcile the `lastPass` / `lastLock` field names against the merged `core-lumines-fidelity` controller telemetry; update the single `readTelemetry` adapter to the final names.
- [ ] 6.2 Remove the `// TODO(core-lumines-fidelity)` absence shim once the telemetry fields are guaranteed present; confirm no score-inference path was reintroduced.

## 7. Asset pipeline — top-tier master fidelity (REQUIRES LOCAL PIPELINE + source stems, run after code)

- [x] 7.1 Extend `render-tiers.py`: render each segment's TOP tier by cutting the full-mix master (`audio-src/song1/0 Especifico Primero.wav`, `audio-src/song2/0 pipeline male phonk.wav`) at the same bar boundaries as the stem cut, instead of summing stems; keep lower tiers as cumulative stem sums; preserve a constant-sum crossfade and the bed level-match. Preserve originals (new output paths).
- [x] 7.2 Add `scripts/audio/validate-master-tier.py` (in `check-loops.py` style): per segment, compare the rendered top tier's integrated LUFS/RMS against the master slice for that time range; fail if the delta exceeds tolerance (≈±1.0 LU). (covers `tier-mix-fidelity`)

## 8. Asset pipeline — per-segment SFX cut + manifest emit (REQUIRES LOCAL PIPELINE, run after 7)

- [x] 8.1 Extend `render-sfx.py`: cut per-segment action one-shots from each segment's own stems within its bar window, biased by the segment's `character`; keep the song-level set as the fallback for any segment with no clean slice. Preserve originals.
- [x] 8.2 Extend `transcode-and-manifest.py`: emit `segments[].sfx` alongside `tiers` and keep emitting the song-level `sfx` fallback; bump the manifest `version`.
- [ ] 8.3 Regenerate assets, run `check-loops.py` + `validate-master-tier.py`, ear-check on the FINE-cut soundboard, then swap `public/audio/`; re-run all gates from §5 against the new manifest.
