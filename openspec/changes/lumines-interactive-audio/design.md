## Context

> **Revision (post-playtest):** the first cut used a single ~8-bar loop with four
> vertical stem layers and a per-beat progression decay. Playtest verdict: "the
> song never progresses." Two root causes were found and fixed (see D8), and the
> design pivoted from a single window to ORDERED SEGMENTS so clearing moves the
> song FORWARD through its sections (horizontal), with the vocal reveal as the
> vertical axis. The decisions below marked "(revised)" reflect the segment model.

The spike (`spike/procedural-audio` @ `4bc4222`) established the architecture: a `ProceduralAudioEngine` owning all Tone nodes + its own `Tone.Transport` (the master musical clock), and an `AudioEventDeriver` that diffs successive `RenderState`s into a small `AudioEvent` union. GameShell builds both on mount (skipped in `TEST_MODE`), unlocks the AudioContext on the Start gesture, and fires derived events on every RenderState emit. This is strictly additive: the deterministic core, RNG, scoring, and `window.__lumines` are untouched; the layer only SUBSCRIBES to fields the controller already emits.

The spike branched from `96902df` (the polish base) **before** the visual fixes on `feat/lumines-v2-complete` (`88615f9`) existed. So the spike's GameShell carries a STALE layout. We therefore port the audio *files* verbatim and hand-merge ONLY the audio wiring onto the visual-complete GameShell — never taking the spike's GameShell wholesale (that would regress the approved viewport/chrome/skin-chip fixes).

## Goals / Non-Goals

**Goals**
- Replace the synth bed with the real recorded instrumental loop; keep the synth bed as a fallback.
- Trigger real ad-lib SFX on game actions, beat-quantised and in-key.
- Three genuinely distinct, switchable presets so the owner can A/B.
- Zero risk to determinism / the Start path / the e2e guard.

**Non-Goals**
- Sample-accurate bed↔sweep lock. Two steady independent clocks, reconciled by being in-key + quantised.
- Vocals in the bed.
- Dynamic per-stem mixing at runtime (the bed is a single pre-summed file).

## Decisions

### D1 — Layered stems, not one summed bed (clearing advances the song)
The single most important feel is "base loop until you clear, then it builds." So instead of one pre-summed bed we ship FOUR phase-aligned stem loops and gate each upper layer's gain on clearing activity:
  - `bed-base.mp3` = Drums + Bass + Percussion — **always audible** (the steady groove).
  - `layer-melody.mp3` = Synth + Other — unlocks first (a few clears).
  - `layer-guitar.mp3` = Guitar — unlocks on sustained clearing / bigger combos.
  - `layer-vocal.mp3` = Lead + Backing Vocals — unlocks on a hot streak / big combo; recedes first when idle.
Each is its own `Tone.Player({ loop: true })` started at the SAME Transport time so they stay in phase (all four are identical-length loops cut from the same window). A per-layer `Tone.Gain` is ramped by a "song progression" value driven by the deriver. We keep 4 files (not 8 individual stems) to bound decode/payload while still giving a real multi-stage reveal.

### D1a — Window choice: all 8 stems active
The reveal needs every stem to have content in the loop window. An energy scan showed the fullest-energy *instrumental* window (bars 32–40) has guitar + backing-vocals SILENT. The **bar-8 window (17.143 s)** is the only 8-bar window where all 8 stems are simultaneously active, so all four layers carry real material. That is the source window for every loop.

### D2 — Seamless loop via crossfade-wrap (per layer, phase-matched)
An exact 8-bar cut (17.142857 s @ 112 BPM) clicks on loop (the window ends mid-waveform). We apply an equal-power 200 ms crossfade-wrap to EACH layer (fold the tail into the head, drop the folded tail). All four layers come out at the identical length 16.94 s with seam discontinuity 0–377 / 32768 (inaudible), so they loop in lock-step and stay phase-aligned. Built by a documented ffmpeg + Python recipe.

### D2a — Song-progression model (the unlock curve)
A scalar `progression ∈ [0,1]` is advanced by clearing and decays when idle:
  - line-clear bumps it by `base + squares + combo` (scaled per preset),
  - chain cascades bump it harder,
  - a per-beat decay pulls it down toward 0 when nothing is clearing.
Layer gains are step functions of `progression` with smooth ramps:
  - melody fades in across the low band, guitar across the mid band, vocals across the top band.
Ramps use `gain.rampTo(target, t)` (~a bar) so layers swell/recede smoothly, never hard-cut. Each preset supplies its own bump/decay/thresholds → different reveal curves (A slow/gentle, B responsive, C aggressive).

### D3 — Bed clock vs action clock
The `Tone.Player` bed loops on its own ~17 s period; the `Tone.Transport` runs at exactly 112 BPM and action notes quantise to its `@16n` grid. Bed and actions are phase-independent but both rock-steady, and every action note is drawn from the C#-minor scale, so they always sound intentional together. This is the spike's documented trade-off, carried forward.

