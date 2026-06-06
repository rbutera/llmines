# Requirements Document

## Introduction

LLMines is a browser-based clone of the puzzle game Lumines, built with Next.js (App Router), PixiJS for rendering, and synced to a 120 BPM backing track. Players manipulate falling 2x2 blocks composed of two colours on a 16x10 grid. Same-colour 2x2 squares are marked for deletion and cleared by a music-synced timeline sweep bar. The game features vim-style keyboard controls, a scoring system based on cells deleted and distinct squares cleared per sweep, and polished animations inspired by the original Lumines.

## Glossary

- **Grid**: The 16-column by 10-row playfield where cells are placed and cleared.
- **Cell**: A single unit within the Grid, occupying one column and one row. A Cell is either empty (null) or filled with Colour A (0) or Colour B (1).
- **Piece**: A 2x2 block of 4 Cells, each independently assigned Colour A or Colour B, that falls from the top of the Grid.
- **Spawn_Position**: Columns 7–8, rows 0–1 (0-indexed) at the top-centre of the Grid where each new Piece appears.
- **Stack**: The collection of settled (locked) Cells in the Grid.
- **Colour_A**: One of the two possible cell colours, represented as value 0.
- **Colour_B**: One of the two possible cell colours, represented as value 1.
- **Monochrome_Square**: An aligned 2x2 area within the Stack where all four Cells share the same colour.
- **Marked_Cell**: A Cell that belongs to at least one Monochrome_Square and is pending deletion by the Sweep_Bar.
- **Distinct_Square_Count**: The number of unique Monochrome_Squares identified by their top-left corner position. For monochrome regions larger than 2x2, every aligned 2x2 whose top-left corner is monochrome counts as one distinct square.
- **Sweep_Bar**: A vertical line that traverses the Grid from left to right, synchronized to the backing track, clearing Marked_Cells as it passes each column.
- **Sweep_Period**: The time for one full traversal of the Sweep_Bar across all 16 columns: 8 beats at 120 BPM = 4.0 seconds.
- **Gravity_Tick**: A periodic event that moves the active Piece down by one row.
- **Soft_Drop**: Player action that increases the falling speed of the active Piece.
- **Hard_Drop**: Player action that instantly locks the active Piece at its lowest valid position.
- **Rotation**: A 90-degree clockwise rotation of the active Piece's cell arrangement.
- **Lock**: The event where an active Piece becomes part of the Stack because it can fall no further.
- **Game_Over**: The state triggered when a newly spawned Piece cannot be placed because the Stack occupies the Spawn_Position.
- **Backing_Track**: The audio file located at `/backing-track.mp3`, played at 120 BPM.
- **Test_Mode**: A mode activated by the environment variable `NEXT_PUBLIC_TEST_MODE=1` that exposes a deterministic JavaScript API on `window.__lumines`.
- **Renderer**: The PixiJS-based canvas rendering system embedded in a React component via a ref.
- **Start_Screen**: The initial screen shown on load with a start button and controls cheatsheet.
- **Game_Screen**: The active play view containing the Grid, score display, and controls legend.
- **Game_Over_Screen**: The screen displayed after Game_Over showing the final score and a restart option.

## Requirements

### Requirement 1: Playfield Rendering

**User Story:** As a player, I want to see a clearly rendered 16x10 grid, so that I can understand the game state at all times.

#### Acceptance Criteria

1. THE Renderer SHALL display the Grid as a 16-column by 10-row playfield using a PixiJS canvas element sized so that each Cell occupies an equal square region and the full Grid is visible without scrolling.
2. THE Renderer SHALL render each filled Cell in the Grid using a distinct solid fill colour per cell type, such that the fill colour for Colour_A Cells differs from the fill colour for Colour_B Cells by a clearly distinguishable hue.
3. THE Renderer SHALL render empty Cells with no fill or a background-only fill that contains neither the Colour_A nor the Colour_B fill colour.
4. THE Renderer SHALL embed the PixiJS canvas inside a React component using a ref, and the canvas container element SHALL have the attribute `data-testid="grid"`.
5. WHEN the Grid state changes (Cell placed, cleared, or Piece moved), THE Renderer SHALL update the canvas to reflect the current Grid state within the same animation frame.

### Requirement 2: Piece Spawning

**User Story:** As a player, I want new 2x2 blocks to appear at the top of the grid, so that I always have a piece to play.

