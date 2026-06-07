# Requirements — F2: New-block hold + deliberate re-press

## Introduction

In the existing LLMines build, when a piece locks and the next piece spawns at
the top, a held drop key (soft/hard drop) carries over and immediately drives
the new piece down — the "soft-drop-cascade" bug. This feature makes the second
fall deliberate: a freshly spawned block HOLDS at the top for a short window,
during which the player can move/rotate freely, and only begins falling when the
hold lapses (normal gravity) or the player makes a FRESH deliberate drop press.
A key held across the lock must NOT carry over; the player must re-press.

This is a tweak to an existing working game — all other behaviour and polish
must be preserved.

## Requirements

### Requirement 1 — Hold on spawn

**User Story:** As a player, I want a newly spawned block to pause briefly at the
top, so that I get a clear "ready to place" beat to position it.

#### Acceptance Criteria
1. WHEN a new block spawns at the top THEN the system SHALL hold it at the top
   for a fixed hold window (one beat ≈ 500ms) before it begins falling.
2. WHILE a block is held THEN the player SHALL be able to move and rotate it
   freely.
3. WHILE a block is held THEN automatic gravity SHALL be paused.

### Requirement 2 — Begin falling on lapse or fresh press

**User Story:** As a player, I want the block to start falling either after the
hold or when I deliberately press a drop key, so that placement feels intentional.

#### Acceptance Criteria
1. WHEN the hold timer lapses with no fresh drop press THEN the block SHALL begin
   falling at NORMAL gravity.
2. WHEN the player makes a FRESH deliberate soft-drop or hard-drop press during
   the hold THEN the hold SHALL end immediately and that fast/slow-fall SHALL
   engage right away.

### Requirement 3 — No carry-over of a held key

**User Story:** As a player, I want a key I was already holding when the previous
block locked to not auto-drop the new block, so that drops are always deliberate.

#### Acceptance Criteria
1. WHEN the player was holding a fast/slow-fall key as the previous block locked
   THEN the new block SHALL NOT auto-fast-fall; the player MUST re-press.
2. WHEN the player holds the drop key continuously across the transition THEN
   normal fast/slow-fall SHALL resume only AFTER the hold step (the hold is never
   skipped by a carried-over hold).
3. WHEN a new block spawns THEN any prior soft-drop engagement SHALL be reset so
   only a fresh keydown re-engages it.

### Requirement 4 — Testability hooks (TEST_MODE)

**User Story:** As a black-box test harness, I want deterministic hooks to drive
the hold + drop path, so that I can assert the behaviour without real key events.

#### Acceptance Criteria
1. WHEN `window.__lumines.state()` is read THEN it SHALL include
   `hold: { active: boolean, remainingMs: number }` for the spawned-but-held block.
2. WHEN `window.__lumines.pressSoftDrop()` or `pressHardDrop()` is called THEN it
   SHALL simulate a FRESH deliberate press (end the hold and engage that drop).
3. WHEN the press hooks are NOT called across a `spawn()` THEN the new block SHALL
   remain held (no fast-fall) until `pressSoftDrop()` is called or the hold lapses.

### Requirement 5 — No regression

**User Story:** As a maintainer, I want existing behaviour, tests, and polish to
keep working.

#### Acceptance Criteria
1. WHEN this feature is applied THEN the existing core unit tests SHALL stay green.
2. WHEN this feature is applied THEN the existing deterministic `tick()`/`spawn()`/
   `sweep*` test interface SHALL keep its current semantics (tick advances the
   piece one row and never auto-spawns).
3. WHEN this feature is applied THEN the F1 bottom-row settle SHALL not regress.
