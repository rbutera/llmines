# Requirements Document

## Introduction

LLMines is a playable, browser-based clone of the puzzle game *Lumines*. A 2×2 block of four
independently-coloured cells falls onto a 16-column × 10-row grid under gravity. Players move,
rotate, and drop the block using vim-style keyboard controls. When cells settle into the stack,
any aligned monochrome 2×2-or-larger region is marked for deletion. A vertical timeline bar sweeps
left-to-right across the field in time with a 120 BPM backing track, deleting marked cells column
by column, scoring per a pinned rule, and collapsing the stack by gravity after each pass. The game
presents a start screen, an in-game view with live score and a persistent controls legend, and a
game-over screen with restart.

The application is built on the existing create-t3-app scaffold (Next.js App Router, TypeScript,
tRPC, Tailwind) with PixiJS for rendering. To support deterministic automated testing, a test
interface (`window.__lumines`) and DOM test hooks are exposed only when the environment flag
`NEXT_PUBLIC_TEST_MODE=1` is set; production behaviour is unchanged when the flag is unset.

This document defines what the system must do. Implementation approaches (rendering details,
animation techniques, data structures) are deferred to the design phase.

## Glossary

- **Game**: The complete LLMines application, including rendering, input handling, game-loop logic, audio, and screens.
- **Playfield**: The 16-column × 10-row cell grid on which blocks fall and settle. Columns are 0-indexed 0–15; rows are 0-indexed 0–9 with row 0 at the top.
- **Cell**: A single grid position. A cell is empty (`null`) or holds one of two colours, **Color A** (`0`) or **Color B** (`1`).
- **Color**: One of exactly two values: `0` (Color A) or `1` (Color B).
- **Block** (also **Piece**): A 2×2 group of four cells. Each of the four cells is independently one of the two colours, randomised per block. Represented as `[[Color, Color], [Color, Color]]` ordered `[topRow, bottomRow]`.
- **Spawn_Position**: The pinned location where a new block enters: columns 7–8 (0-indexed), rows 0–1.
- **Active_Block**: The block currently falling and under player control, not yet locked into the stack.
- **Stack**: The set of cells that have locked into place on the Playfield and are no longer player-controlled.
- **Gravity_Tick**: The recurring event that advances the Active_Block downward by one row during normal play.
- **Lock**: The event in which an Active_Block can fall no further (resting on the floor or on Stack cells) and its cells become part of the Stack.
- **Marked_Cell**: A Stack cell that is part of at least one aligned monochrome 2×2-or-larger region and is therefore designated for deletion.
- **Monochrome_2x2**: An aligned 2×2 region of four Stack cells that all hold the same colour.
- **Distinct_Square**: A counted Monochrome_2x2, identified by its top-left corner. For monochrome regions larger than 2×2, every aligned 2×2 whose top-left corner lies within the region and whose four cells are the same single colour counts as one Distinct_Square.
- **Timeline_Bar** (also **Sweep**): The vertical bar that moves left-to-right across the Playfield, deleting Marked_Cells as it passes each column.
- **Sweep_Period**: The time for the Timeline_Bar to traverse all 16 columns: 8 beats = 4.0 seconds at 120 BPM, i.e. 0.25 seconds per column. After completing a traversal the Sweep restarts from the leftmost column and repeats continuously.
- **Beat**: A unit of musical time equal to 0.5 seconds at 120 BPM.
- **Backing_Track**: The looping audio asset served at `/backing-track.mp3`.
- **Score**: The player's cumulative point total.
- **Sweep_Deletion_Event**: A single complete left-to-right traversal of the Timeline_Bar, during which Marked_Cells are deleted.
- **Test_Mode**: The operating mode active when `NEXT_PUBLIC_TEST_MODE=1`, exposing a deterministic test interface and pausing audio-synced auto-progression.
- **Test_Api**: The JavaScript object exposed at `window.__lumines` in Test_Mode, conforming to the `LuminesTestApi` interface.
- **Start_Screen**: The initial screen presenting a start control and how-to-play information.
- **In_Game_View**: The screen showing the Playfield, live Score, and persistent controls legend during play.
- **Game_Over_Screen**: The screen shown when the Game ends, presenting the final Score and a restart control.
- **Controls_Cheatsheet**: The on-screen legend describing the control scheme and brief how-to-play instructions.

