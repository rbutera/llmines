# Feature Specification: LLMines — Browser Lumines Clone (MVP)

**Feature Branch**: `cell/speckit-claude-greenfield`

**Created**: 2026-06-04

**Status**: Draft

**Input**: User description: "Build LLMines, a playable browser-based clone of the puzzle game Lumines: 2x2 colour blocks fall onto a grid, same-colour 2x2 squares form, and a music-synced timeline bar sweeps across the field clearing them."

## Overview

LLMines is a single-player, browser-based puzzle game in the spirit of *Lumines*. Players guide falling two-by-two colour blocks onto a playfield. When four cells of the same colour align into a square, that square is "marked." A timeline bar sweeps continuously left-to-right in time with a backing music track, clearing every marked cell it passes and awarding points. The goal of this MVP is a genuinely polished, playable, self-contained game with a start screen, in-game view, and game-over screen — no accounts, no persistence, no networking beyond serving the page.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Play a falling-block round (Priority: P1)

A player opens the game, starts a round, and steers falling 2×2 colour blocks with the keyboard. Blocks fall on a steady gravity tick, settle onto the floor or stack, and the player keeps placing pieces to build same-colour squares.

**Why this priority**: This is the irreducible core of the game. Without spawning, falling, controllable, locking pieces there is no game at all — every other feature builds on this loop.

**Independent Test**: Start a round and confirm a 2×2 piece spawns at top-centre, falls on a tick, responds to move/rotate/soft-drop/hard-drop, and locks onto the floor or stack. Delivers value as a minimal interactive falling-block toy even before clearing exists.

**Acceptance Scenarios**:

1. **Given** the start screen is showing, **When** the player activates the start control, **Then** the in-game view appears and a 2×2 piece spawns at the top-centre spawn position (columns 7–8, rows 0–1).
2. **Given** a piece is falling, **When** the player presses move-left / move-right, **Then** the piece shifts one column in that direction unless blocked by a wall or settled cell.
3. **Given** a piece is falling, **When** the player presses rotate, **Then** the 2×2 piece rotates 90° and its four cells reorient accordingly.
4. **Given** a piece is falling, **When** the player presses soft-drop, **Then** the piece descends faster; **When** the player presses hard-drop, **Then** the piece drops instantly and locks.
5. **Given** a piece can fall no further (floor or settled cell beneath), **When** the gravity tick fires or a hard-drop occurs, **Then** the piece locks into the stack and a new piece spawns.

---

### User Story 2 - Form squares and clear them with the timeline sweep (Priority: P1)

As the player builds the stack, any aligned block of a single colour that is 2×2 or larger is marked for deletion. A vertical timeline bar sweeps continuously across the field in time with the music; as it passes each column it deletes that column's marked cells, scores the clear, and cells above collapse down to fill the gaps.

**Why this priority**: This is what makes the game *Lumines* rather than a generic stacker. The mark → sweep → clear → collapse loop and its scoring are the defining mechanic and the bulk of the shared acceptance suite.

**Independent Test**: Construct a same-colour 2×2 square in the stack, run a sweep across it, and confirm the four cells are deleted, the score increases by the pinned rule, and cells above settle by gravity.

**Acceptance Scenarios**:

1. **Given** four settled cells of the same colour form an aligned 2×2 area, **When** square detection runs, **Then** those cells are marked for deletion.
2. **Given** a larger monochrome region (e.g. 2×3 or 3×3), **When** square detection runs, **Then** every aligned 2×2 whose top-left corner sits inside the region is counted as one distinct square (2×3 → 2 squares, 3×3 → 4 squares), and all cells of the region are marked.
3. **Given** marked cells exist, **When** the timeline bar passes their columns, **Then** those marked cells are deleted and the score increases by `(cells deleted in that sweep) × (distinct completed 2×2 squares cleared in that sweep)`.
4. **Given** cells were deleted below other settled cells, **When** the sweep finishes passing those columns, **Then** the cells above fall down to fill the emptied gaps.
5. **Given** the timeline bar reaches the right edge, **When** it completes a traversal, **Then** it repeats from the left edge continuously.

---

### User Story 3 - Game flow: start, score display, game over, restart (Priority: P2)

The player moves through three screens: a start screen with a start control and how-to-play text; the in-game view showing the grid, a live score, and a controls legend; and a game-over screen showing the final score with a restart control. Game-over triggers when a newly spawned piece cannot enter because the stack has reached the top.

**Why this priority**: Necessary for a complete, shippable loop and required by acceptance, but it wraps the core mechanics rather than being the mechanic itself — the game is demonstrable without polished screen transitions.

