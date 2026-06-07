## ADDED Requirements

### Requirement: Render-only interactive-audio layer
The game SHALL play interactive audio derived purely from the already-emitted `RenderState`, without modifying the deterministic core, RNG order, scoring, or the `window.__lumines` test seam. The audio layer SHALL be built only outside `TEST_MODE` and SHALL be SSR-safe (no audio API touched before a user gesture).

#### Scenario: Audio never alters game behaviour
- **WHEN** the audio layer is active during play
- **THEN** the sequence of `RenderState`s, scores, and `window.__lumines` shape are identical to a run with audio disabled

#### Scenario: Audio failure degrades to silence
- **WHEN** the AudioContext is blocked, or a bed/SFX asset fails to load, or a Tone trigger throws
- **THEN** the game continues normally and no error surfaces to the page (0 console/page errors)

### Requirement: Layered recorded bed
The game SHALL play a base instrumental loop (drums + bass + percussion) built from the soundtrack's stems, started on the Start gesture and synced to a 112 BPM transport. Three further stem layers (melody, guitar, vocals) SHALL play in phase with the base loop, each through its own gain. A procedural synth bed SHALL remain available as a fallback when the recorded layers fail to load.

#### Scenario: Base bed loops without an audible seam
- **WHEN** any recorded layer reaches its loop point
- **THEN** it repeats without a click (seam discontinuity reduced to near-zero by a crossfade-wrap) and stays phase-aligned with the other layers

#### Scenario: Bed fallback
- **WHEN** the recorded layer files cannot be loaded
- **THEN** the procedural synth bed plays instead and the game is unaffected

### Requirement: Clearing advances the song
The upper stem layers (melody, guitar, vocals) SHALL start muted and fade in progressively as the player clears squares, and SHALL recede back toward the base bed when the player goes idle. Gain changes SHALL use smooth ramps, never hard cuts. The reveal curve SHALL differ per preset (gentle/slow for A, responsive for B, aggressive for C).

#### Scenario: Clearing reveals layers
- **WHEN** the player clears squares and sustains a combo
- **THEN** melody fades in first, then guitar, then vocals on a hot streak, building toward the full mix

#### Scenario: Idle recedes layers
- **WHEN** the player stops clearing for a sustained period
- **THEN** the upper layers fade back down toward just the base bed

#### Scenario: Reveal speed differs by preset
- **WHEN** the same number of clears occurs under preset A vs preset C
- **THEN** A reveals less of the song (lower progression) than C

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
