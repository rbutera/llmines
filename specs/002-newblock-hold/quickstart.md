# Quickstart: Validate New-Block Hold + Deliberate Re-Press

Run/verify guide. Behavioural definitions live in `contracts/hold-and-test-api.md`; the
`hold` shape and transitions are in `data-model.md`.

## Prerequisites

- `pnpm install` done.
- Feature implemented (hold lifecycle in `controller.ts`, `fresh = !e.repeat` in
  `GameShell.tsx`, `HOLD_MS` constant, `hold` in `PublicState`, `pressSoftDrop/Hard` hooks).

## 1. Automated gate (primary)

```bash
pnpm test          # Vitest: core + controller (incl. new hold unit tests)
pnpm test:e2e      # Playwright: window.__lumines (incl. new hold cases)
pnpm check         # lint + tsc --noEmit
```

**Expected**: all green, including
- new unit tests: held piece does not descend while `remainingMs > 0`; fresh soft-drop
  during hold descends immediately; carried-over (non-fresh) soft-drop during hold is a
  no-op; hold lapses to normal gravity; `getRenderState().hold` counts down (INV-1..6);
- new e2e cases: `state().hold.active` on spawn; carry-over (`tick()` without press hooks)
  does not fast-drop; `pressSoftDrop()` drops immediately; hold lapses to normal gravity;
  holding across multiple spawns skips no holds;
- the existing "spawn places at top-centre" test, updated so the first tick lapses the
  hold and the second descends (the only intentionally-changed assertion);
- all other pre-existing tests (square clear, gravity settle, sweep timing, game over,
  feature-001 bottom-row clip) unchanged and green.

## 2. Manual feel check (the "ready to place" beat)

```bash
NEXT_PUBLIC_TEST_MODE=1 pnpm dev   # http://localhost:3000, then click Start
```

Deterministic drive in the browser console:

```js
__lumines.spawn([[0,0],[0,0]]);
__lumines.state().hold;            // { active: true, remainingMs: 500 }
// carried-over hold (no fresh press): ticking lapses the hold, no fast-drop
__lumines.tick();
__lumines.state().hold;            // { active: false, remainingMs: 0 }
// fresh deliberate press drops immediately:
__lumines.spawn([[0,0],[0,0]]);
__lumines.pressSoftDrop();         // descends right away; hold.active === false
```

Keyboard feel: start a game, let a block lock while **holding** `j` (soft-drop) or
`Space` (hard-drop). The next block should **hold** at the top (a clear beat), not chain-
drop. Releasing and re-pressing the drop key should drop it immediately.

**Expected**: a brief, intentional "ready to place" beat on each new block; no soft-drop
cascade; deliberate re-press feels instant (not laggy).

## 3. No-regression spot checks (FR-009 / INV-7)

- Move/rotate during the hold works and does not start the fall or change the beat.
- Once falling, soft-drop (held key repeat) and hard-drop behave exactly as before.
- Sweep/scoring/clear, gravity settle, game-over/restart, and the bottom-row clip fix all
  behave as before.

## Pass criteria

- [ ] `pnpm test`, `pnpm test:e2e`, `pnpm check` green.
- [ ] New block holds ~one beat on spawn; `state().hold` reports the countdown.
- [ ] Held key across a lock does not drop the new block (must re-press).
- [ ] Fresh press drops immediately; hold lapses to normal gravity with no input.
- [ ] No regression to existing gameplay/polish.