## Requirements

### Requirement 1: Playfield Rendering

**User Story:** As a player, I want to see the empty playfield when the game begins, so that I understand the playing area before blocks start falling.

#### Acceptance Criteria

1. THE Game SHALL render a Playfield of 16 columns and 10 rows using PixiJS within a React component.
2. WHEN the In_Game_View is first displayed, THE Game SHALL render every Playfield cell as empty.
3. THE Game SHALL render Color A cells and Color B cells with visually distinct appearances.

### Requirement 2: Block Spawning

**User Story:** As a player, I want a new two-by-two block to appear at the top centre, so that I have a piece to position.

#### Acceptance Criteria

1. WHEN a new block is spawned during normal play, THE Game SHALL place an Active_Block occupying columns 7–8 and rows 0–1.
2. WHEN a block is spawned, THE Game SHALL assign each of the block's four cells independently to Color A or Color B using the seeded randomiser.
3. WHILE no game-over condition is met during normal play, THE Game SHALL spawn a new Active_Block after the previous Active_Block locks.

### Requirement 3: Gravity and Falling

**User Story:** As a player, I want my block to fall over time, so that the game progresses and pieces settle.

#### Acceptance Criteria

1. WHEN a Gravity_Tick occurs during normal play AND the Active_Block can move down one row without overlapping the floor or Stack cells, THE Game SHALL move the Active_Block down one row.
2. IF the Active_Block cannot move down one row because the next row is occupied by the floor or Stack cells, THEN THE Game SHALL Lock the Active_Block into the Stack.
3. WHEN the Active_Block Locks, THE Game SHALL set each occupied cell of the Stack to the colour of the corresponding block cell.

### Requirement 4: Player Controls

**User Story:** As a player, I want vim-style keyboard controls to move, rotate, and drop my block, so that I can position pieces precisely.

#### Acceptance Criteria

1. WHEN the `h` key is pressed AND the Active_Block can move one column left without leaving the Playfield or overlapping Stack cells, THE Game SHALL move the Active_Block one column left.
2. WHEN the `l` key is pressed AND the Active_Block can move one column right without leaving the Playfield or overlapping Stack cells, THE Game SHALL move the Active_Block one column right.
3. WHEN the `j` key is pressed, THE Game SHALL increase the Active_Block descent rate for a soft drop.
4. WHEN the `k` key is pressed AND the rotated Active_Block fits within the Playfield without overlapping Stack cells, THE Game SHALL rotate the Active_Block 90 degrees.
5. WHEN the `space` key is pressed, THE Game SHALL move the Active_Block straight down to its lowest legal position and Lock the Active_Block immediately.
6. WHERE arrow keys are configured as aliases, THE Game SHALL map Left Arrow to `h`, Right Arrow to `l`, Down Arrow to `j`, and Up Arrow to `k`.
7. IF a control input would move or rotate the Active_Block into the Playfield boundary or Stack cells, THEN THE Game SHALL leave the Active_Block position and orientation unchanged.

### Requirement 5: Square Formation and Marking

**User Story:** As a player, I want same-colour two-by-two regions to be marked, so that I can see which cells the sweep will clear.

#### Acceptance Criteria

1. WHEN the Stack changes, THE Game SHALL mark every Stack cell that belongs to at least one Monochrome_2x2.
2. WHEN the Stack changes, THE Game SHALL clear the marked designation from every Stack cell that no longer belongs to any Monochrome_2x2.
3. THE Game SHALL count Distinct_Squares such that each aligned 2×2 region whose four cells share a single colour contributes exactly one Distinct_Square, identified by its top-left corner.

### Requirement 6: Timeline Sweep and Deletion

**User Story:** As a player, I want a timeline bar to sweep across the field and clear marked cells in tempo, so that play stays synced to the music.

#### Acceptance Criteria

1. THE Game SHALL move the Timeline_Bar left-to-right across all 16 columns over a Sweep_Period of 8 beats (4.0 seconds at 120 BPM, 0.25 seconds per column).
2. WHEN the Timeline_Bar completes a full traversal, THE Game SHALL restart the Timeline_Bar from the leftmost column and continue sweeping continuously.
3. WHEN the Timeline_Bar passes a column, THE Game SHALL delete every Marked_Cell in that column.
4. WHEN the Timeline_Bar passes a column AND deletes one or more cells, THE Game SHALL apply scoring for that Sweep_Deletion_Event per Requirement 7.

