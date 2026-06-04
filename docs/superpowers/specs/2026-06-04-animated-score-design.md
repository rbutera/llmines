# Dynamic animated score — design

Date: 2026-06-04
Status: self-approved (headless run)
Scope: one feature added to the existing, working LLMines build. No rebuild.

## Goal

The score should update with impactful, juicy feedback **within the game view**
— a count-up of the value, a pop/scale, a floating "+N", particle sparks, and a
flash on big clears — not just a number ticking in the side HUD. The animation
must never break the authoritative, assertable score value.

## Key principle: split the authoritative number from the juice

The single most important constraint is that `data-testid="score"` must always
read the **exact** current total (no intermediate count-up values), so value
assertions can't desync. So the design deliberately splits two concerns into two
DOM elements:

1. **Authoritative number** — the existing `data-testid="score"` in the HUD
   aside, bound directly to React `score` state. It jumps to the exact new total
   instantly on every change. Never tweened. Untouched logic.
2. **Cosmetic juice** — a new `ScoreFx` overlay, absolutely positioned over the
   game canvas (`pointer-events-none`, `aria-hidden`). On each score increase it
   fires a transient burst. Its count-up display carries a *separate*
   `data-testid="score-fx"` so e2e can assert an effect fired without touching
   the authoritative number.

This mirrors a pattern proven in a sibling build: keep the assertable number and
the animation as separate elements.

## Why a DOM overlay (not Pixi-drawn juice)

Three approaches were considered:

- **A — React DOM overlay over the canvas (chosen).** A `relative` wrapper holds
  the `GameCanvas` and an absolutely-positioned `ScoreFx`. CSS keyframes do the
  juice; the count-up tweens in JS via rAF. Clean separation from both the pure
  core and the deterministic Pixi renderer; testids stay simple and assertable;
  reduced-motion is a one-line media query. Lowest risk to existing polish.
- **B — Pixi-rendered score text + particles.** Literally inside the canvas, but
  couples juice to the deterministic render loop, and canvas text is opaque to
  Playwright (no testid), so the DOM number is still needed. More risk, more
  complexity, no testability gain.
- **C — animate the HUD number in place only.** Simplest, but the feature
  explicitly wants the action *in the game view*, "not just a number ticking in
  a HUD." Fails the intent.

Approach A delivers the impact where the feature asks for it, keeps the
authoritative value exact, and leaves the core + renderer + existing tests
untouched.

## Architecture

```
GameShell (owns `score` React state from controller.subscribe — unchanged)
   └─ PlayingScreen
        ├─ aside: <div data-testid="score">{score}</div>   ← authoritative, exact
        └─ <div class="relative">                          ← new wrapper
             ├─ <GameCanvas controller={…} />              ← the board (unchanged)
             └─ <ScoreFx score={score} />                  ← new cosmetic overlay
```

### Components / units

- **`src/game/react/score-fx.ts`** (pure, no DOM) — small, unit-testable helpers:
  - `scoreTier(gain: number): "small" | "big" | "huge"` — tiers at `gain >= 24`
    ("huge"), `gain >= 12` ("big"), else "small". Drives particle count, scale,
    and whether a flash plays.
  - `tierParticleCount(tier): number` — e.g. small 6, big 12, huge 20.
  - `easeOutCubic(t: number): number` and `tweenValue(from, to, t): number` —
    eased count-up interpolation (clamped `t` in [0,1]), used by the rAF tween.
  - `BURST_MS` constant (~1200 ms) — burst lifetime.
