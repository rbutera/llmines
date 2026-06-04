# LLMines MVP Implementation Plan

## Source Spec

`docs/superpowers/specs/2026-06-04-llmines-mvp-design.md`

## Steps

1. Add Vitest and Playwright scripts/configuration.
2. Implement pure game engine modules for constants, RNG, grid helpers, movement, square detection, sweep clearing, scoring, gravity, and snapshots.
3. Add focused Vitest coverage for pinned rules and deterministic test-mode semantics.
4. Replace the starter page with the LLMines app shell and metadata.
5. Implement the React game client for screens, keyboard input, audio, normal-mode loop, score display, restart, controls cheatsheets, credits, and `window.__lumines` test API.
6. Implement the PixiJS board renderer with animated cells, marked highlights, sweep bar, grid treatment, and clear/settle effects.
7. Add Playwright tests for start/game-over flow, DOM hooks, audio loop/source, deterministic API, score updates, square clear, gravity, and sweep timing.
8. Run formatting, typecheck, unit tests, e2e tests, and build; fix issues found by the suites.
