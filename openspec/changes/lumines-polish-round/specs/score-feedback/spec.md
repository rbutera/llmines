## ADDED Requirements

### Requirement: Score-delta feedback is transient

The animated score-delta feedback (the floating "+N" and the cosmetic count-up number) SHALL be TRANSIENT: it appears on a positive score change and fades out after a bounded lifetime, leaving the authoritative HUD score (`data-testid="score"`) as the only persistent score readout. The transient SHALL NOT carry the authoritative score testid, so value assertions never observe a half-counted or stale number.

#### Scenario: Transient hides after its lifetime

- **WHEN** the score-delta visibility is queried at an elapsed time past its lifetime
- **THEN** it reports not visible (faded out)

#### Scenario: Transient shows within its lifetime

- **WHEN** the score-delta visibility is queried at an elapsed time within its lifetime after a gain
- **THEN** it reports visible

#### Scenario: Authoritative score unaffected

- **WHEN** a score gain triggers the transient feedback
- **THEN** the authoritative `data-testid="score"` HUD value still shows the exact integer score and is not driven by the transient
