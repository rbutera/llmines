# Feature Specification: LLMines Game

**Feature Branch**: `[001-llmines-game]`

**Created**: 2026-06-04

**Status**: Draft

**Input**: User description: "Build LLMines, a playable browser-based clone of Lumines with 2x2 falling color blocks, same-color square formation, a music-synced sweeping timeline clear mechanic, score display, start/game-over screens, visible controls, audio loop, and deterministic test-mode controls."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Start and Play a Core Round (Priority: P1)

A desktop browser player can open the game, read the controls, start a round, move and rotate falling 2x2 pieces, drop them onto the playfield, and continue playing as new pieces spawn until the stack reaches the top.

**Why this priority**: This is the minimum playable loop; without it, the product is not a game.

**Independent Test**: Can be tested by starting from the initial screen, pressing the start control, confirming an empty 16-column by 10-row playfield appears with a falling 2x2 piece, using each movement control, hard-dropping the piece, and confirming another piece appears during normal play.

**Acceptance Scenarios**:

1. **Given** the game is on the start screen, **When** the player starts the game, **Then** the in-game view appears with a score of 0, an empty 16x10 playfield, and one active 2x2 piece at the top center.
2. **Given** a piece is falling, **When** the player presses `h`, `l`, `j`, `k`, or `space`, **Then** the piece respectively moves left, moves right, accelerates downward, rotates 90 degrees, or instantly drops and locks if the requested action is valid.
3. **Given** a falling piece can no longer descend because of the floor or settled cells, **When** gravity advances, **Then** the piece locks into the settled stack.
4. **Given** normal play is active and a piece has locked without ending the game, **When** the lock completes, **Then** a new randomized 2x2 piece appears at the pinned top-center spawn location.

---

### User Story 2 - Form Squares, Sweep, Clear, and Score (Priority: P1)

A player can create same-color 2x2-or-larger areas in the settled stack, see those cells marked, and have the sweeping timeline clear marked cells column by column while awarding points and letting remaining cells fall into gaps.

**Why this priority**: The square marking and timed sweep are the defining mechanic that differentiates this game from generic falling-block puzzles.

**Independent Test**: Can be tested by arranging settled cells into a monochrome 2x2 square, confirming the square is marked, advancing the sweep past those columns, and verifying the marked cells are deleted, the score increases according to the pinned rule, and cells above deleted spaces settle downward.

**Acceptance Scenarios**:

1. **Given** the settled stack contains any aligned 2x2 area of a single color, **When** square detection runs, **Then** every cell participating in at least one qualifying same-color 2x2 square is marked for deletion.
2. **Given** a same-color region is larger than 2x2, **When** square detection runs, **Then** each aligned monochrome 2x2 square is counted by its top-left corner, including overlapping squares.
3. **Given** marked cells are present, **When** the timeline sweep passes a column containing marked cells, **Then** only the marked cells in that passed column are deleted.
4. **Given** a sweep deletes cells, **When** the deletion is scored, **Then** the score increases by deleted cell count multiplied by the number of distinct completed 2x2 squares cleared during that sweep.
5. **Given** cells exist above deleted spaces, **When** the sweep has passed and the clear is applied, **Then** cells fall downward within their columns to fill gaps.

---

### User Story 3 - Tempo-Synced Audio and Sweep Feedback (Priority: P2)

A player experiences a continuous left-to-right timeline sweep that stays aligned with the looping backing track and can visually understand marked, clearing, and collapsing cells through polished animation.

**Why this priority**: Timing, music, and visual feedback are central to the expected feel of the game, but they build on the core playable and clearing loop.

**Independent Test**: Can be tested by starting a round, confirming the backing track is available and set to loop, observing a vertical sweep traverse the entire field every 4.0 seconds, and verifying marked cells visibly animate through marking, clearing, and collapse states.

**Acceptance Scenarios**:

1. **Given** a round is in progress, **When** the sweep starts at the left edge, **Then** it reaches the right edge after 8 beats, equal to 4.0 seconds at 120 BPM, and repeats continuously.
2. **Given** the round has started, **When** audio is initialized, **Then** the backing track is sourced from the provided game track, is configured to loop, and remains the timing reference for the sweep during normal play.
3. **Given** a square becomes marked or cells clear, **When** the state change occurs, **Then** the player sees animation that makes the formation, highlight, deletion, and collapse understandable without relying only on score changes.

---

### User Story 4 - Game Over and Restart (Priority: P2)

A player receives a clear game-over state when the stack prevents a new piece from entering, can see the final score, and can restart into a fresh round.

**Why this priority**: A complete play session needs a clear ending and recovery path.