#### Acceptance Criteria

1. WHEN the game starts or a Piece locks, THE Grid SHALL spawn a new Piece at the Spawn_Position (columns 7–8, rows 0–1) immediately on the same tick, with no delay before the new Piece becomes the active Piece.
2. THE Piece SHALL consist of 4 Cells arranged in a 2x2 pattern, with each Cell independently assigned either Colour_A or Colour_B with uniform probability (50% chance of each colour per Cell).
3. IF any one or more Cells of a newly spawned Piece overlap occupied Cells in the Stack at the Spawn_Position, THEN THE Grid SHALL trigger Game_Over.

### Requirement 3: Piece Falling (Gravity)

**User Story:** As a player, I want pieces to fall at a steady pace, so that I have time to position them.

#### Acceptance Criteria

1. WHILE a Piece is active, THE Grid SHALL move the Piece down by one row on each Gravity_Tick, where the Gravity_Tick interval is 800 milliseconds (0.8 seconds per row).
2. WHEN the Piece cannot move down because any Cell in the row immediately below the Piece's bottom edge is occupied or the bottom edge is at row 9 (the floor), THE Grid SHALL Lock the Piece into the Stack immediately on that same Gravity_Tick with no lock delay.
3. WHEN a Piece is Locked, THE Grid SHALL scan the Stack for new Monochrome_Squares and mark all Cells belonging to detected squares as Marked_Cells before spawning the next Piece.
4. IF a Soft_Drop or Hard_Drop causes the Piece to reach a position where it cannot move down, THEN THE Grid SHALL Lock the Piece immediately using the same locking rules as criterion 2.

### Requirement 4: Keyboard Controls

**User Story:** As a player, I want vim-style keyboard controls to move, rotate, and drop pieces, so that I can play efficiently.

#### Acceptance Criteria

1. WHEN the player presses the `h` key, THE Grid SHALL move the active Piece one column to the left if the destination is unoccupied and within bounds.
2. WHEN the player presses the `l` key, THE Grid SHALL move the active Piece one column to the right if the destination is unoccupied and within bounds.
3. WHEN the player presses the `j` key, THE Grid SHALL apply Soft_Drop by advancing the Piece down one row immediately, and while the key is held, THE Grid SHALL continue advancing the Piece down one row at an interval no greater than 50 milliseconds.
4. WHEN the player presses the `k` key, THE Grid SHALL rotate the active Piece 90 degrees clockwise if the rotated position is unoccupied and within bounds.
5. WHEN the player presses the `space` key, THE Grid SHALL Hard_Drop the active Piece to its lowest valid position and Lock it immediately.
6. WHEN the player presses an arrow key (left, right, down, up), THE Grid SHALL treat the input as equivalent to `h`, `l`, `j`, `k` respectively.
7. IF the active Piece cannot move or rotate in the requested direction due to boundary or Stack collision, THEN THE Grid SHALL ignore the input and leave the Piece in its current position without altering its orientation.
8. WHILE no Piece is active (during Game_Over_Screen, Start_Screen, or between Lock and next spawn), THE Grid SHALL ignore all movement and rotation key inputs.
9. WHEN the player holds the `h` or `l` key, THE Grid SHALL repeat the lateral movement at an interval between 100 milliseconds and 200 milliseconds after an initial delay between 200 milliseconds and 300 milliseconds.

### Requirement 5: Square Formation and Marking

**User Story:** As a player, I want same-colour 2x2 squares to be identified and marked for clearing, so that I can build combos.

#### Acceptance Criteria

1. WHEN a Piece is Locked, THE Grid SHALL scan the entire Stack for all aligned 2x2 areas where all four Cells share the same colour.
2. WHEN one or more Monochrome_Squares are found, THE Grid SHALL mark all Cells belonging to those squares as Marked_Cells, preserving any existing Marked_Cell state from prior scans that has not yet been cleared by the Sweep_Bar.
3. THE Grid SHALL identify Monochrome_Squares by their top-left corner position, counting every valid top-left corner of an aligned 2x2 monochrome area as one distinct square (e.g., a 2x3 monochrome block yields 2 distinct squares; a 3x3 monochrome block yields 4 distinct squares).
4. THE Renderer SHALL visually distinguish Marked_Cells from unmarked filled Cells.
5. WHILE Marked_Cells exist on the Grid, THE Grid SHALL retain their Marked_Cell state until the Sweep_Bar passes their column and deletes them.

