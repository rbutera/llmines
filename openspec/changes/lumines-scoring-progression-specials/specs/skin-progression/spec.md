## ADDED Requirements

### Requirement: Progression modelled as ordered skin data

Progression SHALL be modelled as an ordered list of **skins**, each defined as `{ id, blockPalette, visualTheme, bpm, timeSignature }` (audio fields are added by a later audio change). The game SHALL ship at least 2-3 skins to demonstrate transition. Tempo SHALL come from skin data, not a standalone level counter.

#### Scenario: Skins are an ordered list with BPM

- **WHEN** the skin list is read
- **THEN** it is an ordered list of at least 2-3 skins, each carrying a BPM and a palette/visual theme

### Requirement: Skin BPM drives sweep speed

The BPM of the current skin SHALL drive the sweep speed via the timeline time->columns conversion (from the timeline-sweep capability): a higher-BPM skin SHALL make the sweep advance more columns per second. Switching skins (and therefore BPM) mid-pass SHALL NOT discontinuously jump the bar; the new tempo SHALL take effect from the next bar boundary.

#### Scenario: Higher BPM means a faster sweep

- **WHEN** the current skin's BPM is higher
- **THEN** the sweep advances more columns per second of audio-clock time

#### Scenario: Mid-pass skin change does not jump the bar

- **WHEN** the skin (and BPM) changes while a pass is in progress
- **THEN** the sweep position does not discontinuously jump; the new tempo applies from the next bar boundary

### Requirement: Deterministic skin advancement on squares cleared

The game SHALL advance to the next skin when a configurable **squares-cleared threshold** is reached within the current skin, resetting the per-skin counter on advance. The trigger SHALL be deterministic so a seeded run advances skins reproducibly.

#### Scenario: Crossing the threshold advances the skin

- **WHEN** the cumulative squares cleared in the current skin reaches the threshold
- **THEN** `skinIndex` advances by one and the per-skin clear counter resets

#### Scenario: Seeded run advances skins reproducibly

- **WHEN** the same seed and inputs are replayed
- **THEN** skin advancement happens at the same points in both runs

### Requirement: Skin state exposed via the test seam

The current `skinIndex` and the active BPM SHALL be exposed on the public `window.__lumines.state()` projection so the eval can assert progression. This addition SHALL be additive.

#### Scenario: skinIndex and BPM readable from state

- **WHEN** the game advances through skins and `window.__lumines.state()` is read
- **THEN** the projection includes the current `skinIndex` and the active BPM
