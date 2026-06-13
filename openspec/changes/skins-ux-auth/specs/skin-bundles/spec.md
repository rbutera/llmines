## ADDED Requirements

### Requirement: Single skin definition

A skin SHALL be exactly one bundle that ties together a stable identity, a colour world, and a soundtrack. The bundle MUST carry: an `id`, a human-readable `label`, a `track` (the soundtrack, resolving to a song in the audio manifest), a `board` palette (the 3D viewport colours), a `chrome` palette (the DOM frame colours), and a `tempo` in BPM. There SHALL be exactly one skin type and one ordered skin list in the codebase; the separate core skin list (BPM/visual-theme skins at 120/144/168 BPM) and its per-squares advancement MUST NOT exist.

#### Scenario: The skin bundle is the only skin definition
- **WHEN** the codebase is built
- **THEN** the only `Skin` type and ordered `SKINS` list are the host bundle (colour world + soundtrack + tempo)
- **AND** there is no core skin list, no `skinAt`/`skinBpm` core helper, and no `advanceSkin` squares-based progression

#### Scenario: GameState carries no skin progression fields
- **WHEN** a `GameState` is inspected
- **THEN** it has no `skinIndex` and no `clearsInSkin` field
- **AND** the sweep core does not advance any skin counter on clears

#### Scenario: Each skin's tempo matches its track's manifest tempo
- **WHEN** each skin in the ordered list is checked against the audio manifest
- **THEN** the skin's `tempo` equals the manifest `tempo` of the song its `track` resolves to (song1 ≈ 109.957, song2 ≈ 126.05)

### Requirement: Sweep speed equals the active skin's track tempo

The timeline sweep SHALL advance at the active skin's track tempo (the manifest BPM), so the bar is in time with the audible music. The tempo MUST be latched at pass boundaries: a tempo change applies only from the next full traversal (sweep position 0), never mid-pass. The controller MUST receive the tempo as a plain number through a tempo seam and MUST NOT import the audio engine.

#### Scenario: The sweep runs at the playing song's BPM
- **WHEN** the active skin's track plays at tempo T BPM
- **THEN** the sweep advances one column per eighth-note at T BPM (a full 16-column pass = two 4/4 bars at T)

#### Scenario: A tempo change is latched at the next pass boundary
- **WHEN** the skin (and therefore the tempo) changes mid-pass
- **THEN** the sweep keeps the current tempo until the bar wraps to position 0
- **AND** the new tempo takes effect from the following pass, with no discontinuous jump in bar position

#### Scenario: The HUD tempo readout reflects the sweep tempo
- **WHEN** the in-play HUD shows the BPM
- **THEN** the displayed BPM equals the controller's current latched sweep tempo (the active track tempo), not a core-skin BPM

### Requirement: Skin advances only on song completion

Skin progression SHALL be driven only by the song completing (the audio engine's song-complete signal). There MUST be no other advancement trigger; in particular, clearing squares MUST NOT advance the skin. When a song completes, the game SHALL advance to the next skin in order, crossfading both the colour world and the soundtrack in lock step. After the last skin, the progression SHALL wrap to the first skin so the two songs cycle endlessly.

#### Scenario: Song completion advances the skin
- **WHEN** the audio engine signals the current song has played past its terminal segment
- **THEN** the game advances to the next skin in the ordered list
- **AND** the colour world and the soundtrack crossfade to that skin together

#### Scenario: Clearing squares never advances the skin
- **WHEN** the player clears any number of squares without the song completing
- **THEN** the skin does not change and the colour world does not change

#### Scenario: The last skin wraps to the first
- **WHEN** the last skin's song completes
- **THEN** the game advances to the first skin (the songs cycle endlessly)

### Requirement: Restart resets to the base skin

Restarting a game, and starting a new game after game over, SHALL reset the active skin to the first skin in the ordered list (the base skin). The previously chosen or reached skin MUST NOT carry across runs. The chosen skin MUST NOT be persisted to localStorage (the persistence is removed).

#### Scenario: Restart from game over starts on the base skin
- **WHEN** the player chooses PLAY AGAIN after game over while a later skin was active
- **THEN** the new game starts on the first (base) skin, with its colour world and its soundtrack

#### Scenario: No skin is persisted across sessions
- **WHEN** the player reaches a later skin and then reloads the page
- **THEN** the game loads on the base skin
- **AND** no skin id is written to or read from localStorage

### Requirement: No skin toggle control

There SHALL be no player-facing skin toggle. The skin-cycle button(s) and the skin-switch hotkey (the "N" key) MUST be removed from every phase (start, play, pause). The skin-switch hook SHALL expose only programmatic transitions: advance-to-next (used solely by song completion) and reset-to-base (used by restart / new game).

#### Scenario: No skin button exists in any phase
- **WHEN** the start screen, in-play HUD, or pause overlay is shown
- **THEN** there is no control that cycles or selects the skin

#### Scenario: The N key does nothing
- **WHEN** the player presses "n" or "N" during play or on the start screen
- **THEN** the skin does not change
