## 0. Global acceptance (the green-but-broken guard)

- [x] 0.1 **Production Start still works**: the production-start e2e is GREEN — clicking Start spawns a piece, the sweep advances, camera zoom stays positive, 0 console/page errors. No audio path throws.
- [x] 0.2 **Deterministic core + seam unchanged**: `core/**` imports no time/DOM/audio; `window.__lumines` keeps its exact shape; determinism + purity + scoring suites stay green. Audio is build-skipped in `TEST_MODE`.
- [x] 0.3 **Full gate green**: `npx vitest run` green (incl. new tests); `npx tsc --noEmit` clean (baseUrl deprecation excepted); real `eslint` exit 0; `npx next build` succeeds.

## 1. Assets (built from the owner's stems)

- [x] 1.1 (revised) Build SIX ordered segments (sequential 8-bar windows, bars 0/8/16/24/32/40), each as `seg{i}-bed` (Drums+Bass+Guitar+Synth+Perc+Other) + `seg{i}-vox` (Lead+Backing). dynaudnorm + 200 ms equal-power crossfade-wrap per loop; identical length (16.94 s) so all segments + axes loop in lock-step; seams near-zero (verified 0–474/32768).
- [x] 1.2 Build 8 `public/audio/sfx-*.mp3`: trim + loudness-normalise + short fade-out the curated ad-lib slices per the D4 mapping.

## 2. Port the validated engine

- [x] 2.1 Copy `audio/procedural/{engine,events,scale}.ts` + their tests from `spike/procedural-audio` onto this branch (audio files ONLY — not the spike's stale GameShell layout).
- [x] 2.2 Add `tone` to `package.json` + lockfile (pnpm).
- [x] 2.3 **Acceptance**: `scale.test.ts` + `events.test.ts` pass unchanged (the deriver fields match the visual-complete RenderState).

## 3. Segmented recorded bed + ad-lib SFX in the engine (revised)

- [x] 3.1 Load 6 segments, each a `bed` + `vox` `Tone.Player` (`loop:true`), all started at the SAME Transport time at 112 BPM so every segment + axis is phase-aligned. Segment 0's bed starts at gain 1; all other beds + all vox at 0. Keep the synth bed as fallback if segments fail to load.
- [x] 3.2 HORIZONTAL: a monotonic `clearProgress` accumulator (`1+squares+combo` per clear, `2+size` per chain); crossing `clearsPerSegment` steps `segmentIndex` and crossfades active↔next segment beds on the next bar (`@1m`). Never rewinds.
- [x] 3.3 VERTICAL: a `progression` scalar bumped by clears (flat `perClear` floor + per-square/combo), held for a GRACE window then gently decayed; `applyProgression()` ramps the ACTIVE segment's vox gain across `vocalBand` (0.35 s ramp). No hard cuts.
- [x] 3.4 Load the 8 ad-lib buffers; `playSfx(name,time,velocity?)` guarded; route `fire(ev)` through the preset (buffer/blip/both/nothing) AND bump both axes on clears.
- [x] 3.5 **Acceptance**: bed loops on unlock; vox stays silent until clears then rises + recedes on idle; segment steps forward on clears and holds on idle; missing buffer/segment falls back; nothing throws (e2e 0-errors).

## 4. Presets

- [x] 4.1 Add `audio/presets.ts`: `type AudioMix = 'A'|'B'|'C'` + a routing table mapping each `AudioEvent` type → `{ sfx?, blip?, riser? }` AND an unlock curve `{ bump, decay, thresholds }` per the D5/D2a spec. Rotate fires a sound in all three.
- [x] 4.2 Wire `setPreset(mix)` on the engine (instant, no teardown).
- [x] 4.3 **Acceptance**: unit tests assert (a) routing differences — A sparse (no ad-lib on move/rotate), B fires ad-libs on match + hardDrop + rotate, C fires an ad-lib on every action type, all three fire SOME sound on rotate; (b) curve differences — A's reveal is slower than C's for the same clears (A reaches a lower progression than C after N identical clears).

## 5. GameShell wiring (merged onto the visual-complete shell)

- [x] 5.1 Merge ONLY the audio wiring onto the current GameShell: engine + deriver refs, build-on-mount (skip in TEST_MODE), `unlock()` on Start, `deriver.derive(rs)` → `engine.fire(ev)` in the subscription, dispose on unmount, volume → engine master, mute the leftover `backing-track.mp3`. Do NOT alter the existing `<main>` / PlayingScreen / skin-chip layout.
- [x] 5.2 Add the mute toggle + an "Audio mix" `<select>` (A/B/C), persisted in its own localStorage key (`llmines.audioMix`, default 'B') — kept out of the visual `settings.ts` blob to avoid its schema-migration logic.
- [x] 5.3 **Acceptance**: visual-complete layout is byte-identical to base except the added audio controls; Start unlocks audio; switching the dropdown changes the mix without restarting; mute silences everything.

## 6. Headless proof (the thing that let the bug ship)

- [x] 6.1 Expose `getAudioState()` (progression, segmentIndex, maxSegmentReached, clearProgress, live `layerGains.{bed,vox}`) + mirror it on `window.__luminesProbe.audio`; add a `?audiodev=1` engine hook.
- [x] 6.2 Deterministic integration test (Tone mocked): drive real clears, ASSERT vox gain RISES, segment index STEPS FORWARD, idle RECEDES vox but not segment, and C advances faster than A.
- [x] 6.3 Live in-browser proof via `?audiodev=1`: measured seg 0→1→2→4→5 and vox 0→0.53→…→1.0 over 12 clears; idle holds segment, recedes vox; 0 console errors.

## 7. Verify + serve

- [x] 7.1 Run the full gate (task 0.3) + production-start e2e (task 0.1) green.
- [x] 7.2 Serve `next dev -H 0.0.0.0`, confirm 200 + Start works, leave running for the owner. (Port 3260 was wedged by a stale process from a prior session that this sandbox can't kill; served on 3261 instead.)
- [x] 7.3 Commit on `feat/audio-stems` (no push, no AI attribution).