**Independent Test**: Can be tested by filling the spawn area, attempting to spawn a new piece, confirming the game-over screen appears with the final score, and selecting restart to return to a fresh game.

**Acceptance Scenarios**:

1. **Given** the spawn cells at the top center are blocked by the settled stack, **When** a new piece would enter, **Then** the game ends immediately.
2. **Given** the game has ended, **When** the game-over screen is shown, **Then** it displays the final score and a restart control.
3. **Given** the player chooses restart, **When** the new round begins, **Then** the grid is empty, the score is 0, game-over state is cleared, and a new falling piece appears.

---

### User Story 5 - Automatable Deterministic Verification (Priority: P3)

An external test harness can run the game deterministically in a special test mode, drive pieces and sweeps without waiting for real time or audio playback, and inspect current game state while normal players never see those hooks.

**Why this priority**: Deterministic automation is required for reliable acceptance testing, but it should not change normal gameplay.

**Independent Test**: Can be tested by enabling test mode, starting the game, seeding piece generation, spawning known pieces, advancing gravity and sweep progress manually, inspecting grid/score/game-over/sweep state, and confirming the same hooks are absent when test mode is disabled.

**Acceptance Scenarios**:

1. **Given** test mode is enabled, **When** the harness seeds random generation and spawns specified 2x2 pieces, **Then** subsequent state is deterministic and observable.
2. **Given** test mode is enabled, **When** the harness advances gravity by one step, **Then** no new piece appears automatically after a lock unless the harness explicitly requests one.
3. **Given** test mode is enabled, **When** the harness advances sweep progress by 4.0 seconds, **Then** the sweep completes exactly one full 16-column traversal.
4. **Given** test mode is disabled, **When** the game runs normally, **Then** deterministic test hooks are not exposed and normal gravity, auto-spawn, audio, and sweep behavior remain active.

### Edge Cases

- Moving or rotating a piece at the left wall, right wall, floor, or against settled cells must leave the piece in its last valid position when the requested action would collide.
- A hard-dropped piece must lock at the lowest valid position in its current orientation without passing through settled cells.
- Consecutive test-mode spawns while a piece is falling must lock the existing piece first, then place the requested piece at the pinned spawn location.
- A newly spawned piece must trigger game over if any spawn cell is already occupied.
- Square counting must handle overlapping same-color regions: a 2x3 region counts as 2 distinct squares and a 3x3 region counts as 4 distinct squares.
- Clearing multiple marked squares in a single sweep must use the total deleted cells and the distinct-square multiplier for that sweep.
- Clearing cells in one column must not delete unmarked cells or marked cells in columns the sweep has not reached.
- Gravity after deletion must preserve each column's vertical order while moving cells downward into empty spaces.
- The start screen and in-game view must both show the controls and brief how-to-play guidance.
- Browser autoplay restrictions must not block acceptance; the game only needs a configured looping audio source before user-gesture playback is possible.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The game MUST present a start screen with a start control, visible control cheatsheet, and brief how-to-play instructions before a round begins.
- **FR-002**: The in-game view MUST contain a single main content landmark, a 16-column by 10-row playfield, a live numeric score, and a persistent controls/instructions panel.
- **FR-003**: A round MUST begin with an empty playfield, score 0, no game-over state, and one active 2x2 piece spawned at columns 7-8 and rows 0-1 using 0-indexed coordinates.
- **FR-004**: Each active piece MUST contain four independently assigned cells, where each cell is one of exactly two game colors.
- **FR-005**: The game MUST support keyboard controls where `h` moves left, `l` moves right, `j` soft-drops faster, `k` rotates 90 degrees, and `space` hard-drops instantly; arrow-key aliases MAY mirror these controls.
- **FR-006**: The game MUST prevent any movement, rotation, or fall step that would place a piece outside the 16x10 playfield or overlap settled cells.
- **FR-007**: A piece MUST lock into the settled stack when it can fall no farther because of the floor or settled cells.
- **FR-008**: During normal play, the game MUST automatically spawn the next randomized piece after a piece locks unless the spawn area is blocked.
- **FR-009**: The game MUST enter game-over state when a newly spawned piece cannot occupy the pinned spawn cells.
- **FR-010**: The game-over screen MUST show the final score and a restart control that starts a fresh round.
- **FR-011**: The game MUST detect every aligned monochrome 2x2 square in the settled stack by top-left corner, including overlapping squares inside larger same-color regions.
- **FR-012**: The game MUST mark for deletion every settled cell that participates in at least one detected same-color 2x2 square.
- **FR-013**: The timeline sweep MUST move left-to-right across the full 16-column field in 8 beats, equal to 4.0 seconds at 120 BPM, then repeat continuously.
- **FR-014**: As the sweep passes each column, the game MUST delete marked cells in that column and leave unmarked cells intact.
- **FR-015**: After a sweep deletes cells, the game MUST apply column gravity so remaining cells above gaps fall downward while preserving their order within each column.
- **FR-016**: For each sweep that deletes cells, the game MUST increase score by `(cells deleted in that sweep) x (number of distinct completed 2x2 squares cleared in that sweep)`.
- **FR-017**: The game MUST visually distinguish active pieces, settled cells, marked cells, the sweep bar, clearing cells, and collapsing cells.
- **FR-018**: The game MUST provide polished in-game animation for falling, locking, marking, sweep clearing, and post-clear collapse so state changes are visually legible.
- **FR-019**: The game MUST configure the provided backing track as a looping audio source for rounds, and the sweep MUST stay aligned with the track tempo during normal play.
- **FR-020**: The game MUST remain keyboard operable in a modern desktop browser.
- **FR-021**: When deterministic test mode is enabled, the game MUST pause normal audio-synced automation and allow an external harness to seed randomness, inspect current grid/score/game-over/sweep state, inspect marked cells, spawn specified pieces, advance one gravity step, run a full sweep immediately, and advance sweep progress by a specified duration.
- **FR-022**: In deterministic test mode, inspected grid state MUST include both settled cells and the active falling piece, with row 0 at the top and empty cells represented distinctly from the two colors.
- **FR-023**: In deterministic test mode, advancing one gravity step MUST never auto-spawn a new piece after a lock; the board remains quiescent until the harness explicitly spawns a piece.
- **FR-024**: In deterministic test mode, advancing sweep progress by 250 milliseconds MUST move the sweep by exactly one column, and advancing by 4.0 seconds MUST complete one full traversal.
- **FR-025**: Deterministic test hooks MUST be absent from normal play when test mode is not enabled.
- **FR-026**: The start control, restart control, live score, game-over state, and controls cheatsheet MUST be identifiable by stable automation selectors.