**Independent Test**: Fill the stack to the spawn zone, confirm game-over appears with the final score, activate restart, and confirm a fresh round begins from an empty grid.

**Acceptance Scenarios**:

1. **Given** the page has loaded, **When** it first renders, **Then** the start screen is shown with a start control and how-to-play / controls text.
2. **Given** a round is in progress, **When** cells are cleared and scored, **Then** the on-screen score updates live to reflect the current total.
3. **Given** the stack has reached the spawn zone, **When** a new piece would spawn and cannot enter, **Then** the game-over screen appears showing the final score.
4. **Given** the game-over screen is shown, **When** the player activates restart, **Then** a fresh round begins with an empty grid and a score of zero.

---

### User Story 4 - Audio synced to the sweep (Priority: P2)

A backing music track begins when the round starts, loops continuously, and the timeline sweep stays locked to its tempo so that a full traversal of the 16-column field takes 8 beats (4.0 s at 120 BPM).

**Why this priority**: Audio-tempo sync is the atmospheric heart of Lumines and a stated requirement, but the mechanics and scoring remain testable and playable even when audio cannot play (e.g. headless/autoplay-restricted environments), so it ranks below the core loops.

**Independent Test**: Start a round and confirm an audio source exists, has looping enabled, and points to the backing track; verify that the sweep's full-field traversal time equals 8 beats of the 120 BPM track.

**Acceptance Scenarios**:

1. **Given** a round starts, **When** the game initialises audio, **Then** an audio source exists with looping enabled, pointing at the backing track.
2. **Given** the music is playing, **When** a full sweep traversal occurs, **Then** it takes 8 beats (4.0 s at 120 BPM = 0.25 s per column) and remains aligned to the track's tempo across loops.
3. **Given** an environment that blocks audio autoplay, **When** the round runs, **Then** gameplay still proceeds correctly (audio playback is not a precondition for play).

---

### User Story 5 - Deterministic test interface for automation (Priority: P2)

When the game is built in test mode, it exposes a deterministic JavaScript interface and stable DOM hooks so an external end-to-end harness can seed the RNG, place pieces, advance gravity and the sweep step-by-step, and read game state — all without depending on wall-clock timing, audio decode, or screen scraping. In a normal (non-test) build, none of these hooks are present and production behaviour is unchanged.

**Why this priority**: Required for the shared test harness to drive and verify the game. It is essential infrastructure, but it sits alongside rather than within the player-facing experience.

**Independent Test**: Build with the test flag enabled, confirm the JS test interface and `data-testid` hooks are present and drive the game deterministically; build without the flag and confirm none of the interface is present and auto-gravity / music-synced sweep behave as in normal play.

**Acceptance Scenarios**:

1. **Given** test mode is enabled, **When** the page loads, **Then** the JS test interface is available and the documented `data-testid` hooks are present in the DOM.
2. **Given** test mode is enabled, **When** the harness seeds the RNG, **Then** the subsequent piece sequence is deterministic and reproducible.
3. **Given** test mode is enabled, **When** the harness advances one gravity step, **Then** the game advances exactly one step and never auto-spawns a new piece; the board stays quiescent until the harness explicitly spawns one.
4. **Given** test mode is enabled, **When** the harness places a piece while one is mid-fall, **Then** the falling piece locks first and the new piece is placed at the top-centre spawn position; consecutive placements stack deterministically.
5. **Given** test mode is enabled, **When** the harness advances the sweep by a duration, **Then** the sweep position advances deterministically by that duration (0.25 s per column) independent of real time or audio.
6. **Given** test mode is disabled (default), **When** the page loads, **Then** no test interface is exposed and auto-gravity plus the music-synced sweep loop behave normally.

---

### Edge Cases

- **Piece blocked at spawn**: If the spawn position is already occupied by settled cells, the round ends (game over) rather than overlapping pieces.
- **Move/rotate against a wall or stack**: Lateral moves and rotations that would push the piece out of bounds or into a settled cell are rejected; the piece stays in its last legal position.
- **Rotation near edges**: Rotation that cannot be accommodated within the grid bounds is rejected (no wall-kick is required for the MVP).
- **Square spanning a column the sweep already passed**: Only marked cells in columns the bar has not yet cleared this pass are deleted by the current pass; a square fully behind the bar waits for the next traversal.
- **Cascade after collapse**: After cells collapse by gravity, newly aligned monochrome 2×2 areas become marked and are eligible for clearing on a subsequent sweep pass (no guaranteed same-pass chain is required).
- **Hard-drop into immediate game-over**: A hard-drop that fills the spawn zone leads to game-over on the next spawn attempt.
- **Mixed-colour 2×2**: A 2×2 area containing more than one colour is never marked.