### Requirement 7: Scoring

**User Story:** As a player, I want my score to increase when the sweep clears squares, so that I am rewarded for forming larger monochrome regions.

#### Acceptance Criteria

1. WHEN a Sweep_Deletion_Event deletes one or more cells, THE Game SHALL increase the Score by the product of the number of cells deleted during that Sweep_Deletion_Event and the number of Distinct_Squares cleared during that Sweep_Deletion_Event.
2. WHEN the Game starts, THE Game SHALL set the Score to 0.
3. WHEN the Score changes, THE Game SHALL display the current Score value in the In_Game_View.

### Requirement 8: Gravity After Deletion

**User Story:** As a player, I want cells above cleared gaps to fall down, so that the stack collapses naturally after a sweep.

#### Acceptance Criteria

1. WHEN the Timeline_Bar has deleted cells in a column, THE Game SHALL move each remaining Stack cell in that column downward so that no empty cell remains below an occupied cell in that column.
2. WHEN cells have settled by gravity after a deletion, THE Game SHALL re-evaluate Marked_Cells per Requirement 5.

### Requirement 9: Game Over

**User Story:** As a player, I want the game to end when the stack reaches the top, so that there is a clear win/lose condition.

#### Acceptance Criteria

1. IF a new block cannot be placed at the Spawn_Position because one or more of those cells are occupied by Stack cells, THEN THE Game SHALL end the Game and display the Game_Over_Screen.
2. WHEN the Game_Over_Screen is displayed, THE Game SHALL show the final Score.
3. WHEN the Game_Over_Screen is displayed, THE Game SHALL present a restart control that returns the Game to a new playable session with Score reset to 0.

### Requirement 10: Audio

**User Story:** As a player, I want background music that loops while I play, so that the experience matches the music-synced gameplay.

#### Acceptance Criteria

1. THE Game SHALL provide an audio source that points to `/backing-track.mp3`.
2. THE Game SHALL enable looping on the Backing_Track audio source.
3. WHEN the Game starts during normal play, THE Game SHALL begin playback of the Backing_Track.
4. THE Game SHALL keep the Timeline_Bar Sweep_Period locked to the 120 BPM tempo during normal play.

### Requirement 11: Screens and Navigation

**User Story:** As a player, I want distinct start, in-game, and game-over screens, so that I can navigate the game flow clearly.

#### Acceptance Criteria

1. WHEN the Game loads, THE Game SHALL display the Start_Screen with a start control.
2. WHEN the start control is activated, THE Game SHALL display the In_Game_View and begin a new playable session.
3. THE In_Game_View SHALL display the Playfield and the live Score.
4. WHEN the Game ends, THE Game SHALL display the Game_Over_Screen with the final Score and a restart control.

### Requirement 12: Controls Cheatsheet and Instructions

**User Story:** As a player, I want the controls and a brief how-to-play visible, so that I can learn the game without external documentation.

#### Acceptance Criteria

1. THE Start_Screen SHALL display the Controls_Cheatsheet describing the control scheme and brief how-to-play instructions.
2. WHILE the In_Game_View is displayed, THE Game SHALL display a persistent Controls_Cheatsheet legend.

### Requirement 13: Accessibility and Browser Support

**User Story:** As a player using a desktop browser, I want the game to be keyboard operable and structurally sound, so that it is usable and accessible.

#### Acceptance Criteria

1. THE Game SHALL be fully operable using the keyboard controls defined in Requirement 4.
2. THE Game SHALL render exactly one `<main>` landmark element.

### Requirement 14: Animation and Visual Polish

**User Story:** As a player, I want polished Lumines-style animations, so that the game feels alive rather than a static grid swapping cells.

#### Acceptance Criteria

1. WHILE the Active_Block falls and settles, THE Game SHALL animate the block's movement and settling.
2. WHILE the Timeline_Bar sweeps, THE Game SHALL animate the Timeline_Bar moving across the Playfield.
3. WHEN cells are marked, highlighted, cleared, or collapsed, THE Game SHALL animate those state transitions.
4. THE Game SHALL present a cohesive visual interface across the Start_Screen, In_Game_View, and Game_Over_Screen.

### Requirement 15: Music Credit

