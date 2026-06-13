## ADDED Requirements

### Requirement: Each segment's top tier is the full-mix master for that time range

The asset pipeline SHALL render each segment's TOP tier (the full-mix, vocals-included
tier) by cutting the song's full-mix MASTER recording (`0 *.wav`) at the same bar
boundaries used for that segment, rather than by summing the individual stems. Lower tiers
SHALL remain cumulative stem renders so the no-hiss bed invariant (at most two bed players
audible at steady state) is preserved. The crossfade from the highest stem-sum tier to the
master top tier SHALL remain constant-sum.

#### Scenario: Full reveal sounds like the song

- **WHEN** the pipeline renders a segment's top tier
- **THEN** that tier is a slice of the full-mix master for the segment's time range, not a
  sum of stems

#### Scenario: Lower tiers stay cumulative stem renders

- **WHEN** the pipeline renders a segment's non-top tiers
- **THEN** those tiers are cumulative stem sums and the runtime keeps at most two bed
  players audible at steady state

### Requirement: The top-tier render is level-matched to the master and validated

The pipeline SHALL include a validation step that, for each segment, compares the rendered
top tier's loudness (integrated LUFS / RMS) against the master slice for the same time
range and SHALL fail if the difference exceeds a small tolerance. This guarantees the top
tier matches the mastered song level rather than the stem-bus level, and that the
stem-sum-to-master crossfade does not jump.

#### Scenario: A drifting top tier fails the pipeline

- **WHEN** a segment's rendered top tier differs in integrated loudness from its master
  slice by more than the allowed tolerance
- **THEN** the validation step fails and the pipeline does not publish the assets

#### Scenario: A level-matched top tier passes

- **WHEN** every segment's rendered top tier is within tolerance of its master slice
- **THEN** the validation step passes

### Requirement: Code is compatible with both summed-top and master-top manifests

The engine SHALL play whichever top-tier asset the manifest references without knowing
whether it is a stem sum (old assets) or a master slice (new assets). Shipping the code
before regenerating assets MUST NOT change runtime behaviour for an existing manifest.

#### Scenario: Old assets still play

- **WHEN** the manifest still references summed top-tier assets
- **THEN** the engine plays them unchanged, with no runtime error or behaviour change

#### Scenario: New assets play without code change

- **WHEN** the manifest is regenerated to reference master-slice top tiers
- **THEN** the engine plays them with no further code change
