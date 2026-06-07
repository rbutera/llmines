## ADDED Requirements

### Requirement: Music volume slider with persisted 0.5 default

The game SHALL expose a music volume control. The initial music volume SHALL be `0.5`. The control SHALL be wired to the music output gain (the backing-track element's volume) so changing it changes loudness immediately. The volume SHALL be persisted alongside the other visual settings so a reload restores the last-set volume.

#### Scenario: Default volume is 0.5

- **WHEN** the default settings are read with no persisted value
- **THEN** the music volume is `0.5`

#### Scenario: Volume persists across reload

- **WHEN** the music volume is changed and the settings are saved then loaded
- **THEN** the loaded music volume equals the saved value
