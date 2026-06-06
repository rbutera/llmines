# Quickstart: Validate Dynamic Animated Score

Run/verify guide. Invariants live in `contracts/score-fx.md`; view-state in `data-model.md`.

## Prerequisites

- `pnpm install` done.
- Feature implemented: `ScoreFx.tsx` overlay mounted over the game view in `GameShell`,
  `score-effects.ts` tier helper, `score` testid unchanged.

## 1. Automated gate (objective backbone)

```bash
pnpm test          # Vitest: score-effects tier/timing unit tests
pnpm test:e2e      # Playwright: effect fires / scales / transient / value-exact
pnpm check         # lint + tsc --noEmit
```

**Expected**: all green, including
- unit: `fxTier(0) === "none"`, small delta → `"modest"`, large delta → `"big"` (INV-3/INV-5);
- e2e: after a scoring clear the `score` testid still equals the exact integer (INV-1), a
  `score-fx` overlay appears in the game view (INV-2), a big multi-square clear yields
  `data-fx-tier="big"` vs a single square's `"modest"` (INV-3), the effect is transient and
  `pointer-events-none` (INV-4), and restart resets with no stale effect (INV-5);
- all existing tests (features 001/002, gameplay, scoring, sweep) still green (INV-7).

## 2. Manual feel check (this IS the feature)

```bash
NEXT_PUBLIC_TEST_MODE=1 pnpm dev   # http://localhost:3000, click Start
```

Drive scoring deterministically in the console, then watch the game view:

```js
__lumines.spawn([[0,0],[0,0]]);   // mono 2x2
for (let i=0;i<20;i++) __lumines.tick();   // land it -> a square forms
__lumines.sweepNow();             // SCORE! watch the count-up + pop + flash over the board
__lumines.state().score;          // authoritative integer (e.g. 4) — exact
```

Build a bigger clear (multiple squares in one pass) and sweep to feel the **big** tier
(extra particles/flash, stronger pop). Or just play normally and clear squares.

**Expected**: an impactful, satisfying reaction in the game view on every score gain;
bigger clears clearly punch harder; the HUD number stays correct; nothing blocks play.

## 3. No-regression / accessibility spot checks (INV-4/INV-6/INV-7)

- Input, block fall, and the sweep continue uninterrupted while effects play; effects clear
  and never permanently cover the board.
- Restart: score returns to 0, no lingering effect.
- Enable OS "reduce motion" → the effect dials down (no large bursts) but the value still
  updates.

## Pass criteria

- [ ] `pnpm test`, `pnpm test:e2e`, `pnpm check` green.
- [ ] Score gain triggers a visible in-view animation/effect; big clears hit harder.
- [ ] `score` testid always shows the exact integer (value assertions intact).
- [ ] Effects are transient, non-blocking, reset on restart, and honour reduced motion.
- [ ] No regression to existing gameplay/polish or prior features.
