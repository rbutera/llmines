## ADDED Requirements

### Requirement: Render-only interactive-audio layer
The game SHALL play interactive audio derived purely from the already-emitted `RenderState`, without modifying the deterministic core, RNG order, scoring, or the `window.__lumines` test seam. The audio layer SHALL be built only outside `TEST_MODE` and SHALL be SSR-safe (no audio API touched before a user gesture).

#### Scenario: Audio never alters game behaviour
- **WHEN** the audio layer is active during play
- **THEN** the sequence of `RenderState`s, scores, and `window.__lumines` shape are identical to a run with audio disabled

#### Scenario: Audio failure degrades to silence
- **WHEN** the AudioContext is blocked, or a bed/SFX asset fails to load, or a Tone trigger throws
- **THEN** the game continues normally and no error surfaces to the page (0 console/page errors)

### Requirement: Segmented recorded bed
The game SHALL play the soundtrack as a sequence of ordered ~8-bar SEGMENTS (sections of the real track), each with an instrumental `bed` loop and a `vox` loop. All segments SHALL be phase-aligned and started on the Start gesture synced to a 112 BPM transport; only the active segment SHALL be audible. A procedural synth bed SHALL remain available as a fallback when the recorded segments fail to load.

#### Scenario: A segment loops without an audible seam
- **WHEN** a recorded segment loop reaches its loop point
- **THEN** it repeats without a click (seam reduced to near-zero by a crossfade-wrap) and stays phase-aligned with the other segments

#### Scenario: Bed fallback
- **WHEN** the recorded segment files cannot be loaded
- **THEN** the procedural synth bed plays instead and the game is unaffected

### Requirement: Clearing advances the song (horizontal + vertical)
Cumulative clearing activity SHALL step the active SEGMENT forward through the song's sections (new material plays), and the advance SHALL be monotonic (idle never rewinds it). Independently, within the active segment the VOX layer SHALL fade in as recent clearing builds and recede when the player goes idle. All gain changes SHALL use smooth ramps, never hard cuts. Both the advance threshold and the vox reveal curve SHALL differ per preset (gentle for A, responsive for B, aggressive for C). The current segment index, progression, and live layer gains SHALL be observable for verification.

#### Scenario: Clearing steps the song forward through segments
- **WHEN** the player accumulates clears
- **THEN** the active segment index advances (1 → 2 → 3 …) so new musical material plays, crossfaded on a bar boundary

#### Scenario: Clearing reveals the vocal within a segment
- **WHEN** the player clears squares
- **THEN** the active segment's vox layer fades up and is clearly audible after a few clears (not subtle)

#### Scenario: Idle recedes the vocal but NOT the segment
- **WHEN** the player stops clearing for a sustained period
- **THEN** the vox layer fades back down, while the segment index stays where the player reached (the song does not rewind)

#### Scenario: Advance + reveal speed differ by preset
- **WHEN** the same number of clears occurs under preset A vs preset C
- **THEN** C reaches a later segment AND reveals more vox than A for the same clears

### Requirement: Ad-lib action SFX
The game SHALL trigger curated, recorded backing-vocal one-shots on game actions (move, rotate, soft-drop, lock, line-clear/match, hard-drop, gem-clear, chain), beat-quantised to the transport's 16th-note grid, and in key with the C#-minor bed.

#### Scenario: Rotate always sounds
- **WHEN** the player rotates the active piece in any preset
- **THEN** a sound is produced (an ad-lib or a procedural blip, per preset)

#### Scenario: Missing SFX falls back
- **WHEN** a mapped ad-lib buffer is unavailable
- **THEN** a procedural blip plays in its place

### Requirement: Selectable audio-mix presets
The game SHALL offer three selectable, persisted audio-mix presets (A Subtle, B Reactive, C Maximal) that are genuinely distinct in which voices fire per action and how reactive the mix is. The default SHALL be B. Switching SHALL take effect immediately without restarting audio.

#### Scenario: Presets differ
- **WHEN** the same action occurs under preset A vs preset C
- **THEN** A produces fewer/sparser voices (no ad-lib on move/rotate) and C layers an ad-lib plus a procedural blip

#### Scenario: Preset persists
- **WHEN** the player selects a preset and reloads
- **THEN** the selected preset is restored from settings

### Requirement: Mute and volume
The game SHALL provide a mute toggle and a music-volume control that govern the interactive-audio master gain; the leftover full-song backing track SHALL be silenced so only the interactive layer is heard.

#### Scenario: Mute silences all audio
- **WHEN** the player toggles mute on
- **THEN** the bed and all SFX are silenced and toggling off restores them