## Requirements *(mandatory)*

### Functional Requirements

**Playfield & pieces**

- **FR-001**: The system MUST render a playfield grid of exactly 16 columns × 10 rows, empty at the start of a round, with row 0 at the top.
- **FR-002**: The system MUST spawn a falling piece consisting of a 2×2 block of four cells, where each of the four cells is independently assigned one of two colours (A and B), randomised per piece.
- **FR-003**: The system MUST spawn each new piece at the pinned top-centre position: columns 7–8 (0-indexed), rows 0–1.
- **FR-004**: The system MUST advance the falling piece downward on a fixed gravity tick during normal play.

**Controls**

- **FR-005**: The player MUST be able to move the falling piece left and right (one column per input), rotate it 90°, soft-drop (fall faster), and hard-drop (instant lock), using the vim-style keys `h` (left), `l` (right), `j` (soft-drop), `k` (rotate), and `space` (hard-drop). Arrow keys MAY mirror these as optional aliases.
- **FR-006**: The system MUST reject moves and rotations that would place any of the piece's cells out of bounds or onto a settled cell, leaving the piece in its previous legal position.
- **FR-007**: The system MUST lock the falling piece into the settled stack when it can fall no further (resting on the floor or on settled cells), and then spawn the next piece (in normal play).

**Square formation & clearing**

- **FR-008**: The system MUST detect, in the settled stack, every aligned area of a single colour that is 2×2 or larger and mark all cells of such areas for deletion.
- **FR-009**: The system MUST count distinct completed 2×2 squares by their top-left corner: every aligned 2×2 whose top-left corner is monochrome counts as one distinct square (so a 2×3 region = 2 squares and a 3×3 region = 4 squares).
- **FR-010**: The system MUST render a vertical timeline bar that sweeps left-to-right across the full field and, upon reaching the right edge, repeats continuously from the left.
- **FR-011**: As the timeline bar passes a column, the system MUST delete that column's marked cells and apply scoring for that sweep.
- **FR-012**: After the sweep passes and cells are deleted, the system MUST apply gravity so that settled cells above an emptied gap fall down to fill it.

**Scoring & display**

- **FR-013**: The system MUST increase the score, for each sweep that deletes cells, by `(number of cells deleted in that sweep) × (number of distinct completed 2×2 squares cleared in that sweep)`.
- **FR-014**: The system MUST display the current score on screen and update it live as clears occur.

**Game flow**

- **FR-015**: The system MUST present a start screen with a start control before play begins.
- **FR-016**: The system MUST present an in-game view containing the playfield grid, the live score, and a persistent controls legend.
- **FR-017**: The system MUST end the round (game over) when a newly spawned piece cannot enter because the stack has reached the spawn zone, and MUST show a game-over screen displaying the final score.
- **FR-018**: The system MUST offer a restart control on the game-over screen that begins a fresh round with an empty grid and a zeroed score.

**Audio & tempo**

- **FR-019**: The system MUST provide a backing-audio source that has looping enabled and points to the provided backing track (`/backing-track.mp3`), started on game start. (Live autoplay is NOT required to pass; the game MUST NOT circumvent browser autoplay policies.)
- **FR-020**: The system MUST keep the timeline sweep locked to the track tempo such that a full 16-column traversal takes 8 beats (4.0 s at 120 BPM = 0.25 s per column) and repeats continuously.

**On-screen guidance & accessibility**

- **FR-021**: The system MUST show the control scheme (`h`/`l` move, `j` soft-drop, `k` rotate, `space` hard-drop) and a brief how-to-play, visible on the start screen AND as a persistent in-game legend/panel.
- **FR-022**: The system MUST be operable via keyboard and expose a single main landmark region for the primary content.

**Polish (judged subjectively, not by the automated suite, but required)**

- **FR-023**: In-game animation MUST be highly polished and evoke real Lumines: how pieces fall and settle, how the timeline bar sweeps, and how marked squares and cleared cells animate through forming, highlighting, clearing, and collapsing — not a static grid that merely swaps cells.
- **FR-024**: The surrounding out-of-game UI (start, in-game HUD / score / legend, game-over) MUST be a cohesive, considered, pleasant-to-use interface, not wired-up defaults.

**Testability contract (required; present only in test-mode builds)**

