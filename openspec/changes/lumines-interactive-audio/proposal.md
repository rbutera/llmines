## Why

LLMines V2 is visually complete but mostly silent: the only audio is a leftover full-song `backing-track.mp3` that loops in the DOM and a placeholder synth spike on a side branch. A prior exploratory spike (`spike/procedural-audio`) proved the *shape* of an interactive-audio layer (a render-only Tone.js event-subscriber that turns RenderState diffs into in-key, beat-quantised notes) without touching the deterministic core or the `window.__lumines` seam. That spike used 100% synthesised sound.

We now have the real material: the game's actual soundtrack ("Especifico Primero", C#m, ~112 BPM) split into instrument stems, plus 43 pre-sliced backing-vocal ad-lib one-shots. This change upgrades the spike from synth-only to the **real recorded bed + real ad-lib SFX**, and adds **selectable audio-mix presets** so the owner can A/B the feel and pick one.

## What Changes

- **Port the validated procedural engine** (`audio/procedural/{engine,events,scale}.ts` + the GameShell wiring) from the spike onto the visual-complete base, taking ONLY the audio code (not the spike's stale, pre-visual-fix layout).
- **Clearing advances the song (the heart of the feature)** — TWO axes:
  - **HORIZONTAL segment advance (the key mechanic):** the song is cut into SIX ordered ~8-bar segments from sequential sections of the real track (intro → verse → build → hook → …), each with a `seg{i}-bed` (instrumental) and `seg{i}-vox` (vocals) loop. All segments are phase-aligned and loop in lock-step; only the active one is audible. Cumulative clearing activity steps the active segment FORWARD (1→2→3…), so NEW musical material plays — the song moves through its structure instead of repeating one window. Segment→segment is crossfaded on a bar boundary. Monotonic: idle never rewinds the song.
  - **VERTICAL reveal:** within the active segment, the VOX layer fades in as recent clearing builds a `progression` scalar, and recedes when the player goes idle. Smooth ramps, never hard cuts.
  - The procedural synth bed stays available as a fallback if the segment files fail to load.
- **Real ad-lib SFX**: 8 curated, trimmed, normalised backing-vocal slices in `public/audio/sfx-*.mp3`, loaded as buffers and triggered on game ACTIONS (move, rotate, soft-drop, lock, match/line-clear, hard-drop, gem-clear, chain), beat-quantised to `@16n`. They replace / layer over the synth blips depending on the preset.
- **Three selectable presets** ("Audio mix" A/B/C), genuinely distinct — each with its own reveal CURVE, segment-advance threshold, and ad-lib density:
  - **A — Subtle**: gentle, slow reveal + gentler segment advance; ad-libs only on big events (clear, gem, chain); move/rotate stay light procedural blips.
  - **B — Reactive**: responsive reveal + faster segment advance (crosses several sections in the first minute of play); intensity-reactive filter; ad-libs on every match + hard-drop; rotate gets a soft ad-lib.
  - **C — Maximal**: aggressive reveal + fastest segment advance; ad-libs heavy on every action + procedural blips layered + chain risers.
- **Headless-verifiable**: the live test probe (`window.__luminesProbe.audio`) exposes `segmentIndex` / `maxSegmentReached` / `clearProgress` / `progression` / `layerGains.{bed,vox}`. A deterministic integration test (Tone mocked) drives real clears and ASSERTS the segment advances + the vox gain rises + idle recedes (segment does not rewind). A `?audiodev=1` URL hook exposes the engine so the same can be proven live in the browser.
- **Preset switch** surfaced as a settings dropdown, persisted with the other settings. Mute toggle retained.
- **Rotate must make a sound** (owner requirement) in every preset.

## Non-goals

- No change to the deterministic core, RNG order, scoring, the `window.__lumines` seam, or the production Start flow. The existing `e2e/production-start.spec.ts` stays green.
- No sample-locking the bed to the visual sweep bar (documented trade-off carried over from the spike: two independent steady tempos, in-key + quantised so they cohere).
- No structural ML analysis to find section boundaries: segments are sequential 8-bar windows (a pragmatic cut), not detected verse/chorus edges.

## Impact

- **Code**: `audio/procedural/{engine,events,scale}.ts` (ported + extended: ordered segment players, horizontal segment advance + crossfade, clear-gated vox reveal, buffered ad-lib SFX, preset routing, `getAudioState()` probe), `audio/presets.ts` (new), `react/GameShell.tsx` (audio wiring + `__luminesProbe.audio` + `?audiodev=1` hook), `package.json` (`tone`).
- **Assets**: `public/audio/seg{0..5}-{bed,vox}.mp3` (12 phase-aligned segment loops) + `public/audio/sfx-*.mp3` (8 ad-libs), all built from the owner's stems.
- **Tests**: unit tests for the deriver, scale helpers, preset routing + curve; a deterministic INTEGRATION test (Tone mocked) that drives clears and asserts segment-advance + vox-rise + idle-recede. Production-start e2e stays green.
- **Determinism**: unchanged. Everything is a render-only subscriber, SSR-safe, fully guarded so audio failure degrades to silence and never throws into the page (the e2e asserts 0 page errors).
