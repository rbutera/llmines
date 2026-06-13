# Proposal: audio-truth

## Why

The audio layer cannot satisfy the listener-coherence rubric because its inputs and outputs are
both wrong (Root-cause audit B1-B6): the engine is fed clears INFERRED FROM SCORE DELTAS (soft-drop
bonuses and board bonuses masquerade as clears, combo is always 0), the "vocals revealed →
mandatory advance" rule is structurally dead once a segment carries a full-reveal floor forward
(vocals loop indefinitely — Rai's top audio bug), the rendered clear-stage SFX is shipped but
routed to silence, locks are only audible on hard drops, and the per-song SFX one-shots sound out
of place against most segments (Rai's diagnosis: SFX must be segment-specific).

## What Changes

- **Real clear events, not score-diff inference.** `AudioEventDeriver` consumes the core's new
  truthful clear telemetry (`squares`, `comboMultiplier`, group erases from RenderState — provided
  by the `core-lumines-fidelity` change) instead of `round(scoreDelta/40)`. Soft-drop bonuses,
  board bonuses, and multipliers can no longer fake or inflate clears; combo weighting becomes
  real.
- **BREAKING (behaviour): vocals → mandatory advance, including carried floors.** A segment whose
  TOP tier is audible (earned in-segment OR carried in via the entry floor) must advance after at
  most one full loop at top. Implementation choice (design.md): cap the carried `entryFloor` at
  `top - 1` so vocals are re-earned per segment AND arm the mandatory advance for any segment that
  reaches top — eliminating the loop-forever steady state while preserving the
  no-cascade/no-fast-forward guarantees.
- **Clear-stage SFX wired.** `lineClear`/`chain` events route to the shipped `stage` sample
  (intensity-scaled), ending silent clears. The most rewarding action in the game gets its sound.
- **Locks audible on every settle.** The deriver gains a reliable lock signal (from core
  telemetry) so gravity- and soft-drop locks thud like hard drops (with hard drop keeping its
  heavier slam).
- **Per-segment SFX palettes.** The audio pipeline cuts action SFX per SEGMENT from that
  segment's own stems/character; the manifest carries `segments[].sfx` (fallback to song-level
  set); the engine hot-swaps the SFX pool on segment entry so action sounds always belong to what
  is currently playing.
- **Layered-mix truth pass.** The top tier of each segment is re-rendered from (or level-matched
  against) the full-mix master `0 *.wav` so full reveal sounds like the song (B6); validated by
  ear-gate render comparison in the pipeline.

## Capabilities

### New Capabilities
- `audio-event-truth`: the controller→audio event contract (real squares/combo/lock/chain events,
  no score inference).
- `clear-gated-progression`: horizontal advance rules incl. the carried-floor mandatory-advance
  fix, forward-only/one-step/in-flight-lock/no-fast-forward invariants, end-of-song skin switch.
- `action-sfx`: per-segment SFX palettes, manifest schema, engine pool hot-swap, clear-stage +
  universal lock routing.
- `tier-mix-fidelity`: top-tier == master-mix requirement and the render/validation pipeline rule.

### Modified Capabilities
(none — no persistent specs exist yet)

## Impact

- `src/game/audio/procedural/events.ts` (rewrite of derivation), `engine.ts` (advance gates,
  entryFloor cap, SFX pool per segment, stage/lock routing), `sfxRouting.ts` (clear + lock + move
  routing).
- `scripts/audio/` pipeline: per-segment SFX cutting + manifest emit + top-tier master alignment;
  `public/audio/manifest.json` schema gains `segments[].sfx`.
- Depends on `core-lumines-fidelity` for truthful telemetry (the event-contract half can land
  with a temporary adapter if core lands later, but the changes are designed to merge core-first).
- Asset regeneration uses the local source stems (`~/dev/llmines-audio-build/audio-src/`,
  gitignored) — pipeline must keep originals intact.
- Tests: engine integration tests for the new gates; events tests rewritten against the real
  contract; strict-autoplay harness unchanged and must stay green.
