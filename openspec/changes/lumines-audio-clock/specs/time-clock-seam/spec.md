## ADDED Requirements

### Requirement: Injected Clock abstraction

The system SHALL define a `Clock` abstraction exposing `now(): number` that returns the current time in **seconds**. The `GameController` SHALL read the current time only through an injected `Clock` and SHALL be the only layer that touches time. The pure game core (`src/game/core/**`) SHALL NOT import or read any clock, remaining a pure function of `(state, inputs, columnDelta)`.

#### Scenario: Controller reads time only through the injected clock

- **WHEN** the controller needs the current time to advance the sweep
- **THEN** it obtains the value by calling `clock.now()` on its injected `Clock`
- **AND** no module under `src/game/core/**` imports a clock, `Date`, `performance`, or `AudioContext`

#### Scenario: Time is reported in seconds

- **WHEN** any `Clock` implementation's `now()` is called
- **THEN** the returned value is a time in seconds (the same unit as `AudioContext.currentTime`)

### Requirement: Production AudioClock backed by a singleton AudioContext

The system SHALL provide an `AudioClock` production implementation whose `now()` returns `AudioContext.currentTime` from a single shared `AudioContext`. Exactly one `AudioContext` SHALL be created for the lifetime of the game so that the sweep and any future audio scheduling read the same `currentTime` and cannot drift. The context SHALL be resumed on the first user gesture, and before it is resumed the clock SHALL report no musical time having elapsed (a frozen/zero reading) so the board waits rather than jumping.

#### Scenario: A single AudioContext is the clock source

- **WHEN** the production `AudioClock` is created and queried over the course of a game
- **THEN** all readings come from one shared `AudioContext.currentTime`
- **AND** no second `AudioContext` is created for timing

#### Scenario: Pre-gesture state does not jump the board

- **WHEN** the game is loaded but the user has not yet made a gesture and the `AudioContext` is still suspended
- **THEN** the clock reports that no musical time has elapsed
- **AND** the sweep does not advance until the context is resumed by the first user gesture

### Requirement: Deterministic FakeClock for tests

The system SHALL provide a `FakeClock` test implementation whose `now()` returns an internally held time that the test advances or sets manually. Driving timing through the `FakeClock` SHALL be deterministic and reproducible, so that advancing the clock by a total amount in one step yields the same clock reading as advancing it by the same total in several smaller steps.

#### Scenario: Manual advance is reflected by now()

- **WHEN** a test sets the `FakeClock` to `t0` seconds and then advances it by `dt` seconds
- **THEN** `now()` returns `t0 + dt`

#### Scenario: Step-size independence of the clock reading

- **WHEN** a test advances the `FakeClock` by a total of `T` seconds in one call versus the same `T` split across several calls
- **THEN** the final `now()` reading is identical in both cases

### Requirement: Clock injection via controller options without changing existing behaviour

The `GameController` SHALL accept an optional `Clock` via its options, defaulting to a `FakeClock` in test mode and an `AudioClock` in production. Introducing the injected clock SHALL NOT change any observable game behaviour, scoring, sweep semantics, RNG draw order, or the `window.__lumines.state()` shape; it is plumbing only.

#### Scenario: Defaults are mode-appropriate

- **WHEN** a controller is constructed in test mode without an explicit clock
- **THEN** it uses a `FakeClock`
- **WHEN** a controller is constructed in production mode without an explicit clock
- **THEN** it uses an `AudioClock`

#### Scenario: Behaviour and test seam are unchanged

- **WHEN** the same seeded inputs are applied to the game before and after the clock seam is introduced
- **THEN** the resulting `window.__lumines.state()` (grid, score, gameOver, sweepX) is identical
- **AND** the `window.__lumines` interface keeps the same methods (`seed`, `state`, `marked`, `spawn`, `tick`, `sweepNow`, `sweepProgress`)

### Requirement: Determinism and test seam preserved

The deterministic test seam SHALL remain intact: the production loop SHALL NOT run in test mode, and the core SHALL stay a pure function fed a column delta derived (by the controller) from the clock. Any clock-advancing test helper SHALL be additive to the existing `window.__lumines` driver methods, never a replacement that breaks them.

#### Scenario: Test mode never runs the production loop

- **WHEN** the controller is in test mode
- **THEN** no requestAnimationFrame loop runs and timing advances only through the test driver

#### Scenario: Existing drivers continue to work

- **WHEN** a test uses `window.__lumines.sweepProgress(dtMs)` after the clock seam is added
- **THEN** it advances the sweep deterministically exactly as before
- **AND** any new clock-advance helper is available in addition to, not instead of, the existing methods