- **`src/game/react/ScoreFx.tsx`** — the overlay component. Props: `score: number`.
  - Tracks `prevScore` in a ref. On `score > prevScore` it: starts a count-up
    tween (`prevScore → score`) shown big and centred over the board with
    `data-testid="score-fx"`; pushes a burst `{ id, gain, tier }` to local state.
  - Each burst renders a floating `+N` chip, a ring of `tierParticleCount`
    spark elements (themed cyan/magenta), and — for `big`/`huge` — a full-board
    flash. Each burst self-removes after `BURST_MS` (timeout, cleared on unmount).
  - The count-up element is visible only transiently (during/just after a
    change) and fades out when idle; it always lands on the exact new total.
  - `pointer-events-none`, `aria-hidden="true"` on the root (decorative; the
    accessible value is the authoritative HUD number).
  - Respects `prefers-reduced-motion`: a `matchMedia` check zeroes particle
    spawning and the CSS keyframes collapse to near-instant; the count-up still
    snaps to the final value.
- **`src/styles/globals.css`** — keyframes: `score-burst` (pop/scale on the
  count-up), `score-gain-rise` (+N chip floats up & fades), `score-spark`
  (particle flies outward & fades, per-particle CSS vars for angle/distance),
  `score-flash` (board flash). All wrapped by a reduced-motion media query.
- **`src/game/react/GameShell.tsx`** — `PlayingScreen` wraps `GameCanvas` in a
  `relative` container and renders `ScoreFx` over it, passing `score`. The aside
  `data-testid="score"` is unchanged.

## Data flow

```
core scoring (sweep clear) → controller.emit → GameShell `score` state updates
   ├─ aside <div data-testid="score">{score}</div>   (exact, instant)
   └─ <ScoreFx score> detects increase (score > prevScore ref)
        → gain = score - prev → tier = scoreTier(gain)
        → rAF tween prev→score on data-testid="score-fx" (count-up + pop)
        → burst: +N chip + tierParticleCount(tier) sparks + (big/huge) flash
        → burst auto-clears after BURST_MS
```

The overlay is a pure consumer of the `score` prop. It never feeds anything back
into the controller, core, or the authoritative element.

## Error handling / edge cases

- Only an **increase** fires a burst (`score > prevScore`). Restart (score → 0)
  and the initial 0 fire nothing.
- Rapid successive increases: each pushes its own burst (keyed by `id`); the
  count-up retargets to the latest total and re-tweens. rAF + timeouts are
  tracked in refs and cancelled on unmount to avoid leaks / setState-after-unmount.
- The tween only ever drives the `score-fx` element; the authoritative `score`
  element is plain `{score}` and is never tweened — assertions stay exact.
- Reduced motion: no particles; near-instant count-up; final value correct.

## Testing

- **Unit (`src/game/react/score-fx.test.ts`, vitest node env):** `scoreTier`
  boundaries (11→small, 12→big, 23→big, 24→huge), `tierParticleCount` per tier,
  `easeOutCubic` endpoints (0→0, 1→1) and monotonicity, `tweenValue` endpoints
  and midpoint, `BURST_MS` positive. Pure logic, fully deterministic.
- **e2e (`e2e/lumines.spec.ts`):** after building and sweeping a mono square:
  - `data-testid="score"` reads exactly `"4"` (authoritative value intact — the
    existing assertion, must stay green);
  - `data-testid="score-fx"` becomes visible (an effect fired in the game view);
  - after the burst it is gone again, and `score` still reads `"4"`.
- All existing unit + e2e suites stay green; the core, controller, renderer, and
  the authoritative `score` element are untouched.

## Acceptance mapping

- "score testid still reflects the current numeric score (assertable)" → the
  HUD `data-testid="score"` is plain `{score}` React state, exact and instant.
- "on a scoring event a visible animation fires in the game view" → `ScoreFx`
  overlays the canvas and fires count-up + pop + `+N` + particles + flash.
- "animation must not break value assertions" → juice lives on a separate
  `data-testid="score-fx"` element; the authoritative number is never tweened.
- Polish (impactful, satisfying) → gain-tiered bursts (small / big / huge) with
  escalating particles, scale, and a flash on big clears.
- No regression → core/controller/renderer and the existing score assertions are
  untouched; the overlay is an additive, decorative consumer of `score`.