### Key Entities

- **Game Session**: A single playable round, including current screen state, score, game-over status, sweep position, and whether deterministic test mode is active.
- **Playfield Grid**: The 16x10 matrix of cells, where each cell is empty or contains one of the two game colors.
- **Active Piece**: The currently falling 2x2 block, including four color cells, position, orientation, and lock eligibility.
- **Settled Stack**: All locked cells currently occupying the playfield and eligible for square detection.
- **Marked Square**: A detected aligned same-color 2x2 square counted by its top-left coordinate for scoring.
- **Marked Cell**: A settled cell participating in one or more marked squares and eligible for deletion when the sweep passes its column.
- **Timeline Sweep**: The repeating left-to-right timing bar that determines when marked cells clear and when sweep scoring is applied.
- **Score**: The cumulative numeric result of sweep deletions using the pinned scoring formula.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A first-time player can start a round and perform all five primary controls within 30 seconds using only the on-screen instructions.
- **SC-002**: In deterministic verification, a constructed same-color 2x2 square is marked, cleared by the next full sweep, and scored exactly according to the pinned formula in 100% of repeated runs using the same seed and inputs.
- **SC-003**: The sweep completes a full 16-column traversal in 4.0 seconds, with tolerance no greater than 50 milliseconds during normal play and exact duration under deterministic advancement.
- **SC-004**: After any tested deletion pattern, all remaining cells settle to the lowest available spaces in their columns while preserving vertical order in 100% of acceptance cases.
- **SC-005**: Game over appears within one spawn attempt when the pinned spawn area is blocked, and restart returns to an empty grid and score 0 in under 2 seconds.
- **SC-006**: The start screen and in-game view both expose visible controls and how-to-play guidance in every desktop viewport used for acceptance testing.
- **SC-007**: The backing track is configured as a looping round audio source every time a round starts.
- **SC-008**: During manual play-testing, players can visually identify active pieces, marked squares, the sweep position, cleared cells, and falling collapse without relying on hidden state or score alone.

## Assumptions

- The MVP targets modern desktop browsers with keyboard input; mobile and touch controls are outside this phase.
- The game uses exactly two block colors for all pieces and square detection.
- The provided backing track is the only required audio track for the MVP.
- A beat is 0.5 seconds at the pinned 120 BPM tempo, so 8 beats equals a 4.0-second sweep period.
- Normal play uses automatic gravity, automatic piece spawning after locks, and a continuously repeating sweep.
- Deterministic test mode is only for external automation and does not need to be discoverable or visible to players.
- No accounts, persistence, high scores, leaderboard, multiplayer, skins, themes, or settings menus are included in this MVP.
