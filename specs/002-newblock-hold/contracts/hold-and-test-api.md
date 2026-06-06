# Contract: Hold Behaviour & Test-API Additions

Pins the externally observable behaviour and the `window.__lumines` surface changes.

## Test API surface (`window.__lumines`, test mode only)

Existing methods unchanged: `seed`, `state`, `marked`, `spawn`, `tick`, `sweepNow`,
`sweepProgress`. **Additions:**

```ts
interface LuminesTestApi {
  // ...existing...
  state(): PublicState;            // now includes hold (see below)
  pressSoftDrop(): void;           // FRESH deliberate soft-drop
  pressHardDrop(): void;           // FRESH deliberate hard-drop
}

interface PublicState {
  grid: Grid;
  score: number;
  gameOver: boolean;
  sweepX: number;
  hold: { active: boolean; remainingMs: number };   // NEW
}
```

- `pressSoftDrop()` / `pressHardDrop()` simulate a *fresh* deliberate press (equivalent to
  a `keydown` with `repeat === false`). Withholding these across a `spawn()` simulates a
  carried-over held key (the block stays held).
- `tick()` is **hold-aware**: a `tick()` while `hold.active` lapses the hold (no descent);
  once not holding it is the normal one-row gravity step. `tick()` still never auto-spawns.

## Behavioural invariants (must hold after the change)

### INV-1 — Hold on spawn (FR-001, SC-001)
Immediately after any spawn that produces an active piece, `state().hold.active === true`
and the piece's cells remain at the spawn rows. With no fresh press, the piece advances
0 rows for the duration of the hold window.

### INV-2 — Carried-over key does not drop (FR-003, SC-002, SC-006)
While `hold.active`, a non-fresh drop (`input(action,{fresh:false})`, or simply not calling
the press hooks in test mode) causes no descent and does not end the hold. Holding across
N consecutive lock→spawn transitions skips 0 holds.

### INV-3 — Fresh press drops immediately (FR-004, SC-004)
While `hold.active`, a fresh `pressSoftDrop()` ends the hold (`active` → false) and the
piece descends right away; a fresh `pressHardDrop()` settles it immediately. Effect is
observable within one step (no waiting out the timer).

### INV-4 — Hold lapses to normal gravity (FR-005, SC-003)
If the hold window elapses with no fresh press, `hold.active` becomes false and the piece
begins descending at the normal gravity cadence (not accelerated; the first descent occurs
one normal interval after the hold ends, not instantly).

### INV-5 — Move/rotate free during hold (FR-002)
While `hold.active`, left/right/rotate apply immediately and do not change
`hold.remainingMs` or start the fall.

### INV-6 — Countdown observable (SC-005)
For a held block, `hold.remainingMs` is `> 0` and decreases over the window (observable via
the production loop); `hold.active` is `false` once the block is falling, with
`remainingMs === 0`.

### INV-7 — No behavioural drift (FR-009)
Movement, rotation, normal gravity, soft/hard-drop semantics once falling, sweep, scoring,
lock/settle, game-over/restart, and the feature-001 bottom-row clip behaviour are
unchanged. Full pre-existing suites pass (with the single intentionally-updated
spawn→tick descent assertion).

## Verification matrix

| Invariant | Check |
|-----------|-------|
| INV-1 | e2e: spawn, assert `hold.active` + 0-row advance with no press; unit: pump < HOLD_MS, piece stays at spawn row |
| INV-2 | unit: `input('softDrop',{fresh:false})` during hold → no descent, still held; e2e: `tick()` carry-over then assert no fast-drop |
| INV-3 | e2e: `pressSoftDrop()` during hold → descends + `hold.active===false`; `pressHardDrop()` → lands; unit: fresh soft-drop during hold descends |
| INV-4 | unit: pump ≥ HOLD_MS with no press → piece descends at normal interval; e2e: tick to lapse → normal gravity |
| INV-5 | unit/e2e: move/rotate during hold → position changes, `remainingMs` unchanged, still held |
| INV-6 | unit: `getRenderState().hold.remainingMs` decreases across pumped frames |
| INV-7 | `pnpm test` + `pnpm test:e2e` green |
