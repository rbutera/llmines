# Phase 0 Research: Dynamic Animated Score

No `NEEDS CLARIFICATION` markers remained. Research grounds the approach in the existing
code and pins the open design choices.

## Decision 1 — Presentation-only; authoritative value vs. cosmetic juice are split

**Decision**: Leave the `data-testid="score"` element exactly as it is (an instant integer
fed by `setScore(rs.score)` in `GameShell`). Add a separate cosmetic `ScoreFx` overlay that
animates a *different* in-view number and effects. The overlay never writes the testid.

**Rationale**: The score already flows to React: `GameShell` subscribes to the controller
and `PlayingScreen` renders `{score}` in the testid (`GameShell.tsx`). Animating the testid
itself (count-up) would make `state`/testid assertions observe intermediate values and break
them (the existing e2e asserts the `score` testid equals exactly `"4"` after a clear). The
clean split — authoritative integer instant, juice cosmetic — directly satisfies "the
animation must not break value assertions."

**Alternatives considered**:
- *Animate the testid's number (count-up on the source of truth)* — rejected: breaks value
  assertions and the Testability requirement.
- *Render effects only in the Pixi canvas* — viable (the renderer already has a `flashes`
  layer for clears) but couples score juice to the engine/renderer and is harder to assert;
  a React overlay is more isolated, testable, and lower-risk.

## Decision 2 — Detect scoring events from the score delta in React (no engine change)

**Decision**: `ScoreFx` receives the `score` prop and compares it to the previous value
(via a ref). A positive delta is a scoring event; the delta magnitude drives effect
intensity. Zero/negative deltas (including the `→ 0` restart) fire no celebratory effect.

**Rationale**: `rs.score` is already emitted to `GameShell`; deltas are fully derivable in
the presentation layer. No controller/core change is needed, keeping the engine untouched
(no regression risk). In production `emit` runs ~60 fps but `score` only changes on clears,
so a positive delta occurs exactly on scoring events.

**Alternatives considered**: Adding a score-event callback/field to the controller —
rejected as unnecessary surface area; the delta is already observable.

## Decision 3 — Effect tiers scale with the delta

**Decision**: A pure helper `fxTier(delta)` maps the points gained to a tier:
`none` (delta ≤ 0), `modest` (small clears), `big` (large/multi-square clears, above a
threshold). The tier selects animation intensity (pop scale, flash strength, particle
count/duration). Thresholds live as named constants in the helper.

**Rationale**: Makes US2 ("bigger clears feel bigger") objectively testable via a pure unit
test and an e2e-exposed tier attribute, without pixel inspection. Scoring in this game is
per-pass and can be multiplied by multiple squares, so deltas vary meaningfully (a single
2×2 square scores 4; multi-square passes score much more — see `sweep`/scoring), giving a
natural small-vs-big distinction.

**Alternatives considered**: Continuous (non-tiered) scaling — fine visually but harder to
assert discretely; tiers give a crisp testable contract while still allowing
within-tier continuous flourishes.

## Decision 4 — Implementation medium: CSS/DOM overlay

**Decision**: Build `ScoreFx` as an absolutely-positioned overlay in the game-view column,
`pointer-events-none`, using CSS transforms/opacity for the count-up/pop/flash and a small
bounded set of particle nodes for the `big` tier. Reduced motion via
`prefers-reduced-motion`.

**Rationale**: Isolated from the canvas/engine, cheap, transient, easy to gate behind
reduced-motion, and easy to expose test hooks on. Keeps input unblocked (`pointer-events-
none`) and never permanently obscures the board (effects auto-expire).

**Alternatives considered**: A particle library — rejected (YAGNI, new dep); the renderer's
Pixi `fxG` layer — rejected (couples to engine, harder to assert).

## Decision 5 — Test hooks & strategy

**Decision**:
- Keep `data-testid="score"` as the authoritative integer (assertion contract; unchanged).
- Expose the overlay as `data-testid="score-fx"`, present/visible while an effect plays,
  carrying a `data-fx-tier` attribute (`modest` / `big`) for the last event.
- **Vitest**: unit-test `fxTier`/timing in `score-effects.test.ts` (pure, node env).
- **Playwright**: after a scoring clear, assert (a) `score` testid still equals the exact
  number, (b) `score-fx` appears in the game view, (c) a big clear yields `data-fx-tier="big"`
  vs a small clear's `"modest"`, (d) the effect is transient (clears), (e) restart resets
  with no stale effect.

**Rationale**: Gives objective, automatable coverage for the verifiable backbone (value
correctness, effect-fires, intensity scaling, transient, reset) while the subjective
"impactful" quality is validated by play (the manual quickstart pass). No React Testing
Library is installed and Vitest runs in `node`, so component-DOM logic is validated through
Playwright rather than RTL.

## No-regression analysis

The change adds an overlay sibling to `GameCanvas` inside `PlayingScreen` and one pure
helper. The `score` testid, controller, core, renderer, and test API are untouched, so the
existing Vitest + Playwright suites (including 001/002) remain valid. The overlay is
`pointer-events-none` and time-boxed, so it cannot block input or persistently cover the
board.
