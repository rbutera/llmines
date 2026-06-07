# Tasks — F4: Dynamic animated score

- [ ] 1. CSS keyframes for the juicy score
  - `globals.css`: add `score-pop` (scale + glow) and `score-float` (rise + fade)
    keyframes + helper classes; reduce under `prefers-reduced-motion`.
  - _Requirements: 2.1, 2.2_

- [ ] 2. `ScoreOverlay` React component
  - Count-up that settles exactly on the value (snap on reset/decrease).
  - Pop/scale on increase (keyed replay) + glow.
  - Floating "+N" popups added on increase and auto-removed.
  - Carries the single `data-testid="score"`.
  - _Requirements: 1.1, 1.2, 1.3, 2.1, 2.2, 2.4, 3.3_

- [ ] 3. Wire overlay into the game view
  - `GameShell.tsx` `PlayingScreen`: wrap `GameCanvas` + `ScoreOverlay` in a
    relative container; remove the duplicate sidebar `score` testid block.
  - _Requirements: 1.3, 2.4_

- [ ] 4. Canvas celebration in the renderer
  - `renderer.ts`: track `prevScore`; on increase seed a gold flash + particles
    scaled by delta; add a `scoreG` layer; decay/age each frame; clear on reset.
  - _Requirements: 2.3, 3.2_

- [ ] 5. Verify + commit
  - `pnpm test` green; `SKIP_ENV_VALIDATION=1 NEXT_PUBLIC_TEST_MODE=1 pnpm build`.
  - Run e2e score assertions.
  - `git add -A && git commit -m "kiro brownfield f4: animated score"`
  - _Requirements: 1.1, 3.1, 3.3_
