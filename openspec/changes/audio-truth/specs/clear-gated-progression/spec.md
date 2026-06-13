## ADDED Requirements

### Requirement: Clear weight is computed from real squares and combo against the existing pacing knobs

The engine SHALL convert a `lineClear` event into clear-progress weight as
`1 + squares + (comboMultiplier - 1)` (where `combo` on the event carries
`comboMultiplier - 1`), and a `chain` event as `2 + min(8, size)`. The pacing knobs
`ADVANCE_THRESHOLD` and `TIER_REVEAL_STEP` SHALL be unchanged; only the weight expression
changes so real inputs reproduce the intended pacing (a typical clear ≈ weight 3, a big
single-sweep harvest rewarded but well below the advance gate). A non-finite weight SHALL
be ignored and the accumulated progress SHALL stay bounded by the existing cap.

#### Scenario: A typical clear advances at the intended pace

- **WHEN** a `lineClear` with `squares = 2`, `combo = 0` is fed
- **THEN** clear-progress increases by 3

#### Scenario: A big clear is rewarded but does not fast-forward

- **WHEN** a `lineClear` with `squares = 4`, `combo = 0` is fed to a segment at zero progress
- **THEN** clear-progress increases by 5, which is below `ADVANCE_THRESHOLD`, so no advance
  is earned from one harvest

#### Scenario: A streak adds proportionally

- **WHEN** a `lineClear` with `squares = 4`, `combo = 2` (a ×3 streak) is fed
- **THEN** clear-progress increases by 7

#### Scenario: A poisoned weight is ignored

- **WHEN** an event yields a non-finite weight
- **THEN** clear-progress is unchanged and remains finite and within the cap

### Requirement: A fully-revealed segment advances after one full loop at its top tier

The engine SHALL advance a segment forward to the next segment once that segment's TOP
tier (the full mix including vocals) has been AUDIBLE for one full loop, regardless of
whether the top tier was reached by in-segment clears or carried in from a previous
segment's floor. This rule SHALL fire only when the segment has headroom above its
minimum-audible floor, only after the top tier was audible for a complete loop (never on
the same boundary the top was first revealed), and SHALL respect the in-flight transition
lock.

#### Scenario: Vocals never loop forever

- **WHEN** a segment reaches its top tier and that top tier plays for one complete loop
  window
- **THEN** on the next loop boundary the engine advances to the next segment rather than
  replaying the top tier again

#### Scenario: The carried floor is capped below the top so vocals are re-earned

- **WHEN** the previous segment was fully revealed and its floor is carried into a new
  segment
- **THEN** the new segment enters at no higher than one tier below its top (subject to the
  minimum-audible floor), so the top must be re-revealed by the player's clears in this
  segment before the mandatory advance can arm

#### Scenario: No advance on the boundary that first reveals the top

- **WHEN** a single hot loop banks both the top-tier reveal and enough progress to advance
- **THEN** the top tier is revealed and heard on this boundary, and the advance is deferred
  to the next boundary (the reveal ramp is not cancelled)

#### Scenario: No cascade through multiple segments

- **WHEN** a mandatory advance lands a new segment
- **THEN** that new segment does not itself immediately mandatorily advance; it requires a
  fresh full loop at its own re-earned top before it can advance

### Requirement: A low-tier segment must not auto-advance without clears

A segment whose top tier IS its minimum-audible floor (no headroom above the floor) SHALL
NOT trigger the mandatory full-reveal advance. Such a segment SHALL advance only via the
clear-progress gate, so it cannot advance on a loop boundary with zero clears.

#### Scenario: A floor-only segment loops until cleared

- **WHEN** a segment's top tier equals its minimum-audible floor and the player makes no
  clears
- **THEN** the segment loops in place indefinitely and never advances on the loop boundary

### Requirement: Horizontal advance stays forward-only, one-step, in-flight-locked, no-fast-forward

The engine SHALL preserve the existing horizontal invariants: advance is forward-only
(never backward), exactly one segment per earned advance, blocked while a transition is in
flight, and not fast-forwardable (a burst of clears cannot skip multiple segments because
per-segment progress resets to zero on entry). Advancing past the final (TERMINAL) segment
SHALL fire the song-complete handler (the skin switch) instead of stepping the index.

#### Scenario: A burst cannot skip segments

- **WHEN** the player banks a very large amount of clear-progress in one segment
- **THEN** the engine advances exactly one segment, and the next segment starts at zero
  progress and must be re-earned

#### Scenario: End of song switches the skin

- **WHEN** an advance is earned off the last (TERMINAL) segment
- **THEN** the engine fires the song-complete handler (host swaps to the next song) and
  does not step past the final segment