### Requirement 6: Timeline Sweep

**User Story:** As a player, I want a sweep bar to cross the grid in sync with the music, clearing marked squares as it passes, so that the game has rhythm.

#### Acceptance Criteria

1. THE Sweep_Bar SHALL traverse the Grid from column 0 to column 15 in exactly one Sweep_Period (4.0 seconds at 120 BPM), advancing at a constant rate of 0.25 seconds per column.
2. WHEN the Sweep_Bar's leading edge reaches the left boundary of a column containing Marked_Cells, THE Grid SHALL delete all Marked_Cells in that column before the Sweep_Bar advances to the next column.
3. WHEN the Sweep_Bar completes a full traversal past column 15, THE Sweep_Bar SHALL wrap to column 0 with zero additional delay, maintaining continuous looping until gameplay ends.
4. THE Sweep_Bar SHALL remain synchronized with the Backing_Track such that cumulative drift between the Sweep_Bar position and the expected beat-aligned position does not exceed ±20 milliseconds.
5. THE Renderer SHALL display the Sweep_Bar as a vertical line at least 1 pixel wide, visually distinct from Grid lines, updating its horizontal position every animation frame.
6. IF the Backing_Track is paused or stopped during gameplay, THEN THE Sweep_Bar SHALL also pause at its current column position and resume traversal from that position when the Backing_Track resumes.
7. WHEN a Cell is marked in a column that the Sweep_Bar has already passed in the current traversal cycle, THE Grid SHALL retain that Marked_Cell until the Sweep_Bar reaches that column on the next cycle.

### Requirement 7: Gravity After Deletion

**User Story:** As a player, I want cells above cleared spaces to fall down, so that the grid settles naturally.

#### Acceptance Criteria

1. WHEN the Sweep_Bar deletes Marked_Cells in a column, THE Grid SHALL immediately apply gravity to that column by moving all Cells above each empty space downward so that no empty gap remains below a filled Cell, preserving the top-to-bottom relative order of Cells within the column.
2. WHEN Cells settle after gravity, THE Grid SHALL re-scan all columns that had gravity applied for newly formed Monochrome_Squares and mark applicable Cells.
3. IF newly Marked_Cells are created by a post-gravity re-scan while the Sweep_Bar has already passed their column in the current traversal, THEN THE Grid SHALL defer their deletion until the Sweep_Bar reaches their column on the next traversal.
4. WHEN the Sweep_Bar has not yet reached the column of newly Marked_Cells created by a post-gravity re-scan, THE Grid SHALL delete those Marked_Cells when the Sweep_Bar reaches their column during the current traversal.

### Requirement 8: Scoring

**User Story:** As a player, I want my score to reflect the number and size of cleared squares, so that I am rewarded for building large combos.

#### Acceptance Criteria

1. WHEN the Sweep_Bar completes a full traversal, THE Grid SHALL calculate the score increment as: (total Marked_Cells deleted during that traversal) multiplied by (Distinct_Square_Count cleared during that traversal), and add the result to the cumulative score.
2. THE Game_Screen SHALL display the current cumulative score as an integer starting at 0 in an element with `data-testid="score"`.
3. WHEN the Sweep_Bar completes a full traversal and the score increment is calculated, THE Grid SHALL update the displayed score within the same frame so that the new cumulative total is visible before the next traversal begins.
4. IF Marked_Cells deleted by the Sweep_Bar cause gravity to form new Monochrome_Squares within the same traversal, THEN THE Grid SHALL include those newly marked cells and their Distinct_Square_Count in the next traversal's score calculation, not the current one.
5. IF a sweep traversal deletes zero Marked_Cells, THEN THE Grid SHALL not change the cumulative score.

### Requirement 9: Game Over

**User Story:** As a player, I want to know when the game ends, so that I can see my final score and try again.

#### Acceptance Criteria

