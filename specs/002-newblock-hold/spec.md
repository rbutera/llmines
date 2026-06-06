# Feature Specification: New-Block Hold + Deliberate Re-Press

**Feature Branch**: `002-newblock-hold`

**Created**: 2026-06-04

**Status**: Draft

**Input**: User description: "Make the second fast/slow-fall DELIBERATE. When a block locks and the next spawns at the top, the new block HOLDS for a beat before it begins falling, instead of immediately continuing a held key. This also kills the soft-drop-cascade bug (holding the drop key chaining into the next piece)."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - New block holds; a held key does not carry over (Priority: P1)

When a block locks and a new block spawns at the top, the new block pauses ("holds") at
the top for a short, deliberate beat before it starts falling. Crucially, if the player
was holding the soft-drop or hard-drop key when the previous block locked, that held key
does **not** carry over: the new block does not auto-drop and the hold is not skipped. The
player keeps full control to move and rotate during the hold, and must make a fresh,
deliberate press to drop early. This removes the "soft-drop cascade" where holding the
drop key chained one piece straight into the next.

**Why this priority**: This is the core fix. It eliminates the cascade bug and makes
piece placement feel intentional. Without it, the feature delivers no value; with just
this, the game already behaves correctly on every lock→spawn transition.

**Independent Test**: Drop/lock a block, spawn the next, and — without issuing any fresh
press — advance time within the hold window. The new block stays at the top (does not
descend) and `state().hold.active` is true with `remainingMs` counting down. Simulating a
carried-over held key (by not calling the fresh-press hooks across the spawn) produces no
auto-drop.

**Acceptance Scenarios**:

1. **Given** a block has just locked and a new block has spawned, **When** no fresh
   soft/hard-drop press occurs and time passes within the hold window, **Then** the new
   block does not advance faster than the hold allows (it remains held at the top) and the
   reported hold state is active.
2. **Given** the player was holding the soft-drop (or hard-drop) key as the previous block
   locked, **When** the new block spawns and the key remains held (no fresh press),
   **Then** the new block does not auto-drop or fast-fall — it stays held until a fresh
   press or the hold lapses.
3. **Given** a block is in its hold window, **When** the player moves or rotates it,
   **Then** the moves/rotations apply normally and do not start the fall or skip/extend
   the hold.

---

### User Story 2 - Fresh deliberate press drops immediately (Priority: P2)

While a new block is holding, a fresh, deliberate soft-drop or hard-drop press ends the
hold at once and engages that fall behaviour immediately — so a player who *wants* to drop
fast is never made to wait out the full beat.

**Why this priority**: Preserves responsiveness and skill expression. The hold must feel
like a brief ready beat, not input lag, for deliberate players.

**Independent Test**: Spawn a block (held), issue a fresh soft-drop press during the hold,
and confirm the block immediately begins fast-falling (hold ends, `hold.active` becomes
false) without waiting for the timer.

**Acceptance Scenarios**:

1. **Given** a new block is holding, **When** the player makes a fresh soft-drop press,
   **Then** the hold ends immediately and the block begins soft-dropping right away.
2. **Given** a new block is holding, **When** the player makes a fresh hard-drop press,
   **Then** the block hard-drops immediately (no hold delay).
3. **Given** a continuously held key carried over the lock, **When** the player releases
   and makes a fresh press during the hold, **Then** the fall engages from that fresh
   press (the carried-over hold itself never triggers it).

---

### User Story 3 - Hold lapses into normal gravity (Priority: P3)

If the hold window elapses with no fresh drop press, the block begins falling on its own
at the normal gravity rate — exactly as a block falls today — so play continues smoothly
without requiring any input.

**Why this priority**: Completes the lifecycle so a passive player is never stuck. Lower
priority because it only matters once the hold (US1) exists.

**Independent Test**: Spawn a block (held), pass time equal to the full hold window with
no fresh press, then confirm the block starts descending at the normal gravity cadence
(not fast) and `hold.active` is false.

**Acceptance Scenarios**:

1. **Given** a new block is holding and no fresh press occurs, **When** the hold window
   fully elapses, **Then** the block begins falling at normal gravity.
2. **Given** the hold has lapsed into normal gravity, **When** the player then makes a
   fresh soft/hard-drop press, **Then** fast/hard fall engages normally from that point.

---

### Edge Cases

- **Fresh press exactly at lapse**: A fresh press arriving at the same moment the hold
  timer reaches zero behaves as a deliberate drop (not a double-trigger); the block falls
  once, cleanly.
