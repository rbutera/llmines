# Quickstart: Validate Bottom-Row Clip/Delay Fix

Validation guide proving the fix works end-to-end and regresses nothing. Implementation
details live in `tasks.md` / the change itself; this is a run/verify guide.

## Prerequisites

- Dependencies installed (`pnpm install`).
- Fix applied in `src/game/engine/controller.ts` (resting → `fallProgress = 0`).

## 1. Automated: unit + e2e (primary gate)

```bash
pnpm test          # Vitest: core + controller units (incl. new fallProgress regression)
pnpm test:e2e      # Playwright: window.__lumines suite (incl. new bottom-row landing case)
pnpm check         # lint + tsc --noEmit
```

**Expected**:
- All existing tests pass (INV-5 / FR-004 / FR-005 — no regression).
- New unit test passes: a piece resting on the floor reports
  `getRenderState().fallProgress === 0`; a mid-fall piece reports `> 0` (INV-2/INV-3).
- New e2e case passes: after dropping a piece to the bottom row, `state().grid` shows the
  block on the correct bottom rows with no out-of-bounds cells (INV-1 / FR-003).

See `contracts/render-invariants.md` for the invariant definitions and the
data-model for the `fallProgress` semantics.

## 2. Manual visual check (the artifact itself)

```bash
NEXT_PUBLIC_TEST_MODE=1 pnpm dev   # http://localhost:3000
```

In the browser console drive a piece straight to the floor:

```js
__lumines.spawn([[0,0],[0,0]]);     // mono 2x2 at top-centre
// repeatedly until it lands on the bottom row:
__lumines.tick();
// inspect the landed stack:
__lumines.state().grid.slice(-2);   // bottom two rows hold the block
```

**Expected (acceptance scenarios)**:
- While the piece is grounded on the bottom row, **no cell is ever drawn below the
  playfield**, and there is **no downward overshoot then snap-up** before it locks
  (FR-001/FR-002, SC-001/SC-002).
- A hard drop (press the hard-drop key, default per `engine/keymap.ts`) locks the block
  immediately on the bottom row with no clip.

## 3. No-regression spot check (overhang settle, FR-004/SC-004)

Build an uneven landing so two columns rest at different heights, then drop a piece across
them and confirm each column still **eases smoothly** into its resting position (the
per-column collapse animation is unchanged):

```js
// example: pre-stack one column taller, then drop a wide piece across the seam
__lumines.spawn([[1,1],[1,1]]);  __lumines.tick(); // ... arrange a step, then drop again
```

**Expected**: settle animation looks identical to before the fix; no column dips below the
playfield during the ease.

## Pass criteria

- [ ] `pnpm test`, `pnpm test:e2e`, `pnpm check` all green.
- [ ] No cell ever rendered below the canvas on bottom-row landings (visual).
- [ ] No delay/snap before lock on the bottom row (visual).
- [ ] `state().grid` reflects landed block on correct bottom rows, zero out-of-bounds.
- [ ] Per-column overhang settle visually unchanged.
