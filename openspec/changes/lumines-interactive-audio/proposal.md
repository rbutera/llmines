## Why

LLMines V2 is visually complete but mostly silent: the only audio is a leftover full-song `backing-track.mp3` that loops in the DOM and a placeholder synth spike on a side branch. A prior exploratory spike (`spike/procedural-audio`) proved the *shape* of an interactive-audio layer (a render-only Tone.js event-subscriber that turns RenderState diffs into in-key, beat-quantised notes) without touching the deterministic core or the `window.__lumines` seam. That spike used 100% synthesised sound.

We now have the real material: the game's actual soundtrack ("Especifico Primero", C#m, ~112 BPM) split into instrument stems, plus 43 pre-sliced backing-vocal ad-lib one-shots. This change upgrades the spike from synth-only to the **real recorded bed + real ad-lib SFX**, and adds **selectable audio-mix presets** so the owner can A/B the feel and pick one.

## What Changes

- **Port the validated procedural engine** (`audio/procedural/{engine,events,scale}.ts` + the GameShell wiring) from the spike onto the visual-complete base, taking ONLY the audio code (not the spike's stale, pre-visual-fix layout).
- **Clearing advances the song (the heart of the feature)**: instead of one summed bed, the soundtrack is split into FOUR phase-aligned, seamless ~8-bar stem loops that all play in lock-step: `bed-base` (Drums+Bass+Percussion, always audible) plus three unlockable LAYERS — `layer-melody` (Synth+Other), `layer-guitar`, `layer-vocal` (Lead+Backing vocals). Each layer's gain is gated on the player's clearing activity (cumulative clears / combo / recent-clear momentum): clear more and the song UNFOLDS layer by layer; go idle and the upper layers recede back toward just the bed. Gains move on smooth ramps landing on bar-ish boundaries, never hard cuts. The procedural synth bed stays available as a fallback if the stem files fail to load.
- **Real ad-lib SFX**: 8 curated, trimmed, normalised backing-vocal slices in `public/audio/sfx-*.mp3`, loaded as buffers and triggered on game ACTIONS (move, rotate, soft-drop, lock, match/line-clear, hard-drop, gem-clear, chain), beat-quantised to `@16n`. They replace / layer over the synth blips depending on the preset.
- **Three selectable presets** ("Audio mix" A/B/C), genuinely distinct — each with its own layer-unlock CURVE and ad-lib density:
  - **A — Subtle**: gentle, slow layer reveal (clears unlock layers slowly, recede gently); ad-libs only on big events (clear, gem, chain); move/rotate stay light procedural blips.
  - **B — Reactive**: faster, more responsive reveal (layers swell with combos, snap back when idle); intensity-reactive filter; ad-libs on every match + hard-drop; rotate gets a soft ad-lib.
  - **C — Maximal**: aggressive reveal (full mix on a hot streak); ad-libs heavy on every action + procedural blips layered + chain risers.
- **Preset switch** surfaced as a settings dropdown, persisted with the other settings. Mute toggle retained.
- **Rotate must make a sound** (owner requirement) in every preset.

## Non-goals

- No change to the deterministic core, RNG order, scoring, the `window.__lumines` seam, or the production Start flow. The existing `e2e/production-start.spec.ts` stays green.
- No sample-locking the bed to the visual sweep bar (documented trade-off carried over from the spike: two independent steady tempos, in-key + quantised so they cohere).
- No vocals in the bed (lead/backing vocal stems are excluded; only the instrumental sum).

## Impact

- **Code**: `audio/procedural/{engine,events,scale}.ts` (ported + extended: layered `Tone.Player` stem bed, clear-gated layer gains, buffered ad-lib SFX, preset routing), `audio/presets.ts` (new), `react/GameShell.tsx` (audio wiring merged onto the visual-complete shell: engine refs, event firing, mute toggle, preset dropdown), `render3d/settings.ts` (persist `audioMix`), `package.json` (`tone`).
- **Assets**: `public/audio/{bed-base,layer-melody,layer-guitar,layer-vocal}.mp3` (4 phase-aligned stem loops) + `public/audio/sfx-*.mp3` (8 ad-libs), all built from the owner's stems.
- **Tests**: unit tests for the event deriver (RenderState diff -> events), the scale helpers, and preset routing (which events fire which voices per preset). Production-start e2e stays green.
- **Determinism**: unchanged. Everything is a render-only subscriber, SSR-safe, fully guarded so audio failure degrades to silence and never throws into the page (the e2e asserts 0 page errors).
