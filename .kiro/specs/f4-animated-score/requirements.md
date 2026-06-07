# Requirements — F4: Dynamic animated score

## Introduction

Today the score is a static number ticking in the sidebar HUD. F4 makes scoring
feedback dynamic and impactful WITHIN the game view: the value animates (count-up
+ pop/scale) and an effect plays (flash/particles), especially on big clears.
The authoritative numeric score must remain assertable via the `score` testid.

## Requirements

### Requirement 1 — Authoritative, assertable score

**User Story:** As a test harness, I want the `score` testid to always reflect
the current numeric score, so that value assertions keep working.

#### Acceptance Criteria
1. WHEN the score is read via `data-testid="score"` THEN its settled text SHALL
   equal the current authoritative integer score.
2. WHEN the score animates (count-up) THEN the animation SHALL converge to and
   settle exactly on the authoritative value (and snap to it on reset/decrease),
   so assertions are never broken.
3. WHERE the `score` testid appears THEN there SHALL be exactly one such element
   while playing.

### Requirement 2 — Animated, in-view score

**User Story:** As a player, I want the score to animate inside the game view,
so that scoring feels alive and impactful.

#### Acceptance Criteria
1. WHEN a scoring event increases the score THEN the in-view score SHALL animate
   (count-up toward the new value) and pop/scale.
2. WHEN the score increases THEN a floating "+N" indicator SHALL appear and fade.
3. WHEN the score increases THEN a visible effect SHALL play in the game view
   (canvas flash/particles), scaled by the size of the increase.
4. WHERE the score is displayed THEN it SHALL be presented within/over the game
   view, not only as a plain HUD number.

### Requirement 3 — No regression

**User Story:** As a maintainer, I want existing behaviour, tests, and polish to
keep working.

#### Acceptance Criteria
1. WHEN F4 is applied THEN the existing core unit tests and E2E score assertions
   SHALL stay green.
2. WHEN F4 is applied THEN F1 settle and F2 hold behaviour SHALL not regress.
3. WHEN the game restarts THEN the animated score SHALL reset cleanly to 0.