- **FR-025**: When test mode is enabled, the system MUST expose a deterministic JavaScript test interface that allows an external harness to: seed the RNG for a deterministic piece sequence; read current state (grid reflecting settled stack + active falling piece, score, game-over flag, and sweep column position); read the currently marked cells; place a specified piece immediately at the top-centre spawn position (locking any mid-fall piece first); advance one gravity step; run one full sweep immediately with scoring; and advance the sweep deterministically by a given duration.
- **FR-026**: When test mode is enabled, advancing a single gravity step MUST never auto-spawn a new piece — after a piece locks the board stays quiescent until the harness explicitly places one; consecutive placements stack deterministically.
- **FR-027**: When test mode is enabled, the system MUST expose stable DOM hooks: a start control, a restart control, a live score element (text equals the number), a game-over marker present only on the game-over screen, and a controls-cheatsheet element.
- **FR-028**: When test mode is DISABLED (the default), the system MUST NOT expose any test interface, and production behaviour (auto-gravity plus the music-synced sweep loop) MUST be unchanged.

### Key Entities *(include if feature involves data)*

- **Cell**: A single grid location holding either colour A, colour B, or empty.
- **Grid / Playfield**: The 16-column × 10-row arrangement of cells representing the settled stack plus the active falling piece, with row 0 at the top.
- **Piece**: A 2×2 group of four cells, each independently colour A or B, that falls under gravity and is controllable until it locks.
- **Marked region**: The set of cells belonging to any aligned monochrome 2×2-or-larger area, flagged for deletion.
- **Timeline bar / Sweep**: The vertical bar whose horizontal position advances across the field at a tempo-locked rate, deleting marked cells column by column.
- **Score**: The running total accumulated per the pinned scoring rule.
- **Game session**: A single round with its own grid state, score, and lifecycle (start → playing → game over → restart).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A new player reaches an interactive, controllable falling piece within one action (activating the start control) from the start screen.
- **SC-002**: 100% of the shared acceptance suite passes: start-on-input, spawn/fall/move/rotate/soft-drop/hard-drop/lock, square clear-on-sweep with correct scoring, gravity settling after deletion, sweep traversal timing, game-over + restart, audio source looping correctly, and visible controls cheatsheet on start and in-game.
- **SC-002a**: A constructed same-colour 2×2 square is deleted when the sweep passes it, and the score increases by exactly `(deleted cells) × (distinct 2×2 squares)` for that pass.
- **SC-003**: A full 16-column sweep traversal measures 4.0 s at 120 BPM (0.25 s/column) within the harness's deterministic timing assertion.
- **SC-004**: Game-over is triggered exactly when a spawned piece cannot enter the occupied spawn zone, and restart returns the player to an empty grid with score zero.
- **SC-005**: With the test flag set, the deterministic interface and all documented DOM hooks are present and drive the game without dependence on wall-clock time, audio decode, or visual scraping; with the flag unset, none are present and normal auto-play behaviour is unchanged.
- **SC-006**: The game is fully playable using only the keyboard, and the primary content is reachable as a single main landmark.
- **SC-007**: On subjective play-testing, the in-game animations and surrounding UI are judged polished and cohesive — recognisably Lumines-like in feel, not merely functional.

## Assumptions

- **Scaffold & rendering**: The product is built on the pinned stack (create-t3-app — Next.js App Router + TypeScript + tRPC + Tailwind; PixiJS for canvas rendering inside a React component; pnpm; vitest for logic and Playwright for e2e). These are fixed inputs, not open design choices.
- **Backing track**: The provided `fixtures/backing-track.mp3` is served at `/backing-track.mp3` at 120 BPM (one beat = 0.5 s) per `fixtures/manifest.json`.
- **Single player, no persistence**: No accounts, high scores, leaderboards, multiplayer, mobile/touch controls, skins/themes, or settings menus are in scope for this greenfield MVP (these belong to a later brownfield phase).
- **Colour palette**: Exactly two cell colours (A = 0, B = 1); empty cells are null.
- **Cascades**: After a collapse, newly formed monochrome 2×2 areas become marked and may be cleared on a later sweep pass; a guaranteed same-pass chain reaction is not required.
- **Rotation model**: A simple 90° rotation of the 2×2 piece with no wall-kick is sufficient for the MVP; rotations that don't fit are rejected.
- **Target platform**: A modern desktop browser; mobile and touch input are out of scope.
- **Test-mode contract**: The exact JS API (`window.__lumines`) and `data-testid` hooks specified in the input are an intentional, pinned external contract for the shared harness — these technical hooks are deliberately part of the requirements (not incidental implementation detail) and must be honoured precisely in test-mode builds only.
