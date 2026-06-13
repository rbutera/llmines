## ADDED Requirements

### Requirement: Score is visible during play

The score SHALL be readable on screen throughout the playing phase. It MUST be legible against the fullscreen 3D board (not dimmed into the background) and positioned peripherally (top-left) so it does not compete with the board for attention. The in-play score readout MUST keep its stable `score` test identifier so the score can be asserted in automated tests.

#### Scenario: Score readout is legible while playing
- **WHEN** the game is in the playing phase
- **THEN** the current score is shown top-left and is legible against the board (not lost in a dimmed/receded layer)

#### Scenario: Score updates as it rises
- **WHEN** the player's score increases
- **THEN** the on-screen score updates to the new value

#### Scenario: Score test contract is preserved
- **WHEN** the automated suite reads the in-play score element
- **THEN** the element with the `score` test id is present and shows the current score

### Requirement: No dead chrome

The HUD MUST NOT contain unexplained or non-functional chrome. The unexplained decorative bottom bar and the duplicate bottom pause hint SHALL be removed. The pointless "TITLE" button on the game-over screen SHALL be removed along with its handler. Functional elements that display real state (the timeline-sweep caret, the BPM gauge, the NEXT-piece queue, the pause control) SHALL be retained.

#### Scenario: The bottom decorative bar is gone
- **WHEN** the in-play HUD is shown
- **THEN** there is no unexplained decorative bar at the bottom of the screen
- **AND** the timeline-sweep caret (which shows the real sweep position) is still shown

#### Scenario: The title button is gone
- **WHEN** the game-over screen is shown
- **THEN** there is no "TITLE" button
- **AND** the game-over screen offers PLAY AGAIN and the leaderboard (RANKS) only

### Requirement: Defined control surface per phase

The set of controls present in each phase SHALL be exactly the following, all keyboard-reachable real buttons within the single `main` landmark:

- **Start:** ENGAGE (start), CONTROLS, sign in / signed-in, LEADERBOARD. No skin control.
- **Playing:** pause (button + Esc). Read-only: score, BPM/tempo gauge, NEXT queue, timeline-sweep caret. No skin control.
- **Pause:** RESUME, END RUN, music volume, mute. No skin control.
- **Game over:** PLAY AGAIN (restart → base skin), RANKS (leaderboard). No title button.

#### Scenario: Start phase controls
- **WHEN** the start screen is shown
- **THEN** ENGAGE, CONTROLS, sign-in/signed-in, and LEADERBOARD are present, and no skin-cycle control is present

#### Scenario: Pause overlay has no skin selector
- **WHEN** the pause overlay is shown
- **THEN** RESUME, END RUN, volume, and mute are present, and there is no skin selector

#### Scenario: Remaining controls are keyboard reachable
- **WHEN** the player navigates the HUD with the keyboard
- **THEN** every remaining control is a focusable button reachable by keyboard

### Requirement: Single main landmark preserved

The page SHALL expose exactly one `main` landmark (the game root). Chrome cleanup MUST NOT introduce a second `main`, and MUST NOT remove the single root landmark.

#### Scenario: Exactly one main landmark
- **WHEN** the accessibility tree is inspected in any phase
- **THEN** there is exactly one `main` landmark (the game root)
