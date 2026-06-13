## ADDED Requirements

### Requirement: Continuous heat meter

The audio engine SHALL maintain a continuous `heat` value in the range 0..1 that represents the
player's current performance, replacing the per-segment monotonic `segmentScore`. Heat SHALL be a
song-level accumulator that is NOT reset on segment entry. A clear SHALL increase heat scaled by
the real squares cleared and the real combo streak from truthful pass telemetry; a chain SHALL
increase heat scaled by its size. Heat SHALL be clamped to 0..1 and SHALL ignore any non-finite
contribution. Heat SHALL be exposed on the engine's audio-state probe.

#### Scenario: A clear raises heat scaled by squares and combo

- **WHEN** a clear of N squares with combo streak C is fed to the engine
- **THEN** heat increases by `HEAT_GAIN_BASE + HEAT_GAIN_SQUARE*N + HEAT_GAIN_COMBO*C`, clamped to a maximum of 1

#### Scenario: A bigger clear raises heat more than a smaller one

- **WHEN** a 4-square clear and a 2-square clear are each applied from the same starting heat
- **THEN** the 4-square clear produces a strictly higher resulting heat

#### Scenario: Heat is clamped to the unit range

- **WHEN** clears are applied that would sum past 1.0
- **THEN** heat saturates at 1.0 and never exceeds it

#### Scenario: A non-finite contribution is ignored

- **WHEN** a clear carrying a NaN or Infinity square/combo count is fed to the engine
- **THEN** heat is left unchanged and remains a finite value in 0..1

#### Scenario: Heat is readable on the probe

- **WHEN** the audio-state probe is read
- **THEN** it reports the current `heat` value

### Requirement: Heat decay on clear-less passes

The engine SHALL decay heat at the segment loop boundary by `HEAT_DECAY_PER_EMPTY_PASS` whenever
no clear occurred since the previous loop boundary. Decay SHALL be evaluated only at the loop
boundary (never on a wall clock). Heat SHALL floor at 0. A loop boundary that followed at least
one clear SHALL NOT decay heat. Consecutive clear-less passes SHALL compound the decay.

#### Scenario: A clear-less loop pass sheds heat

- **WHEN** a loop boundary fires and no clear has occurred since the previous boundary
- **THEN** heat decreases by `HEAT_DECAY_PER_EMPTY_PASS`, floored at 0

#### Scenario: A loop pass with a clear does not decay

- **WHEN** a loop boundary fires and at least one clear occurred since the previous boundary
- **THEN** heat is not decayed by that boundary

#### Scenario: Multiple clear-less passes shed a layer

- **WHEN** the player tops out the tier and then plays several consecutive clear-less passes
- **THEN** heat drops enough that the audible tier sheds at least one cumulative layer

#### Scenario: Alternating one clear and one clear-less pass does not shed a layer (no thrash)

- **WHEN** the player alternates a clear pass and a clear-less pass repeatedly from a settled tier
- **THEN** the per-cycle net heat change is non-negative (a clear gain exceeds a single empty-pass
  decay) and the audible tier does NOT shed a layer across the alternation

### Requirement: Heat drives the audible tier up and down

The engine SHALL derive the desired audible cumulative tier as `round(heat * maxTier)` for the
active segment, bounded below by the minimum-audible-layers floor and above by the segment's tier
ceiling. At each loop boundary the audible tier SHALL move at most one step toward the desired
tier — UP when heat rises and DOWN when heat falls. The audible tier SHALL never drop below the
minimum-audible-layers floor. A tier change SHALL be a single one-tier-to-one-tier crossfade so
that at most two bed players are audible across the crossfade (the no-hiss invariant). A tier
whose audio file failed to load SHALL be demoted to the nearest loaded tier at or below it.

#### Scenario: Rising heat reveals layers one step per boundary

- **WHEN** heat rises so the desired tier is two or more steps above the current tier and a loop boundary fires
- **THEN** the audible tier increases by exactly one step on that boundary

#### Scenario: Falling heat sheds layers one step per boundary

- **WHEN** heat falls so the desired tier is below the current tier and a loop boundary fires
- **THEN** the audible tier decreases by exactly one step on that boundary

#### Scenario: The audible tier never drops below the minimum-audible floor

- **WHEN** heat falls to 0
- **THEN** the audible tier holds at the minimum-audible-layers floor and the song is never silent

#### Scenario: At most two bed players are audible across a tier crossfade

- **WHEN** a tier crossfade is in flight
- **THEN** the count of bed tier players at non-zero gain is at most 2

### Requirement: Layer count carries across a segment transition

On entering a segment the engine SHALL set the starting audible tier DIRECTLY from the CURRENT
heat (`round(heat * maxTier)`), clamped to the minimum-audible floor and the segment's ceiling.
This entry instantiation is the carry-across and is EXEMPT from the one-step-per-boundary cap: it
MAY be a multi-step jump (for example, straight to the top tier when heat is at or near 1.0). The
one-step-per-boundary cap applies only to tier moves WITHIN a segment, never to this entry carry.
The engine SHALL NOT reset progression on entry and SHALL NOT cap the entry tier at `top - 1`. A
player who is at the top (vocal) tier with sustained heat SHALL continue to hear the top tier
across the transition without a drop; a player whose heat has fallen SHALL enter the next segment
at the correspondingly lower tier.