1. WHEN a newly spawned Piece cannot be placed because the Stack occupies the Spawn_Position (columns 7–8, rows 0–1), THE Grid SHALL trigger Game_Over.
2. WHEN Game_Over is triggered, THE Grid SHALL stop the Sweep_Bar, stop the Backing_Track playback, and ignore any further player keyboard input directed at Piece movement or dropping.
3. WHEN Game_Over is triggered, THE Game_Screen SHALL transition to the Game_Over_Screen.
4. THE Game_Over_Screen SHALL contain an element with `data-testid="game-over"`.
5. THE Game_Over_Screen SHALL display the final cumulative score in an element with `data-testid="final-score"` and a restart button with `data-testid="restart"`.
6. WHEN the player activates the restart button, THE Grid SHALL reset to its initial empty state (all Cells empty, no Marked_Cells), reset the score to zero, reset the Sweep_Bar position to column 0, and transition to the Start_Screen.

### Requirement 10: Audio Playback

**User Story:** As a player, I want a music track to play during the game and loop continuously, so that the sweep bar stays in rhythm.

#### Acceptance Criteria

1. WHEN the game starts, THE Game_Screen SHALL create an audio source with its `src` attribute set to `/backing-track.mp3`.
2. THE Game_Screen SHALL configure the audio source with the `loop` property set to `true`.
3. WHILE the Backing_Track is playing, THE Sweep_Bar SHALL compute its horizontal position using the formula `sweepX = (currentTime % 4.0) / 4.0 * 16`, where `currentTime` is the Backing_Track's elapsed playback time in seconds, producing a value that cycles across 16 units every 4.0 seconds (corresponding to one bar at 120 BPM).
4. IF the Backing_Track is not playing (e.g., browser blocks autoplay due to gesture policies), THEN THE Sweep_Bar SHALL still derive its position from elapsed wall-clock time using the same formula so that gameplay continues without interruption.
5. IF the browser blocks autoplay due to gesture policies, THEN THE Game_Screen SHALL suppress any playback error and shall not display an error state to the player.
6. WHEN the Backing_Track reaches its end, THE Game_Screen SHALL seamlessly restart playback from the beginning with no audible gap, as guaranteed by the `loop` property.

### Requirement 11: Start Screen

**User Story:** As a player, I want a start screen with a play button, so that I can begin the game when ready.

#### Acceptance Criteria

1. WHEN the application loads, THE Start_Screen SHALL be displayed as the initial view.
2. THE Start_Screen SHALL display a start button with `data-testid="start-button"`.
3. THE Start_Screen SHALL display the controls cheatsheet with `data-testid="controls-cheatsheet"` showing the mapping: `h` = move left, `l` = move right, `j` = soft-drop, `k` = rotate, `space` = hard-drop, and the arrow-key equivalents (left, right, down, up corresponding to `h`, `l`, `j`, `k`).
4. THE Start_Screen SHALL display how-to-play instructions in an element with `data-testid="instructions"` stating that the player must manipulate falling 2x2 blocks to form same-colour 2x2 squares, which are then cleared by the Sweep_Bar to earn points.
5. WHEN the player activates the start button, THE Start_Screen SHALL transition to the Game_Screen, spawn the first Piece at the Spawn_Position, and start the Backing_Track playback.

### Requirement 12: In-Game Controls Legend

**User Story:** As a player, I want to see the controls at all times during gameplay, so that I never forget the key mappings.

#### Acceptance Criteria

1. WHILE the Game_Screen is active, THE Game_Screen SHALL display a persistent controls legend panel with `data-testid="controls-cheatsheet"` showing all 5 key mappings: `h` = move left, `l` = move right, `j` = soft-drop, `k` = rotate, `space` = hard-drop.
2. WHILE the Game_Screen is active, THE controls legend panel SHALL remain visible without overlapping or obscuring the Grid play area.
3. WHILE the Game_Screen is active, THE controls legend panel SHALL remain in a fixed position and not be removed, hidden, or repositioned during gameplay events such as piece movement, line clears, or score updates.

### Requirement 13: Accessibility

**User Story:** As a player using assistive technology, I want the game to be keyboard-operable and use proper landmarks, so that I can navigate the interface.

#### Acceptance Criteria

1. THE Renderer SHALL render all game screens within a single `<main>` landmark element.
2. THE Grid SHALL be operable using only the keyboard, accepting all key inputs defined in Requirement 4 (h, l, j, k, space, and arrow keys) without requiring mouse interaction.
3. THE Start_Screen, Game_Screen, and Game_Over_Screen SHALL ensure all interactive elements (buttons) are focusable via Tab key navigation, display a visible focus indicator when focused, and are activatable via both Enter and Space keys.
4. WHEN a screen transition occurs (Start_Screen to Game_Screen, Game_Screen to Game_Over_Screen, or Game_Over_Screen to Start_Screen), THE Renderer SHALL move keyboard focus to the first interactive element or the primary content container of the new screen.