**User Story:** As the project owner, I want the required music attribution displayed, so that the NoCopyrightSounds licence terms are honoured.

#### Acceptance Criteria

1. THE Game SHALL display the credit text "Sano - SET ME FREE [NCS Release]. Music provided by NoCopyrightSounds. https://youtu.be/e1QIqXmZ2os" in the game's footer or credits.

### Requirement 16: Test Mode Activation and Isolation

**User Story:** As a test harness, I want a deterministic test interface that is absent in production, so that I can drive the game without affecting normal play behaviour.

#### Acceptance Criteria

1. WHERE `NEXT_PUBLIC_TEST_MODE` is unset, THE Game SHALL run with auto-gravity and music-synced sweep, and SHALL NOT expose the Test_Api.
2. WHERE `NEXT_PUBLIC_TEST_MODE` equals `1`, THE Game SHALL expose the Test_Api at `window.__lumines`.
3. WHERE `NEXT_PUBLIC_TEST_MODE` equals `1`, THE Game SHALL pause the audio-synced automatic sweep loop and advance game state only in response to Test_Api calls.

### Requirement 17: Test API — State Inspection

**User Story:** As a test harness, I want to read deterministic game state, so that I can assert on the grid, score, sweep position, and marked cells.

#### Acceptance Criteria

1. WHEN `state()` is called in Test_Mode, THE Test_Api SHALL return an object containing `grid`, `score`, `gameOver`, and `sweepX`.
2. THE `grid` returned by `state()` SHALL reflect both the settled Stack and the Active_Block, ordered `[row][col]` with row 0 at the top, sized 16 columns by 10 rows.
3. WHEN `marked()` is called in Test_Mode, THE Test_Api SHALL return the list of `{ row, col }` coordinates of every Marked_Cell.

### Requirement 18: Test API — Seeding and Spawning

**User Story:** As a test harness, I want to seed randomness and place specific pieces, so that I can construct deterministic scenarios.

#### Acceptance Criteria

1. WHEN `seed(n)` is called in Test_Mode, THE Test_Api SHALL set the randomiser seed to `n` so that subsequent random block generation is deterministic.
2. WHEN `spawn(piece)` is called in Test_Mode, THE Test_Api SHALL place the given piece immediately at the Spawn_Position (columns 7–8, rows 0–1).
3. IF `spawn(piece)` is called in Test_Mode WHILE an Active_Block is mid-fall, THEN THE Test_Api SHALL Lock the existing Active_Block first and then place the given piece at the Spawn_Position.
4. WHEN `spawn(piece)` is called multiple times consecutively in Test_Mode, THE Test_Api SHALL stack the resulting pieces deterministically.

### Requirement 19: Test API — Deterministic Advancement

**User Story:** As a test harness, I want to advance gravity and the sweep deterministically, so that I can verify timing and mechanics without depending on wall-clock time or audio.

#### Acceptance Criteria

1. WHEN `tick()` is called in Test_Mode, THE Test_Api SHALL advance the Active_Block by one Gravity_Tick.
2. WHEN `tick()` is called in Test_Mode AND the Active_Block Locks as a result, THE Test_Api SHALL leave the Playfield quiescent without spawning a new block until `spawn()` is called.
3. WHEN `sweepNow()` is called in Test_Mode, THE Test_Api SHALL perform a complete Timeline_Bar traversal that deletes Marked_Cells and applies scoring and gravity.
4. WHEN `sweepProgress(dtMs)` is called in Test_Mode, THE Test_Api SHALL advance the Timeline_Bar position by the equivalent of `dtMs` milliseconds at the rate of 0.25 seconds per column.

### Requirement 20: DOM Test Hooks

**User Story:** As a test harness, I want stable DOM identifiers for flow controls and state, so that I can drive and assert on the UI without visual scraping.

#### Acceptance Criteria

1. THE Start_Screen SHALL render the start control with the attribute `data-testid="start-button"`.
2. THE Game_Over_Screen SHALL render the restart control with the attribute `data-testid="restart"`.
3. THE In_Game_View SHALL render the live Score with the attribute `data-testid="score"` whose text content equals the current Score number.
4. WHILE the Game_Over_Screen is displayed, THE Game SHALL render an element with the attribute `data-testid="game-over"`.
5. THE Controls_Cheatsheet SHALL render with the attribute `data-testid="controls-cheatsheet"`.
