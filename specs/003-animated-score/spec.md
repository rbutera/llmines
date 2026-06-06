# Feature Specification: Dynamic Animated Score

**Feature Branch**: `003-animated-score`

**Created**: 2026-06-04

**Status**: Draft

**Input**: User description: "The score updates dynamically and animated WITHIN the game view itself, with super impactful effects whenever it changes (juicy: count-up, pop/scale, particle/flash on big clears), not just a number ticking in a HUD."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Juicy animated score on every scoring event (Priority: P1)

When the player clears squares and scores, the score doesn't just silently tick up in a
corner — it reacts in the game view with an impactful, satisfying animation: the value
visibly counts up, pops/scales, and a flash plays where the action is. The feedback makes
every score gain feel rewarding. Throughout, the underlying score number stays exactly
correct.

**Why this priority**: This is the feature. Without the in-view animated reaction the
goal isn't met. With just this, scoring already feels dramatically more satisfying.

**Independent Test**: Trigger a scoring event (clear a square via the sweep). Observe a
visible score animation/effect in the game view firing as the score changes, while the
authoritative score readout (the `score` testid) shows the exact correct number.

**Acceptance Scenarios**:

1. **Given** the player is mid-game, **When** a scoring event occurs (the score
   increases), **Then** a visible animation fires in the game view (the value animates —
   e.g. counts up — and an effect such as a pop/scale and flash plays).
2. **Given** a scoring event has just fired its animation, **When** the authoritative
   score readout (`score` testid) is read at any moment, **Then** it shows the exact,
   correct integer score (the animation never makes the asserted value wrong).
3. **Given** an event awards no points, **When** it resolves, **Then** no spurious score
   animation fires.

---

### User Story 2 - Bigger clears feel bigger (Priority: P2)

A small clear gets a light reaction; a big clear (a high-point, multi-square sweep) gets a
noticeably bigger, juicier payoff — more particles/flash, a stronger pop. The intensity of
the celebration scales with the size of the win, so players feel the difference between a
modest score and a huge one.

**Why this priority**: Escalation is what makes the juice memorable and rewards skillful
big plays; it elevates the feature from "animated" to "impactful." Builds on US1.

**Independent Test**: Compare a minimal scoring event against a large multi-square clear;
the large clear produces a visibly stronger/longer effect than the small one.

**Acceptance Scenarios**:

1. **Given** a small scoring event, **When** it fires, **Then** a modest effect plays.
2. **Given** a large scoring event (substantially more points), **When** it fires, **Then**
   a visibly stronger effect plays (e.g. extra particles/flash) than the small event.

---

### User Story 3 - Feedback never disrupts play or correctness (Priority: P3)

The celebration is pure polish layered on top: it never blocks input, never stalls the
falling blocks or the sweep, never permanently hides the board, and always leaves the
authoritative score correct and readable. On restart, effects clear and the score returns
to zero cleanly.

**Why this priority**: Guards the existing, working game. Lower priority only because it's
a constraint on US1/US2 rather than new value, but it must hold for the feature to ship.

**Independent Test**: Score during active play and confirm input/gravity/sweep continue
uninterrupted, the board stays visible, and the score value/readout stay correct; restart
and confirm effects clear and the score resets to 0.

**Acceptance Scenarios**:

1. **Given** an active game, **When** score effects are playing, **Then** player input,
   block fall, and the sweep continue without delay or interruption.
2. **Given** effects are playing, **When** they finish, **Then** they fully clear and the
   playfield/blocks are unobscured.
3. **Given** a game with a non-zero score, **When** the player restarts, **Then** the
   displayed score returns to 0 and no stale animation persists.

---

### Edge Cases

- **Rapid consecutive scoring** (several clears in quick succession): animations overlap or
  queue gracefully without stacking forever, and the authoritative value stays correct.
- **Very large single clear** (multi-square, multiplied): the top effect tier fires without
  visible performance hitches.
- **Zero-point event**: no animation fires.
- **Restart mid-animation**: in-flight effects clear and the score resets to 0.
- **Reduced-motion preference**: a tasteful, dialed-down fallback still updates the value
  without jarring motion.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: On every scoring event where the score increases, a visible animation MUST
  fire in the game view — the score value animates (e.g. count-up) AND an accompanying
  effect (pop/scale and flash) plays.
- **FR-002**: The animated score feedback MUST appear within the game/playfield view (where
  the action is), not solely as a static number in the side HUD.
- **FR-003**: The `score` data-testid MUST always present the current authoritative integer
  score and be assertable as that exact value at any time; the animation MUST NOT cause the
  asserted testid text to show an intermediate or incorrect value.
- **FR-004**: The effect intensity MUST scale with the magnitude of the scoring event —
  larger clears (more points) produce a visibly stronger effect (e.g. extra particles/
  flash) than small ones.
- **FR-005**: Score animations/effects MUST be cosmetic and MUST NOT block or delay player
  input, block fall, sweep, clearing, or scoring.
- **FR-006**: Score animations/effects MUST be transient and MUST NOT permanently obscure
  the playfield or settled blocks.
- **FR-007**: On a new game/restart, the displayed score MUST return to 0 and no stale
  animation may persist.
- **FR-008**: All existing behaviour and polish (gameplay, exact scoring values, sweep,
  controls, HUD, and prior shipped features) MUST continue to work unchanged.

### Key Entities *(include if feature involves data)*

- **Score**: The authoritative integer total. Source of truth for the `score` testid; never
  altered by the animation layer.
- **Scoring event**: A discrete increase in score (from a sweep clear), carrying a magnitude
  (points awarded / cells or squares cleared) that drives effect intensity.
- **Score effect**: A transient visual celebration (count-up, pop/scale, flash, particles)
  rendered in the game view in response to a scoring event; purely cosmetic.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: For 100% of score-increasing events, a visible animation/effect fires in the
  game view within a perceptible window (≤ 150 ms) of the score changing.
- **SC-002**: The `score` testid text equals the exact authoritative integer score every
  time it is queried — 0 mismatches across scoring events, including immediately after a
  clear.
- **SC-003**: A large clear produces a visibly stronger/longer effect than a minimal clear,
  distinguishable by players (effect magnitude correlates with points awarded).
- **SC-004**: Effects are transient — they fully clear within ~2 seconds, never leave the
  board obscured, and never increase input latency.
- **SC-005**: No regression — existing automated checks (gameplay, scoring values, sweep,
  prior features 001/002) continue to pass.
- **SC-006**: Play-feel — players consistently describe the score feedback as impactful and
  satisfying (the feature is primarily judged by play).

## Assumptions

- **Authoritative number vs cosmetic juice are split.** The `score` testid shows the exact
  integer immediately and is the source of truth; the count-up/pop/particle/flash are a
  cosmetic layer that never changes the asserted testid text. This satisfies "the animation
  must not break value assertions."
- **Scoring events** are the score increases produced by the existing sweep-clear scoring;
  effect magnitude derives from points awarded (and/or cells/squares cleared in the pass).
- **"Within the game view"** means over/within the playfield/board region where play
  happens (a prominent in-view reaction), complementing — not necessarily removing — the
  existing HUD readout.
- **Reduced-motion** preferences are respected with a tasteful fallback that still updates
  the value with minimal motion.
- **Visual-only scope**: audio is out of scope for this feature; the juice is visual.
- The exact scoring rules/values are unchanged; this feature only adds presentation.