### Requirement 14: Test Mode API

**User Story:** As a developer, I want a deterministic test interface exposed in test mode, so that I can write automated tests without timing dependencies.

#### Acceptance Criteria

1. WHEN `NEXT_PUBLIC_TEST_MODE=1` is set, THE Grid SHALL expose a `window.__lumines` object implementing the LuminesTestApi interface.
2. WHEN `NEXT_PUBLIC_TEST_MODE` is not set to `1`, THE Grid SHALL not expose the `window.__lumines` object or any test hooks.
3. WHEN `seed(n)` is called, THE Grid SHALL use the provided seed for deterministic random colour generation in subsequent Piece spawns.
4. WHEN `state()` is called, THE Grid SHALL return the current Grid contents (including the active falling Piece) as a 10-row by 16-column array (`Cell[][]` where `Cell = 0 | 1 | null`), score as a number, gameOver as a boolean, and sweepX as a number (0–16 float representing current sweep column position).
5. WHEN `marked()` is called, THE Grid SHALL return an array of `{ row: number; col: number }` objects representing all currently Marked_Cells.
6. WHEN `spawn(piece)` is called with a `Piece` argument (`[[Color, Color], [Color, Color]]`), THE Grid SHALL lock any active falling Piece first, then place the specified Piece at the Spawn_Position (columns 7–8, rows 0–1).
7. WHEN `tick()` is called, THE Grid SHALL advance the Piece by one Gravity_Tick without auto-spawning a new Piece if the current one locks.
8. WHEN `sweepNow()` is called, THE Grid SHALL execute a full sweep immediately, clearing all currently Marked_Cells and applying scoring.
9. WHEN `sweepProgress(dtMs)` is called, THE Grid SHALL advance the Sweep_Bar position by the equivalent of `dtMs` milliseconds of elapsed time (full 16-column traversal = 4000ms, so 250ms per column).

### Requirement 15: Polished Animations

**User Story:** As a player, I want smooth, visually appealing animations during gameplay, so that the experience feels like the real Lumines.

#### Acceptance Criteria

1. WHEN the active Piece moves laterally or downward, THE Renderer SHALL animate the Piece from its previous position to its new position using an eased transition lasting no more than 100 milliseconds.
2. WHEN a Piece is Locked, THE Renderer SHALL play a visual feedback effect (such as a brief flash or scale pulse) lasting between 80 and 200 milliseconds to indicate the Piece has settled into the Stack.
3. WHEN the Sweep_Bar passes a column containing Marked_Cells, THE Renderer SHALL animate the deletion of those Marked_Cells with a dissolve or particle effect that completes within 250 milliseconds (the time the Sweep_Bar occupies one column).
4. WHEN Cells settle due to gravity after deletion, THE Renderer SHALL animate each Cell falling to its new row with an eased transition lasting no more than 150 milliseconds per row traveled.
5. THE Renderer SHALL render the Sweep_Bar with a visible sweep effect (glow or highlight region) that extends at least 1 column width around the bar's current position as it moves across the Grid.
6. THE Renderer SHALL ensure all animations are purely visual and do not delay or block game state updates, player input processing, or subsequent game logic.

### Requirement 16: Polished UI/UX for Surrounding Screens

**User Story:** As a player, I want the start and game-over screens to look polished and considered, so that the overall experience feels complete.

#### Acceptance Criteria

1. THE Start_Screen SHALL present the game title, start button, controls cheatsheet, and how-to-play instructions centered horizontally within the viewport, arranged in a single-column vertical stack with no fewer than 16 pixels of spacing between each element.
2. THE Game_Over_Screen SHALL present the final score and restart button centered horizontally within the viewport, arranged in a single-column vertical stack with no fewer than 16 pixels of spacing between each element.
3. THE Start_Screen and Game_Over_Screen SHALL use a single font family and no more than 3 distinct font sizes across all text elements.
4. WHEN the Start_Screen appears or the Game_Over_Screen appears, THE Renderer SHALL apply a fade-in transition lasting between 200 and 500 milliseconds.
5. WHEN the Start_Screen disappears or the Game_Over_Screen disappears, THE Renderer SHALL apply a fade-out transition lasting between 200 and 500 milliseconds.
