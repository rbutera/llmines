# Phase 1 Data Model: Dynamic Animated Score

No persistent data and no engine/core state changes. The feature introduces presentation-
layer view-state in the `ScoreFx` overlay plus a pure tier mapping.

## Pure helper types (`src/game/react/score-effects.ts`)

### `FxTier`
`"none" | "modest" | "big"` — the celebration intensity for a scoring event.

### `fxTier(delta: number): FxTier`
| Input | Output |
|-------|--------|
| `delta ≤ 0` | `"none"` (no celebration; includes restart `→ 0`) |
| `0 < delta < BIG_THRESHOLD` | `"modest"` |
| `delta ≥ BIG_THRESHOLD` | `"big"` |

- `BIG_THRESHOLD`: named constant (e.g. points beyond a single 2×2 square / multi-square
  pass). Tunable in one place.
- Optional companion: `countUpDurationMs(delta): number` (clamped) for the count-up timing.

Invariants: pure (no DOM/time), deterministic, total over all real numbers.

## Overlay view-state (`src/game/react/ScoreFx.tsx`, component-local)

| State/ref | Type | Meaning |
|-----------|------|---------|
| `prevScore` (ref) | `number` | Last seen authoritative score, to compute `delta` on change |
| `displayValue` (state) | `number` | The cosmetic count-up value easing toward `score` |
| `bursts` (state) | array of `{ id, tier }` | Active, auto-expiring effect instances |
| `reducedMotion` | `boolean` | From `prefers-reduced-motion`; selects the dialed-down path |

State transitions:
- On `score` prop change with `delta = score - prevScore > 0`: push a burst
  `{ id, tier: fxTier(delta) }`, start/continue the count-up toward `score`; update
  `prevScore`.
- A burst auto-expires after its tier's duration (transient; FR-006/SC-004).
- On `delta ≤ 0` (e.g. restart to 0): no burst; snap `displayValue` to `score`; clear
  any in-flight bursts (FR-007).

The authoritative integer is **not** part of this model — it remains the `score` prop value
rendered by the existing `data-testid="score"` element (source of truth, unchanged).

## Observable contract (test surface)

| Element | Meaning |
|---------|---------|
| `data-testid="score"` | Authoritative integer (existing; unchanged) — exact value at all times |
| `data-testid="score-fx"` | The overlay; present/visible while a celebration plays |
| `data-fx-tier` on `score-fx` | `"modest"` / `"big"` for the most recent scoring event |

See `contracts/score-fx.md` for the full invariants and verification matrix.
