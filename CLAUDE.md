<!-- SPECKIT START -->
For additional context about technologies to be used, project structure,
shell commands, and other important information, read the current plan:
`specs/001-llmines-game/plan.md`

## Active feature: LLMines (001-llmines-game)

- **Spec**: `specs/001-llmines-game/spec.md`
- **Plan**: `specs/001-llmines-game/plan.md`
- **Design**: `research.md`, `data-model.md`, `contracts/test-api.md`, `quickstart.md` (same dir)

**Stack**: create-t3-app (Next.js 15 App Router, TypeScript 5.8 strict, tRPC 11, Tailwind v4, React 19) + PixiJS 8.18.1 for the game canvas. pnpm. vitest (logic) + Playwright (e2e) — added during implementation.

**Architecture (3 layers)**:
- `src/game/core/` — pure, dependency-free rules (types, rng, grid, piece, marking, sweep, scoring, gravity, engine). vitest target; no React/Pixi/DOM/timer imports.
- `src/game/render/PixiRenderer.ts` — draws GameState + animations.
- `src/app/_components/` — React screen state machine (start/playing/gameover), `GameCanvas`, HUD, controls cheatsheet; plus `src/game/audio/`, `src/game/driver/`, `src/game/test/testApi.ts`.

**Pinned constants**: grid 16×10; spawn cols 7–8 rows 0–1; colours A=0/B=1; sweep 0.25 s/col (4.0 s = 8 beats @120 BPM); score += clearedCells × distinctSquares (2×2→1, 2×3→2, 3×3→4 squares).

**Test mode**: `NEXT_PUBLIC_TEST_MODE=1` exposes `window.__lumines` + `data-testid` hooks and pauses auto-loops; MUST be entirely absent when unset (production auto-gravity + music-synced sweep unchanged). See `contracts/test-api.md`.
<!-- SPECKIT END -->
