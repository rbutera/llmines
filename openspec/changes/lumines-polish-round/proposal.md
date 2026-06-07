## Why

The LLMines V2 game is mechanically complete and renders, but a hands-on playtest surfaced a batch of visual/UX/mechanic/audio rough edges. Critically, the team is enforcing spec-first work after a "217 tests green but clicking Start did nothing" regression (the AutoFitCamera zoom-0 blank-render bug) shipped earlier today: green unit tests bypass the real Start path, so a change can pass CI and still be broken in the browser. This polish round therefore lands behind a written change with **verifiable acceptance criteria per item** and a **global production-Start guard**, so a green run can no longer hide a broken game.

## What Changes

Ten polish items, grouped:

**Visual / UX**
1. **Score-delta transient** — the floating "+N" indicator already self-fades but the cosmetic count-up number is permanently overlaid; make the whole score-delta feedback transient (appears on a gain, fades out, leaves the authoritative HUD score as the only persistent value).
2. **~90% viewport width + overlaid auto-hiding chrome** — the canvas fills ~90% of the window width and scales responsively; the non-game chrome (title, sign-in, controls/preview/skin panels) is OVERLAID on the canvas and HIDDEN during active play, shown when not playing / paused / game-over. Must NOT reintroduce the AutoFitCamera zoom-0 blank-render bug (keep the zoom floor + bail-until-finite guards).
3. **Escape = pause** — Escape toggles pause; sweep + gravity halt and are resumable.
4. **Subtle light/dark gem variants** — the gem marker is too big/bright and obscures the block colour; make a light variant and a dark variant so the marker preserves the underlying block's bright-vs-dark identity, dialled down to subtle-but-clear.
5. **Flat 2D next-preview** — preview pieces render as flat 2D squares (no per-column shear, no 3D tilt).
6. **ESDF controls** — add ESDF as a third scheme alongside arrows and vim hjkl (E=rotate, S=left, D=soft-drop, F=right).

**FX**
7. **Gem flood animation obvious** — the gem-clear cascade must read clearly and feel impactful when a gem clears its connected region.
8. **Rework slow/fast fall FX** — redo soft-drop and hard-drop feedback so each reads clearly.

**Mechanic**
9. **Hold-to-sustain slow fall** — holding the soft-drop key produces CONTINUOUS slow fall (faster than gravity, slower than hard-drop), not one row per tap; reconciled with the existing spawn-hold + fresh-press-vs-key-repeat logic.

**Audio**
10. **Music volume slider** — initial volume 0.5, wired to the music gain, persisted with the other settings.

A global non-negotiable: the deterministic core, the `window.__lumines` test seam, and the production Start flow stay intact. The existing `e2e/production-start.spec.ts` MUST stay green.

## Impact

- **Code**: `engine/keymap.ts` (ESDF), `engine/controller.ts` (sustained soft-drop, pause/resume), `react/GameShell.tsx` (Escape, overlaid/auto-hiding chrome, ~90% width, volume slider, transient score), `react/ScoreFx.tsx` (transience), `render3d/Cube.tsx` + `render3d/settings.ts` (light/dark gem variants, subtler), `render3d/PreviewDock.tsx` (flat 2D), `render3d/Scene3D.tsx` + chain FX (obvious flood), drop-FX tuning, new audio gain wiring.
- **Tests**: new unit tests for ESDF mapping, escape=pause, hold-sustains-soft-drop, volume default 0.5, score-delta transience, preview-is-flat; the production-start e2e stays green (escape=pause assertion added if feasible).
- **Determinism**: unchanged. All new render/FX/audio state is render-only; the sustained soft-drop routes through the existing pure `softDrop` core op; pause halts the production loop only (test seam untouched).
- **No impact** on: core purity boundary, scoring math, RNG order, `window.__lumines` shape, the existing 16x10 grid/sweep/scoring specs.