### D4 — Ad-lib SFX as buffered one-shots, pitch-left-natural
The 8 chosen slices are trimmed (silence-removed), loudness-normalised (`-14 LUFS`, `-1 dB TP`), and short-fade-out so retriggers don't crackle. Loaded as `Tone.Player`s (or a `Tone.Players` pool) and triggered at the quantised action time. We do NOT pitch-shift them by default (they are vocal one-shots already in-key with C#m); a per-preset option can detune slightly, but the safe default is natural playback. Curated mapping:
  - `sfx-move`  ← bv-00 (tiny chirp)        → move
  - `sfx-rotate`← bv-05 (short chirp)        → rotate (must sound)
  - `sfx-lock`  ← bv-10 (punchy)             → lock / settle
  - `sfx-match` ← bv-09 (stab)               → line-clear / match
  - `sfx-softdrop` ← bv-21                    → soft-drop step
  - `sfx-harddrop` ← bv-29 (loud)            → hard-drop slam
  - `sfx-gem`   ← bv-11 (characterful, 0.9 s)→ gem clear
  - `sfx-chain` ← bv-22 (loud, 0.9 s)        → chain cascade

### D5 — Presets as a routing table + an unlock curve, not three engines
One engine; a `preset` selects (a) a routing table deciding per `AudioEvent` type which voices fire (ad-lib buffer, procedural blip, both, or nothing) and (b) the layer-unlock curve (progression bump/decay/thresholds, D2a). This keeps the three mixes in one tested place and makes A/B switching instant (no teardown). Presets:
  - **A Subtle**: SLOW/gentle layer reveal (small bumps, slow decay, high thresholds); ad-libs on lineClear/gem/chain only; move/rotate/softDrop/lock = light procedural blips; no riser.
  - **B Reactive**: RESPONSIVE reveal (medium bumps, quicker decay so it tracks momentum) + intensity-reactive filter; ad-libs on match (lineClear) + hardDrop + chain; rotate = soft ad-lib; move/softDrop = procedural blips.
  - **C Maximal**: AGGRESSIVE reveal (big bumps, full mix on a hot streak); ad-libs on EVERY action + procedural blips layered; chain risers on.
All three play the layered recorded bed by default; a `useProceduralBed` fallback swaps to the synth bed if the layer files fail to load.

### D6 — Failure degrades to silence
Every Tone call stays guarded (try/catch swallow) exactly as the spike established. Buffer load failures fall back: missing ad-lib → procedural blip; missing bed → procedural bed. The production-start e2e asserts 0 page errors, so no audio path may throw.

### D7 — Persistence + UI
`audioMix` ('A'|'B'|'C') and `muted` persist (own `llmines.audioMix` localStorage key, defaults to 'B'). A small "Audio mix" `<select>` sits with the mute toggle. `TEST_MODE` builds none of this (suite stays observationally identical).

### D8 (revised) — Why the first cut "never progressed", and the segment pivot
Playtest: the song didn't advance. Root causes:
  1. **Decay outran sparse clears.** A per-quarter-note decay ran ~1.9×/s while real clears are seconds apart; between two clears decay removed more than one clear added, so progression never accumulated. **Fix:** a post-clear GRACE window (hold ~6 beats before decay resumes) + a flat `perClear` floor so every clear steps audibly + a short layer-gain ramp (0.35s) so the audible gain TRACKS progression instead of crawling behind a constantly-restarted 1.2s ramp.
  2. **Vertical-only doesn't read as "the song progressing."** Even fixed, fading gain on one looped window isn't what the owner meant — they want the song to move FORWARD through its structure. **Fix:** cut the track into SIX ordered segments (sequential 8-bar windows, all stems active from bar 0; bar-0 window confirmed to carry every stem). Each segment = a `bed` + `vox` loop, all phase-aligned (identical length, crossfade-wrapped). A monotonic `clearProgress` accumulator (`1 + squares + combo` per clear; `2 + size` per chain) crosses `clearsPerSegment` to step the active segment; segment beds crossfade on the next bar (`@1m`). The vertical vox reveal now operates WITHIN the active segment. Idle decays the vox but never the segment.

### D9 — Headless verifiability (the thing that let the bug ship)
The mechanic shipped broken because nothing measured it (the e2e runs in TEST_MODE where audio is off). Now: the engine exposes `getAudioState()` (progression, segmentIndex, maxSegmentReached, clearProgress, live `layerGains.{bed,vox}` read from the actual audio params); GameShell mirrors it on `window.__luminesProbe.audio`. A deterministic integration test mocks Tone (gains apply ramp targets immediately; the beat loop is pumpable) and drives real clears, ASSERTING segment-advance + vox-rise + idle-recede + "C faster than A". A `?audiodev=1` URL hook exposes the engine so the same is provable live in the browser (used to capture the proof numbers).

## Risks / Trade-offs

- **Headless ear-gap**: built on a headless box; the seam math + levels are verified numerically, but final feel (esp. ad-lib pitch-against-bed and per-preset balance) is owner-verified in the morning. Mitigated by 3 presets + mute + volume slider.
- **Bed not bar-locked to sweep**: accepted (D3). In-key + quantised keeps it coherent.
- **MP3-only assets**: universal browser support; no ogg encoder available locally. Acceptable for a personal game.

## Migration Plan

Additive only. New files + assets + a `tone` dep. GameShell gains audio refs/effects merged around the existing structure. No existing test changes except added coverage. Rollback = revert the branch; the game returns to the silent visual-complete state.
