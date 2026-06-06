# Contract: Score Effects & Test Surface

The feature's externally observable surface. The authoritative number is unchanged; the
overlay adds cosmetic, transient feedback with assertable hooks.

## DOM / test surface

| Element | Status | Contract |
|---------|--------|----------|
| `data-testid="score"` | EXISTING, unchanged | Always the exact authoritative integer score; assertable at any time |
| `data-testid="score-fx"` | NEW | The cosmetic overlay, mounted in the game-view column; present/visible only while a celebration plays |
| `data-fx-tier` (on `score-fx`) | NEW | `"modest"` or `"big"` for the most recent scoring event (drives intensity); absent/`"none"` when idle |

No change to `window.__lumines` (the deterministic test API) or any engine surface.

## Behavioural invariants

### INV-1 — Authoritative value integrity (FR-003, SC-002)
The `score` testid text equals the exact authoritative integer at all times it is queried —
during, after, and between celebrations. The count-up animates a *separate* element only.

### INV-2 — Effect fires in the game view on every score increase (FR-001/FR-002, SC-001)
Whenever the score increases, a visible celebration (`score-fx`) appears within the
game-view region (over the playfield), promptly after the value changes.

### INV-3 — Intensity scales with the clear (FR-004, SC-003)
A large scoring event yields `data-fx-tier="big"`; a small one yields `"modest"`. `big`
plays a visibly stronger/longer effect (extra particles/flash) than `modest`.

### INV-4 — Transient & non-blocking (FR-005/FR-006, SC-004)
The overlay is `pointer-events-none`; it never blocks input, fall, or sweep, never
permanently obscures the board, and each effect fully clears within ~2 s.

### INV-5 — Zero/negative deltas are silent; restart resets (FR-007)
A zero-point event fires no celebration. On restart (`score → 0`) the displayed value
resets to 0 and no stale effect persists.

### INV-6 — Reduced motion respected
With `prefers-reduced-motion: reduce`, a dialed-down fallback still reflects the change with
minimal motion (no large particle bursts / violent scaling).

### INV-7 — No regression (FR-008)
Controller, core, renderer, and `window.__lumines` are unchanged; existing Vitest +
Playwright suites (including features 001/002) pass; the side-HUD `score` readout still
shows the value.

## Verification matrix

| Invariant | Check |
|-----------|-------|
| INV-1 | e2e: after a clear (`sweepNow`), `score` testid === exact value (e.g. `"4"`); also asserted mid/after effect |
| INV-2 | e2e: after a scoring clear, `score-fx` becomes visible in the game view |
| INV-3 | e2e: a multi-square (big) clear → `data-fx-tier="big"`; a single-square clear → `"modest"`; unit: `fxTier(delta)` mapping |
| INV-4 | e2e: `score-fx` is `pointer-events-none` and disappears after its duration; input still works |
| INV-5 | e2e: restart → `score` is `0`, no `score-fx` visible; unit: `fxTier(0) === "none"` |
| INV-6 | manual quickstart with reduced-motion enabled |
| INV-7 | `pnpm test` + `pnpm test:e2e` + `pnpm check` all green |
