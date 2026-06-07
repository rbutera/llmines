# Design — F4: Dynamic animated score

## Overview

Two cooperating layers deliver juicy, in-view score feedback while keeping the
score value authoritative and assertable:

1. A React `ScoreOverlay` rendered over the Pixi canvas: animated count-up that
   settles exactly on the value, a pop/scale + glow on increase, and floating
   "+N" popups. It carries the single `data-testid="score"`.
2. Renderer (canvas) celebration: when `RenderState.score` increases, the Pixi
   renderer emits a gold flash + radiating particles scaled by the delta — the
   game view itself reacts, with bigger clears feeling bigger.

The score value is owned by the core/controller exactly as today; F4 only adds
presentation. The `score` testid moves from the sidebar into the in-view overlay
(so there is still exactly one such element).

## React: `ScoreOverlay`

New component `src/game/react/ScoreOverlay.tsx`.

- Props: `score: number` (authoritative current score from the controller).
- Count-up: a `requestAnimationFrame` loop eases a `displayed` value toward
  `score`. It always finishes ON the integer target within a short window
  (~450ms). If `score < displayed` (restart/reset) it snaps immediately. The
  rendered text is `Math.round(displayed)`, and when finished it is set to
  exactly `score` → `data-testid="score"` settles on the authoritative number
  (Req 1.1, 1.2).
- Pop: increasing the score bumps a `popKey`; a keyed wrapper re-mounts to replay
  a CSS `score-pop` keyframe (scale + glow). (Req 2.1)
- Floating "+N": on increase, push `{ id, amount }` into a list; each renders a
  `score-float` element that drifts up and fades, removed after the animation.
  (Req 2.2)
- Placement: absolutely positioned over the canvas (top-centre). (Req 2.4)

`data-testid="score"` lives only here; the sidebar HUD score block is removed
(Req 1.3). `PlayingScreen` wraps the canvas + overlay in a `relative` container.

## CSS (`globals.css`)

Add keyframes: `score-pop` (scale 1 → 1.35 → 1 with glow) and `score-float`
(translateY up + fade), and small helper classes. Respect
`prefers-reduced-motion` by reducing transforms.

## Renderer (`renderer.ts`) — canvas celebration

- Track `prevScore` (init 0). In `onState`, `delta = rs.score - prevScore`.
  - `delta > 0`: seed `scoreFlash = min(1, delta / 12)` and spawn
    `clamp(delta, 6, 60)` gold particles from random board positions with
    outward velocity; brighter/more for larger deltas (Req 2.3).
  - `delta < 0` (restart): clear particles, reset flash. Always update
    `prevScore`.
- New `scoreG` Graphics layer added on top. Each `frame`: decay `scoreFlash`,
  integrate + age particles, draw a full-board gold tint (alpha from flash) and
  the particles.
- No change to existing clear flashes / sweep / collapse polish (Req 3.2).

## Data flow

`GameShell` already subscribes and holds `score` state; it passes `score` to
`PlayingScreen` → `ScoreOverlay`. The renderer reads `score` from `RenderState`
(already present). No controller/core changes.

## Why assertions stay green

- The settled `score` text equals the integer score; Playwright `toHaveText`
  retries while the brief count-up converges, then matches exactly.
- Reset snaps to 0 immediately, so the restart test sees `"0"`.
- Exactly one `data-testid="score"` element exists while playing.

## Verification

- `pnpm test` (unit) green; `pnpm build` (TEST_MODE) succeeds.
- E2E: score assertions (`"0"`, `"4"`, `"12"`) still pass; manual play shows
  count-up, pop, "+N", and canvas burst.