#### Scenario: Sustained heat keeps vocals across a transition (no vocal cut)

- **WHEN** the player is at the top tier with heat at or near 1.0 and the segment advances
- **THEN** the next segment is entered at the top tier and the post-transition audible tier is greater than or equal to the pre-transition audible tier

#### Scenario: Dropped heat enters the next segment thinner

- **WHEN** heat has fallen well below full and the segment advances
- **THEN** the next segment is entered at a tier lower than the previous segment's top, following heat

#### Scenario: A fresh game opening starts at the min-audible floor

- **WHEN** a new game begins with heat at 0
- **THEN** the opening segment is audible at the minimum-audible-layers floor (never bare)

#### Scenario: Entering a segment at sustained high heat starts at the top tier directly (the carry)

- **WHEN** the player advances into a segment with heat at or near 1.0
- **THEN** the new segment is entered AT its top tier directly in one move (the carry — a
  multi-step jump, not a single one-step rise from the floor)

### Requirement: Top-built-and-held forward-only advance with loop retention

A segment SHALL advance forward by exactly one segment, on a loop boundary, IF AND ONLY IF: no
transition is in flight, AND the boundary is not the one that just revealed the top tier, AND the
audible tier has reached the segment's top tier (ALL layers audible), AND that top tier has been
audible for one full loop. There SHALL be NO bare-heat advance path: a segment SHALL NOT advance
on a heat threshold while its top tier is not yet audible, so the song can never advance past
unheard material. Below this gate the segment SHALL loop in place. The advance SHALL be
forward-only, one-step-per-boundary, and in-flight-locked so a burst cannot fast-forward multiple
segments. There SHALL be no autonomous (clock-driven) advance.

#### Scenario: A topped-out segment advances after holding the top one loop

- **WHEN** a segment reaches its top tier and the top tier has been audible for one full loop
- **THEN** the engine advances exactly one segment forward (the top mix does not loop forever)

#### Scenario: A segment below its top tier does not advance (no bare-heat fast-forward)

- **WHEN** heat is high but the audible tier has not yet reached the segment's top tier on a loop boundary
- **THEN** the segment does not advance and re-plays its bar window (it never advances past a tier the player has not heard)

#### Scenario: A 4-tier segment advances only after its real top tier is audible a full loop

- **WHEN** a song1 segment (4 tiers, top tier index 3) is driven to high heat
- **THEN** the engine does NOT advance until the audible tier equals 3 (the real top) AND tier 3 has played one full loop, never on a boundary where the audible tier is still 2 or below

#### Scenario: A 5-tier segment advances only after its real top tier is audible a full loop

- **WHEN** a song2 segment (5 tiers, top tier index 4) is driven to high heat (including heat in the 0.85–0.87 band, below the heat ≥ 0.875 needed to reveal tier 4)
- **THEN** the engine does NOT advance while the audible tier is still 3 or below, and advances only after the audible tier equals 4 (the real top, with vocals) AND tier 4 has played one full loop

#### Scenario: A burst cannot fast-forward multiple segments

- **WHEN** a large burst of clears pins heat to 1.0 and several loop boundaries fire
- **THEN** the engine advances at most one segment per loop boundary (never multiple in one boundary), and each segment's top tier is built and held a loop before that segment advances

#### Scenario: An advance never goes backward

- **WHEN** any sequence of clears and clear-less passes is applied
- **THEN** the segment index never decreases

#### Scenario: No advance on the boundary that just revealed the top tier

- **WHEN** a single boundary both reveals the top tier and would otherwise satisfy the advance rule
- **THEN** the engine does not advance on that boundary (the top tier is heard at least one loop first)

### Requirement: Segments always play a full loop — no mid-loop advance (no fast-forward)

A segment SHALL only ever advance ON its loop boundary, so every segment plays AT LEAST one full
bar-window loop before it can hand off — there is NO mid-loop cut and NO sub-loop advance cadence.
Heat governs WHETHER a segment advances at its boundary, never WHEN within the loop. A player who
clears heavily therefore still hears each segment in full (one loop per advance), and a player
without enough heat keeps looping the current segment; the song can never skip or fast-forward past
unheard material.

#### Scenario: Heavy clearing still plays each segment for a full loop

- **WHEN** the player clears continuously so heat stays maxed across several segments
- **THEN** each segment still plays its full bar-window loop before advancing (one segment per loop
  boundary), never cut short mid-loop

#### Scenario: Advance is evaluated only at the loop boundary

- **WHEN** the top tier becomes audible-and-held partway through a segment's loop
- **THEN** the segment does not advance until its loop boundary is reached (the in-flight audio is
  never interrupted mid-loop)

### Requirement: End-of-song triggers a skin switch

An earned advance off the last (TERMINAL) segment SHALL fire the end-of-song completion callback
(`onSongComplete`) rather than stepping the segment index, so the host swaps to the next song.
The terminal segment SHALL keep looping until the host swaps.

#### Scenario: Advancing past the final segment completes the song

- **WHEN** the advance rule is satisfied on the last segment
- **THEN** the engine fires `onSongComplete` and does not increment the segment index