- **Hard drop during hold**: A fresh hard-drop press during the hold immediately settles
  the block to its landing position (the hold does not block hard drop).
- **Move/rotate only**: Moving or rotating during the hold neither starts the fall nor
  resets/extends the hold window.
- **First block of a game**: The hold applies consistently to every newly spawned block
  (including the first after game start), so behaviour is uniform.
- **Continuous hold spanning multiple pieces**: Holding the drop key across several
  lock→spawn transitions never skips any block's hold; each new block requires its own
  fresh press to drop early.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: On every new-block spawn, the block MUST hold at the top for a defined hold
  window and MUST NOT descend by gravity during that window (absent a fresh drop press).
- **FR-002**: During the hold, the player MUST retain full move-left, move-right, and
  rotate control, with those actions applying immediately and not affecting the hold timer.
- **FR-003**: A soft-drop or hard-drop key that was held continuously across the previous
  block's lock MUST NOT cause the newly spawned block to fast/slow-fall, hard-drop, or skip
  its hold; only a fresh, deliberate press may do so.
- **FR-004**: A fresh, deliberate soft-drop or hard-drop press during the hold MUST end the
  hold immediately and engage that fall behaviour at once.
- **FR-005**: If the hold window elapses with no fresh drop press, the block MUST begin
  falling at the normal gravity rate.
- **FR-006**: The hold MUST never be skipped by a carried-over hold; continuous holding
  resumes normal soft/slow-fall only after the hold window has completed.
- **FR-007**: The observable game state MUST expose, for the spawned-but-held block, a hold
  descriptor reporting whether the hold is active and the milliseconds remaining
  (`hold: { active, remainingMs }`); when no block is held it MUST report inactive.
- **FR-008**: The system MUST provide a way to trigger a *fresh* deliberate soft-drop and
  hard-drop (distinct from a carried-over hold), such that withholding these across a spawn
  reproduces the carry-over case (block stays held with no fast-fall).
- **FR-009**: All existing behaviour and polish (movement, rotation, normal gravity, sweep,
  scoring, lock/settle, game-over/restart) MUST continue to work unchanged.

### Key Entities *(include if feature involves data)*

- **Held block state**: Describes the just-spawned block's hold. Attributes: `active`
  (whether the block is currently holding) and `remainingMs` (time left in the hold
  window, counting down to zero). Transitions to inactive when the hold lapses or a fresh
  drop press ends it.
- **Drop intent**: The distinction between a *fresh deliberate press* (which may end the
  hold and drop) and a *carried-over hold* (which must not). Only fresh presses act on the
  held block.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: After a lock + spawn with no fresh drop press, the new block advances 0 rows
  for the entire hold window (it does not descend until the hold ends).
- **SC-002**: When a drop key is held through the previous block's lock (no fresh press),
  the new block performs 0 auto-drops/fast-falls until a fresh press or the hold lapse.
- **SC-003**: With no fresh press, once the hold window elapses the block descends at the
  normal gravity cadence (the same rate as a normally falling block, not accelerated).
- **SC-004**: A fresh drop press during the hold begins the fall immediately — within one
  game tick (perceived as instantaneous, well under 100 ms).
- **SC-005**: The reported hold descriptor is `active: true` for a held block with
  `remainingMs` decreasing across the window, and `active: false` once the block is
  falling.
- **SC-006**: The "soft-drop cascade" no longer occurs: holding the drop key continuously
  across N consecutive lock→spawn transitions causes 0 blocks to skip their hold.

## Assumptions

- **Hold window = 500 ms (one beat).** The input pins it as "~1s, or one beat = 0.5s"; we
  choose one beat (0.5 s) as a single tunable constant, because the polish note asks for a
  "ready to place" beat that feels intentional but not laggy (1 s risks feeling laggy).
- The hold applies to every newly spawned block (including the first of a game) for uniform
  behaviour, not only to post-lock spawns.
- "Normal gravity" and the existing soft-drop/hard-drop semantics are unchanged; this
  feature only gates *when* falling begins for a freshly spawned block.
- The `hold` descriptor and fresh-press triggers are exposed through the existing
  deterministic test/observability interface used to drive the game in test mode; no change
  to normal player controls beyond the deliberate-press gating described.
- Moving/rotating does not consume or reset the hold; the hold is purely time- or
  fresh-press-terminated.
