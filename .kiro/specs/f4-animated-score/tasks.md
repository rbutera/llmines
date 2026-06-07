# Implementation Plan: F4 — Dynamic animated score

## Overview

The presentation work for F4 is already in the tree: `globals.css` has the
`score-pop`/`score-float` keyframes, `src/game/react/ScoreOverlay.tsx` exists
and owns the single `data-testid="score"`, `GameShell.tsx`'s `PlayingScreen`
wraps the canvas + overlay in a `relative` container with the duplicate sidebar
testid removed, and `renderer.ts` already implements the `scoreG` layer,
`prevScore` tracking, `seedScoreCelebration`, per-frame decay/aging, and
`drawScoreFx`. These tasks therefore **verify and align** the existing
presentation code against the design, then add the missing automated coverage
(property + structural tests) and finish with verification and a commit.

Implementation language is TypeScript (per the design). No core, controller, or
engine changes are made — the feature is presentation-only.

## Tasks

- [ ] 1. Verify presentation animation assets
  - [ ] 1.1 Verify `globals.css` score keyframes
    - Confirm `@keyframes score-pop` (scale + glow) and `@keyframes score-float`
      (rise + fade) exist with `.animate-score-pop` / `.animate-score-float`
      helper classes.
    - Confirm a `@media (prefers-reduced-motion: reduce)` block collapses both
      animation durations; add/adjust if missing.
    - _Requirements: 2.1, 2.2_

  - [ ] 1.2 Verify `ScoreOverlay.tsx` behaviour (file already exists)
    - Confirm the RAF count-up eases `displayed` toward `score`, settles exactly
      on the integer (~450ms ease-out), and snaps immediately when
      `score <= displayed`.
    - Confirm increase replays the pop via keyed remount, pushes a floating
      "+N" popup auto-removed after ~900ms, and renders the single
      `<span data-testid="score">`.
    - Confirm the root is `pointer-events-none`, absolutely positioned
      top-centre over the canvas.
    - _Requirements: 1.1, 1.2, 1.3, 2.1, 2.2, 2.4, 3.3_

- [ ] 2. Verify in-view wiring and renderer celebration
  - [ ] 2.1 Verify `GameShell.tsx` `PlayingScreen` wiring (already done)
    - Confirm `GameCanvas` + `ScoreOverlay` are wrapped in a `relative`
      container and the duplicate sidebar `score` testid block is removed, so
      exactly one `data-testid="score"` exists while playing.
    - _Requirements: 1.3, 2.4_

  - [ ] 2.2 Verify `renderer.ts` score celebration (already done)
    - Confirm the `scoreG` layer sits above `fxG`/`sweepG`, `prevScore` is
      tracked, and `seedScoreCelebration` computes `delta`, sets
      `scoreFlash = min(1, delta/12)`, and spawns
      `clamp(round(delta*3), 6, 60)` gold/cyan particles with outward velocity.
    - Confirm `frame()` decays the flash and integrates/ages particles, that
      `drawScoreFx()` is called, and that `delta < 0` clears particles and
      resets `scoreFlash`. Existing clear flashes, sweep, and collapse are
      unchanged.
    - _Requirements: 2.3, 3.2_

- [ ] 3. Checkpoint - Ensure existing tests still pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 4. Add automated coverage for the animated score
  - [ ] 4.1 Expose pure, testable helpers for the count-up and celebration
    - Extract a pure count-up easing helper (e.g. `countUpValue(from, to, t)`)
      used by `ScoreOverlay.tsx`, returning exactly `to` at `t >= 1` and `to`
      when `to <= from`.
    - Export a pure `computeScoreCelebration(delta)` from `renderer.ts`
      returning `{ flash, count }`, and have `seedScoreCelebration` use it.
    - _Requirements: 1.2, 2.3_

  - [ ]* 4.2 Write property test for count-up settle/snap
    - **Property 1: Count-up converges to and settles exactly on the authoritative integer**
    - Generate arbitrary non-negative `(from, to)` pairs; for increases assert
      the settled value equals `to`, and for `to <= from` assert an immediate
      snap to `to`.
    - Tag `Feature: f4-animated-score, Property 1: ...`; min 100 runs via
      fast-check.
    - **Validates: Requirements 1.1, 1.2, 3.3**

  - [ ]* 4.3 Write property test for celebration scaling
    - **Property 2: Canvas celebration scales with the increase and stays within bounds**
    - Generate arbitrary positive deltas; assert `flash ∈ [0, 1]`,
      `count ∈ [6, 60]`, and both non-decreasing in delta up to their clamps.
    - Tag `Feature: f4-animated-score, Property 2: ...`; min 100 runs via
      fast-check.
    - **Validates: Requirements 2.3**

  - [ ] 4.4 Enable component testing for the structural test
    - Add `@testing-library/react` and `jsdom` as dev dependencies and update
      `vitest.config.ts` to include `src/**/*.test.tsx`.
    - _Requirements: 1.3_

  - [ ]* 4.5 Write structural test for the single score testid
    - **Property 3: Exactly one score testid while playing**
    - Render `PlayingScreen` (jsdom) and assert exactly one
      `data-testid="score"` element is present.
    - **Validates: Requirements 1.3**

- [ ] 5. Verify and commit
  - [ ] 5.1 Run the full verification suite
    - Run `pnpm test:unit` (unit + property tests) and
      `SKIP_ENV_VALIDATION=1 NEXT_PUBLIC_TEST_MODE=1 pnpm build`, then the
      Playwright e2e score assertions; fix any failures.
    - _Requirements: 3.1, 3.2, 3.3_

  - [ ] 5.2 Commit the feature
    - Run `git add -A && git commit -m "kiro brownfield f4: animated score"`.
    - _Requirements: 1.1, 3.1_

## Notes

- Tasks marked with `*` are optional test sub-tasks and can be skipped for a
  faster MVP; core implementation and verification tasks are never optional.
- Tasks 1–2 are verification/alignment tasks because the presentation code
  already exists in the tree; adjust only where the code diverges from the
  design.
- fast-check is already available in the workspace and used by the existing
  `renderer.test.ts`; the property tests reuse it.
- The structural test (4.5) requires component-rendering infrastructure, added
  in 4.4. The single-testid invariant is also covered by the e2e suite.
- Each task references specific requirement clauses for traceability, and each
  property test explicitly references its design property.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "2.1", "2.2", "4.4"] },
    { "id": 1, "tasks": ["4.1"] },
    { "id": 2, "tasks": ["4.2", "4.3", "4.5"] },
    { "id": 3, "tasks": ["5.1"] },
    { "id": 4, "tasks": ["5.2"] }
  ]
}
```
