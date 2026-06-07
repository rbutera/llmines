## 0. Global acceptance (the green-but-broken guard)

- [x] 0.1 **Production Start still works**: the production-start e2e is GREEN — clicking Start spawns a piece, the sweep advances, camera zoom stays positive, 0 console/page errors. No audio path throws.
- [x] 0.2 **Deterministic core + seam unchanged**: `core/**` imports no time/DOM/audio; `window.__lumines` keeps its exact shape; determinism + purity + scoring suites stay green. Audio is build-skipped in `TEST_MODE`.
- [x] 0.3 **Full gate green**: `npx vitest run` green (incl. new tests); `npx tsc --noEmit` clean (baseUrl deprecation excepted); real `eslint` exit 0; `npx next build` succeeds.

## 1. Assets (built from the owner's stems)

- [x] 1.1 Build FOUR phase-aligned stem loops over the bar-8 window (all stems active): `bed-base` (Drums+Bass+Perc), `layer-melody` (Synth+Other), `layer-guitar`, `layer-vocal` (Lead+Backing). dynaudnorm + 200 ms equal-power crossfade-wrap per layer; identical length (16.94 s) so they loop in lock-step; seam discontinuity near-zero (verified 0–377/32768).
- [x] 1.2 Build 8 `public/audio/sfx-*.mp3`: trim + loudness-normalise + short fade-out the curated ad-lib slices per the D4 mapping.

## 2. Port the validated engine

- [x] 2.1 Copy `audio/procedural/{engine,events,scale}.ts` + their tests from `spike/procedural-audio` onto this branch (audio files ONLY — not the spike's stale GameShell layout).
- [x] 2.2 Add `tone` to `package.json` + lockfile (pnpm).
- [x] 2.3 **Acceptance**: `scale.test.ts` + `events.test.ts` pass unchanged (the deriver fields match the visual-complete RenderState).

## 3. Layered recorded bed + ad-lib SFX in the engine

- [x] 3.1 Add four `Tone.Player`s (bed-base + 3 layers), each `loop: true`, started at the SAME Transport time at 112 BPM so they stay phase-aligned. Each upper layer routes through its own `Tone.Gain` (starts at 0). Keep the synth bed behind a `useProceduralBed` fallback used when the layer files fail to load.
- [x] 3.2 Add the song-progression model: a `progression` scalar bumped by clears/combos/chains and decayed per beat (per-preset curve); `applyProgression()` ramps each layer gain (melody/guitar/vocal) smoothly across its unlock band so clearing reveals the song and idling recedes it. No hard cuts.
- [x] 3.3 Load the 8 ad-lib buffers (`Tone.Players` pool); add a `playSfx(name, time, velocity?)` that triggers a buffer at the quantised time, guarded.
- [x] 3.4 Route `fire(ev)` through the active preset table (task 4) so each event plays buffer / blip / both / nothing AND bumps progression.
- [x] 3.5 **Acceptance**: bed-base loops on unlock; upper layers stay near-silent until clears, fade in as clears accumulate, recede when idle; each action fires its mapped SFX; a missing buffer/layer falls back (blip / procedural bed); nothing throws (e2e 0-errors).

## 4. Presets

- [x] 4.1 Add `audio/presets.ts`: `type AudioMix = 'A'|'B'|'C'` + a routing table mapping each `AudioEvent` type → `{ sfx?, blip?, riser? }` AND an unlock curve `{ bump, decay, thresholds }` per the D5/D2a spec. Rotate fires a sound in all three.
- [x] 4.2 Wire `setPreset(mix)` on the engine (instant, no teardown).
- [x] 4.3 **Acceptance**: unit tests assert (a) routing differences — A sparse (no ad-lib on move/rotate), B fires ad-libs on match + hardDrop + rotate, C fires an ad-lib on every action type, all three fire SOME sound on rotate; (b) curve differences — A's reveal is slower than C's for the same clears (A reaches a lower progression than C after N identical clears).

## 5. GameShell wiring (merged onto the visual-complete shell)

- [x] 5.1 Merge ONLY the audio wiring onto the current GameShell: engine + deriver refs, build-on-mount (skip in TEST_MODE), `unlock()` on Start, `deriver.derive(rs)` → `engine.fire(ev)` in the subscription, dispose on unmount, volume → engine master, mute the leftover `backing-track.mp3`. Do NOT alter the existing `<main>` / PlayingScreen / skin-chip layout.
- [x] 5.2 Add the mute toggle + an "Audio mix" `<select>` (A/B/C), persisted in its own localStorage key (`llmines.audioMix`, default 'B') — kept out of the visual `settings.ts` blob to avoid its schema-migration logic.
- [x] 5.3 **Acceptance**: visual-complete layout is byte-identical to base except the added audio controls; Start unlocks audio; switching the dropdown changes the mix without restarting; mute silences everything.

## 6. Verify + serve

- [x] 6.1 Run the full gate (task 0.3) + production-start e2e (task 0.1) green.
- [x] 6.2 Serve `next dev -p 3260 -H 0.0.0.0`, confirm 200 + Start works, leave running for the owner.
- [x] 6.3 Commit on `feat/audio-stems` (no push, no AI attribution).
