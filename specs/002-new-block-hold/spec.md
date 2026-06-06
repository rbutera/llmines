# Feature Specification: New Block Hold

**Feature Branch**: `cell/speckit-codex-brownfield`

**Created**: 2026-06-04

**Status**: Draft

**Input**: User description: "Brownfield bug fix/tweak for LLMines: after a block locks and the next block spawns, the new block should hold briefly at the top so any previously held drop key does not cascade into the new block. The player can still move and rotate during the hold. The block begins falling after the hold timer lapses at normal gravity, or sooner only when the player makes a fresh deliberate soft-drop or hard-drop press. The deterministic test surface must expose hold status and fresh-press simulation so carried-over held keys can be distinguished from deliberate presses."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - New block waits at spawn (Priority: P1)

As a player, I want a newly spawned block to pause briefly at the top after the previous block locks, so I can recognize the new piece and place it deliberately instead of having it inherit a held drop input.

**Why this priority**: This directly fixes the soft-drop cascade and accidental second-drop behavior that can make the next block feel out of control.

**Independent Test**: Can be tested by locking a block while a drop key is held through the transition, then verifying the next block remains held at the top until the hold expires or a fresh drop press occurs.

**Acceptance Scenarios**:

1. **Given** a block locks and a new block spawns, **When** no fresh drop press is made, **Then** the new block remains at the top during the hold window.
2. **Given** the player was holding a drop key when the previous block locked, **When** the new block spawns, **Then** the held key does not make the new block soft-drop or hard-drop during the hold.
3. **Given** the hold window has elapsed with no fresh drop press, **When** gravity resumes, **Then** the block begins falling at normal gravity speed.

---

### User Story 2 - Fresh drop press breaks the hold deliberately (Priority: P2)

As a player, I want a fresh soft-drop or hard-drop press during the hold to act immediately, so deliberate fast play still feels responsive.

**Why this priority**: The hold should prevent accidental carry-over input without making intentional rapid placement feel laggy.

**Independent Test**: Can be tested by spawning a held block, making a fresh soft-drop or hard-drop press during the hold, and verifying the block responds immediately.

**Acceptance Scenarios**:

1. **Given** a new block is held at the top, **When** the player makes a fresh soft-drop press, **Then** the hold ends and soft-drop behavior begins immediately.
2. **Given** a new block is held at the top, **When** the player makes a fresh hard-drop press, **Then** the hold ends and the block hard-drops immediately.
3. **Given** a player continues holding a drop key from the prior block without releasing and re-pressing, **When** the hold is active, **Then** the carried-over hold is ignored and does not skip the hold.

---

### User Story 3 - Movement and rotation remain available during hold (Priority: P3)

As a player, I want to move and rotate the held block during the spawn hold, so the pause feels like a ready-to-place beat rather than input lag.

**Why this priority**: This preserves polish and makes the hold feel intentional instead of frozen.

**Independent Test**: Can be tested by moving and rotating a newly spawned held block before the hold expires and verifying the block remains held while responding to placement controls.

**Acceptance Scenarios**:

1. **Given** a new block is in its hold window, **When** the player moves it left or right, **Then** the block moves horizontally without starting gravity early.
2. **Given** a new block is in its hold window, **When** the player rotates it, **Then** the block rotates without starting gravity early.

### Edge Cases

- A drop key held continuously through lock and spawn must not count as a fresh press for the new block.
- A fresh soft-drop press during hold must end the hold immediately and apply soft-drop behavior to the currently held block.
- A fresh hard-drop press during hold must end the hold immediately and hard-drop the currently held block.
- Movement or rotation during hold must not shorten or cancel the hold timer.
- If the hold window expires with no fresh drop press, the block must begin normal gravity rather than fast-fall behavior.
- The hold must apply to every newly spawned block after a lock, not only the first block of a game.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The game MUST start a spawn hold window whenever a new block appears after a previous block locks.
- **FR-002**: The spawn hold window MUST last one beat, defined for this feature as 0.5 seconds, unless ended early by a fresh soft-drop or hard-drop press.
- **FR-003**: During the spawn hold, the game MUST allow horizontal movement and rotation without starting gravity early.
- **FR-004**: During the spawn hold, carried-over held drop input from the previous block MUST NOT trigger soft-drop, hard-drop, or any accelerated fall for the new block.
- **FR-005**: The game MUST require a fresh deliberate soft-drop or hard-drop press to end the hold early and apply the corresponding drop action.
- **FR-006**: If the hold expires with no fresh drop press, the block MUST begin falling at normal gravity speed.
- **FR-007**: The hold state MUST be observable through the deterministic test surface, including whether the hold is active and how much time remains.
- **FR-008**: The deterministic test surface MUST support simulating fresh soft-drop and hard-drop presses separately from carried-over held-key state.
- **FR-009**: The feature MUST NOT change scoring, sweep timing, piece generation, board dimensions, movement, rotation, hard-drop behavior after a fresh press, or the existing bottom-row settle fix.

### Key Entities

- **Spawn Hold**: A short post-spawn state for the active block, with active/inactive status and remaining time.
- **Fresh Drop Press**: A new deliberate soft-drop or hard-drop action made after the current block has spawned.
- **Carried-over Hold**: A drop key state that began before the current block spawned and must not affect the new block during its hold.
- **Active Block**: The current controllable block that may be held, moved, rotated, dropped, or allowed to fall normally.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In 100% of tested lock-and-spawn transitions with no fresh drop press, the new block remains at its spawn rows for the full 0.5-second hold window.
- **SC-002**: In 100% of tested carried-over held-drop transitions, the new block does not soft-drop, hard-drop, or advance faster than normal before the hold expires.
- **SC-003**: In 100% of tested no-fresh-press holds, the block begins normal gravity after the hold expires.
- **SC-004**: In 100% of tested fresh soft-drop and hard-drop presses during hold, the hold ends immediately and the requested drop behavior applies to the current block.
- **SC-005**: In 100% of tested hold windows, movement and rotation remain responsive without canceling the hold.
- **SC-006**: Players can perceive the hold as a short ready-to-place beat, with no more than one beat of waiting before normal gravity resumes.

## Assumptions

- The hold duration is pinned to one beat, 0.5 seconds.
- A carried-over held drop key means the player has not released and pressed the drop key again after the new block spawned.
- A fresh hard-drop press during hold should behave like the existing hard-drop action once the hold ends.
- A fresh soft-drop press during hold should begin the existing faster descent behavior for the current block.
- The deterministic test surface remains available only for validation and does not change normal player-facing controls.
