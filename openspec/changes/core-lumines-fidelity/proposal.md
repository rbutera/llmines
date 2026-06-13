# Proposal: core-lumines-fidelity

## Why

The deployed game diverges from verified original-Lumines mechanics in ways players feel directly
(README §3b + Root-cause audit, 2026-06-13): gems vanish on hard drop (A1), squares completed
ahead of the bar wait a full extra pass (A2), squares peel column-by-column instead of erasing as
groups (A3), every game deals the identical piece sequence (A4), pieces spawn inside the visible
field causing premature game over (A5), and the single-sweep ×4 big-clear payoff — the core
risk/reward of Lumines — does not exist (A7/D1). These are all in the pure core, fixable without
touching audio or UI surfaces.

## What Changes

- **Hard drop preserves the chain-special (gem)** through its descent loop, like move/rotate/
  gravity already do.
- **BREAKING (behaviour): mark-as-the-bar-passes sweep semantics.** Replace the
  snapshot-at-pass-start model: the timeline marks completed-square cells as its leading edge
  reaches them, so squares formed mid-pass ahead of the bar clear on the CURRENT pass.
- **BREAKING (behaviour): per-group batch erase with deferred gravity.** Marked cells erase as a
  batch when the bar reaches a column with no marked cells (a gap) or the right edge — never
  column-by-column. Gravity settles only after a group erase. Chain (gem) floods activate at
  group-erase time.
- **BREAKING (behaviour): faithful Challenge scoring.** 1-3 squares in a pass = 40 each; 4+
  squares = 640 + 160 per additional (the single-sweep ×4 package). Award remains deferred to the
  right edge. The cross-pass streak multiplier (Lumines II+ mechanic) is retained but applied on
  top of the faithful base. Soft drop stays +1/cell banked on lock; hard drop scores no drop
  points.
- **Pieces spawn above the visible field** (staging rows above row 0); game over only when a new
  piece cannot enter because the stack blocks entry into the field. The visible 16×10 becomes
  fully usable.
- **Random seed per game** (crypto/time-derived), with the seed surfaced so a run is reproducible.
- **Replay record**: the controller records `{seed, versioned input log with timestamps}` for
  every run, exposed for download/inspection on game over — the missing repro tool (A8).
- **Core emits truthful clear telemetry**: pass-completion events carrying real
  `{squares, comboMultiplier, groupErases}` in RenderState, so downstream consumers (audio) stop
  inferring clears from score deltas.

## Capabilities

### New Capabilities
- `sweep-clear-mechanics`: timeline marking, per-group batch erase, deferred gravity, chain-flood
  activation timing.
- `challenge-scoring`: faithful base scoring + single-sweep ×4 package + retained streak
  multiplier + soft-drop scoring.
- `piece-lifecycle`: spawn staging above the field, hold window, hard/soft drop semantics
  (including gem preservation), game-over condition.
- `run-identity-replay`: per-game random seed, seed exposure, input-log replay record, clear
  telemetry in RenderState.

### Modified Capabilities
(none — no persistent specs exist yet)

## Impact

- `src/game/core/`: `sweep.ts` (rewrite of pass model), `detect.ts` (incremental marking),
  `scoring.ts` + `constants.ts` (faithful values), `piece.ts` (gem-through-hard-drop, spawn
  staging, game-over), `grid.ts` (deferred settle helpers), `types.ts` (SweepPass/GameState
  shape), `rng.ts` (seeding).
- `src/game/engine/controller.ts`: seed handling, replay recording, RenderState telemetry fields.
- Test suite: `core.test.ts`, `chain.test.ts`, `scoring.test.ts`, determinism/purity tests all
  need updating to the new semantics (stale-test rewrites are in scope, not skips).
- Renderer reads marked cells from RenderState — field shape must stay compatible or be updated
  in lockstep (`render3d/`, `render/renderer.ts`).
- Does NOT touch: audio engine, skins, GameShell UI structure, auth.
