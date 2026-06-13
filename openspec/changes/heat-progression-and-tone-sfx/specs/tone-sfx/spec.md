## ADDED Requirements

### Requirement: Synthesised in-key tone SFX engine

The engine SHALL provide a synthesised tone SFX path that plays short notes drawn from the active
song's musical key/scale, so action sounds never clash with the backing. The tone synth SHALL be
constructed lazily inside the unlock user gesture (or on first tone-SFX use), NEVER at module
evaluation, so strict-autoplay browsers are not blocked. Tone notes SHALL be subtle (low velocity,
short duration). A tone-SFX failure SHALL degrade to silence and SHALL NEVER throw into the game.

#### Scenario: Tones play notes from the song's key

- **WHEN** a tone SFX fires for the active song
- **THEN** the note played is a member of the song's key/scale note set

#### Scenario: The tone synth is not constructed at module load

- **WHEN** the engine module is imported before any user gesture
- **THEN** no AudioContext and no tone synth is constructed (construction happens inside unlock / first use)

#### Scenario: A tone-SFX failure degrades to silence

- **WHEN** the tone synth is unavailable or throws while playing a tone
- **THEN** the engine plays nothing and does not throw

### Requirement: SFX mode selector defaulting to tone

The engine SHALL expose an SFX-mode selector with values `"tone"` and `"sample"`, defaulting to
`"tone"`. In `"tone"` mode actions route to synthesised in-key tones. In `"sample"` mode actions
route to the existing recorded per-segment sample path, which SHALL remain available unchanged;
the `match` event in sample mode SHALL reuse the existing `stageVelocityForSquares(squares)`
velocity for the recorded `stage` sample, keeping perceptual parity with the prior clear-stage
routing. The mode SHALL be switchable at runtime.

#### Scenario: Default mode is tone

- **WHEN** the engine starts with no explicit mode set
- **THEN** the SFX mode is `"tone"`

#### Scenario: Sample mode uses the recorded per-segment path

- **WHEN** the SFX mode is set to `"sample"`
- **THEN** actions route to the recorded per-segment samples (resolved segment then song-level then silence), unchanged from the prior behaviour

#### Scenario: Mode can be switched at runtime

- **WHEN** the SFX mode is changed from `"tone"` to `"sample"` (or back) during play
- **THEN** subsequent actions route under the newly selected mode

### Requirement: The sweep clear is silent and forming a match dings

The sweep CLEAR (a completed sweep pass that erases squares) SHALL be silent. Forming a 2x2 match
(a square newly formed and staged for clear) SHALL emit a NEW `match` event that plays a short
in-key "ding". The `match` event SHALL be derived from the render-only distinct-staged-square
COUNT (`markedSquares`) RISING versus the previous frame, on ANY frame; it SHALL NOT be gated on
the lock id (`lastLock.id`), because a square formed by a post-clear gravity cascade does not bump
the lock id and would otherwise be missed. A DECREASE in the staged-square count (squares erased
by the sweep) SHALL emit nothing (the clear stays silent). The `match` event SHALL be distinct
from the sweep clear and SHALL NOT be derived from the sweep pass-completion telemetry. The match
ding SHALL be brighter for a larger newly-formed square (the positive count delta).

#### Scenario: A completed sweep clear plays no sound

- **WHEN** a sweep pass completes and erases one or more squares (the staged-square count decreases)
- **THEN** no SFX is played for the clear (the clear is silent), while heat is still fed

#### Scenario: Staging a square dings

- **WHEN** the distinct count of staged (marked) squares increases versus the previous frame
- **THEN** a `match` event is emitted and a short in-key ding is played

#### Scenario: A square formed by a post-clear cascade (no piece lock) still dings

- **WHEN** a post-clear gravity cascade forms a new completed square so the staged-square count rises WITHOUT any new piece lock (the lock id does not advance)
- **THEN** a `match` event is still emitted and the ding plays (the derivation keys off the rising count, not the lock id)

#### Scenario: The match ding is not tied to the sweep

- **WHEN** the sweep later erases the staged square (the count decreases)
- **THEN** no additional `match` ding is emitted by the erase (the ding fired only on the count rise)

#### Scenario: A bigger newly-formed square dings brighter

- **WHEN** a frame's staged-square count rises by a larger delta than a previous rise
- **THEN** the match ding is played at a higher velocity / brighter pitch nudge

### Requirement: Subtle in-key tones for rotate and drop, silent move and chain

In tone mode, rotate and soft-drop and lock (drop/settle) SHALL each play a distinct subtle in-key
tone, and move SHALL be silent. A chain (a gem flood at sweep time — a clear) SHALL be SILENT in
tone mode, like the sweep clear: clearing makes no noise; only forming a MATCH dings. (Heat is
still fed by the chain.) Velocities SHALL be subtle relative to the music-led mix.

#### Scenario: Rotate plays a subtle in-key tone

- **WHEN** the active piece rotates in tone mode
- **THEN** a subtle in-key tone is played for the rotate

#### Scenario: Move is silent

- **WHEN** the active piece moves left or right
- **THEN** no SFX is played

#### Scenario: Drops play subtle in-key tones

- **WHEN** a soft-drop step or a lock/settle occurs in tone mode
- **THEN** a subtle in-key tone is played, scaled by the settle cause for a lock

#### Scenario: A chain is silent in tone mode

- **WHEN** a chain (gem flood) clears in tone mode
- **THEN** no SFX is played for the chain (it is a clear; only forming a match dings), while heat is still fed

### Requirement: Manifest carries an optional song key and scale

The manifest SHALL allow each song to declare an optional `key` of a root note and scale (e.g.
`{ root: "A", scale: "minor" }`). When absent, the engine SHALL apply a sensible default key
(`{ root: "A", scale: "minor" }`) so tones still play in a coherent key. The tone palette SHALL be
built from the resolved key/scale. The per-song `key` values SHALL be authored in the manifest
BEFORE the tone ear-check, so the first ear-check is on the real per-song keys rather than the
default placeholder.

#### Scenario: A song with an explicit key uses it

- **WHEN** a song declares `key: { root, scale }` in the manifest
- **THEN** the tone palette is built from that root and scale

#### Scenario: A song without a key uses the default

- **WHEN** a song has no `key` field
- **THEN** the engine applies the default key and tones still play in a coherent key
