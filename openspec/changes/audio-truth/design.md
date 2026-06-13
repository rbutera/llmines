## Context

The audio layer must satisfy one rubric (README §1): a bystander watching someone
play should feel they are hearing the song from the beginning, in a cohesive order.
Two things break that today, and both are root-caused in the README audit (B1-B6):

1. **The engine's INPUTS lie.** `AudioEventDeriver` (`events.ts`) infers clears from
   `score` deltas: `squares = round(scoreDelta / 40)`, `combo = 0` always. A soft-drop
   bonus fires a fake `lineClear`; a ×4-multiplied 640-point pass reads as 16 squares;
   a 10,000-point all-clear reads as 250 squares and slams the advance cap. The
   clear-gated progression — the whole game — is driven by a proxy that lies in both
   directions (B1). Locks are only detectable on hard drops (B4); `move` is unmapped.

2. **The engine's OUTPUTS are wrong.** Vocals (the top tier) loop forever once a
   segment carries a full-reveal floor (B2 — Rai's #1 audio bug, confirmed in the
   2026-06-13 playtest: "vocals have been heard looping many times"). Clears are silent
   even though a `stage` sample is shipped (B3). The per-SONG SFX one-shots clash with
   most segments (B5). The summed top tier doesn't sound like the mastered song (B6).

The sibling change `core-lumines-fidelity` makes the controller emit **truthful clear
telemetry** in RenderState (pass-completion events with real `{squares, comboMultiplier,
groupErases}`, and lock events with a cause). This change consumes that contract and
fixes the output side. The two are designed to merge core-first; the event-contract
half can land behind a temporary adapter if core lands later (see Migration Plan).

**Current engine model (unchanged by this design, stated for grounding):** each song is
an ordered list of SEGMENTS; each segment is pre-rendered at N CUMULATIVE TIERS
(tier0 = bed, top = full mix incl. vocals). Horizontal advance is clear-gated,
forward-only, one-step, in-flight-locked, no-fast-forward, bar-aligned; advancing past
the TERMINAL segment fires `onSongComplete` (skin switch). Vertical reveal is sticky
within a segment with a floor carried forward. Tuning: `ADVANCE_THRESHOLD = 30`,
`TIER_REVEAL_STEP = 6`, `MIN_AUDIBLE_LAYERS = 2`. The runtime keeps ≤2 bed players
audible (the no-hiss mechanic).

## Goals / Non-Goals

**Goals:**
- Feed the engine REAL clear events `{squares, comboMultiplier}` and a lock-per-settle
  signal with cause, derived from the sibling's RenderState telemetry — delete the
  score-diff path so no input can lie.
- Re-derive the engine's clear-weight formula against the real inputs and the existing
  `ADVANCE_THRESHOLD = 30` / `TIER_REVEAL_STEP = 6` knobs, documenting the rationale.
- Make "vocals revealed → mandatory advance" actually advance — for ANY segment whose
  top tier is audible for a full loop, including segments that reached the top via the
  carried entry floor — while preserving forward-only / one-step / in-flight-lock /
  no-cascade / ramp-cancel-guard / TERMINAL→onSongComplete / the gate-(a) low-tier
  exclusion (a low-tier segment must not auto-advance with zero clears).
- Wire the clear-stage SFX (`lineClear`/`chain` → `stage`, velocity scaled by clear
  size) and a universal lock thud (every settle → `drop`, velocity scaled by cause).
  Decide `move`'s routing explicitly.
- Add per-SEGMENT SFX palettes: manifest `segments[].sfx` (fallback to song-level),
  cut from each segment's own stems/character in the pipeline, hot-swapped on segment
  entry (prefetched with the segment, disposed with it).
- Make each segment's TOP tier the full-mix master for that time range (cut from the
  master `0 *.wav` at the same boundaries), with a pipeline level-match validation.
- Keep code shippable against BOTH old (song-level sfx, summed top tier) and new
  manifests, so engine/events code can ship before assets regenerate.
- Keep every gate green: vitest, typecheck, lint, build, the production-start e2e probe,
  and `node scripts/repro-autoplay.mjs` (real strict-autoplay RMS check).

**Non-Goals:**
- Any core / game-logic change (sweep, scoring, gem, spawn, seed, replay) — that is
  `core-lumines-fidelity`. This change only consumes its telemetry.
- The visual/UI Known Issues (hidden score, pointless bars, toggle-skin button, restart
  resets skin, Google auth). Out of scope here.
- Reintroducing an autonomous musical timeline. Clears drive the song (README §1).
- Re-tuning `ADVANCE_THRESHOLD` / `TIER_REVEAL_STEP` away from 30 / 6. The weight
  formula is re-derived to keep pacing equivalent under real inputs, not to retune.
- The no-hiss tier-render architecture (cumulative renders, ≤2 audible) — kept as-is
  except for the top-tier master swap (B6), which preserves the cumulative invariant.

## Decisions

### D1. Consume real clear telemetry; delete the score-diff path entirely

`core-lumines-fidelity` adds to RenderState a monotonic-id pass-completion field. The
contract this change designs against (final field names tracked with the sibling's
design.md — adapter-isolated so a rename is a one-line change, see D7):

```
lastPass?: {
  id: number;            // monotonic, one per completed sweep pass that erased ≥1 square
  squares: number;       // REAL squares erased this pass (group geometry, not score/40)
  comboMultiplier: number; // the cross-pass streak multiplier in effect (1 = none)
  groupErases: number;   // number of contiguous marked groups erased this pass
}
lastLock?: {
  id: number;            // monotonic, one per settle (gravity / soft / hard)
  cause: "hard" | "soft" | "gravity";
}
```

**RESOLVED against the sibling's final design (core D8):** the actual field names are
`lastPassComplete?: { id, squares, comboMultiplier, groupErases: { cells: number[];
hadChain: boolean }[] }` and `lastLock?: { id, cause: "gravity"|"soft"|"hard" }`. The
adapter maps `lastPassComplete` → this design's `lastPass` view (with `groupErases:
number` = the array length). Lock cause IS three-valued — the deriver uses all three.

`AudioEventDeriver.derive(rs)` is rewritten to diff **monotonic ids**, never score:

- `lastPass.id` advanced **AND `squares >= 1`** → emit `{ type: "lineClear", squares,
  combo: comboMultiplier - 1 }` (real values; the deriver pre-subtracts 1 so the engine's
  existing `1 + squares + combo` weight needs no change — `combo` on the event IS the
  streak offset, 0 = no streak). The `squares >= 1`
  guard is mandatory: the core may bump the pass id on zero-square passes, and a
  weight-1 phantom event must never feed `segmentScore`.
- `lastLock.id` advanced → emit `{ type: "lock", cause }` (every settle, not just hard).
- `lastChainClear.id` advanced → emit `{ type: "chain", size }` (unchanged — already
  truthful from the core's record-only `lastChainClear.cells.length`).
- `move` / `rotate` / `softDrop` — unchanged (already render-truthful: column change,
  cells-matrix change, `softDropPulses` counter).

The `score`-delta branch is **deleted**, not kept as a fallback. A fallback that can
lie is worse than absent — the whole point of B1 is that a proxy quietly corrupts the
clear-gate. `AudioEvent.lock` gains an optional `cause` (additive; absent = treat as a
neutral lock). `AudioEvent.lineClear.combo` now carries the real `comboMultiplier`.

*Alternative considered:* keep the score-diff path as a fallback when `lastPass` is
absent (core not yet merged). Rejected — see D7; the temporary adapter handles the
ordering risk without leaving a lying path in shipped code.

### D2. Re-derived clear-weight formula

Today `onScore` is fed: `lineClear → 1 + squares + combo`, `chain → 2 + min(8, size)`.
With the OLD lying inputs, `combo` was always 0 and `squares` was `round(delta/40)`, so
a real ×4 640-point pass injected `1 + 16 + 0 = 17` (≈ half the advance gate in one
pass — a fast-forward), and a soft-drop bonus injected a phantom `1 + 1 + 0 = 2`.

Under REAL inputs `squares` is the genuine count (1-3 typical, 4+ on a big harvest) and
`comboMultiplier` is the streak factor (1 normal, up to ~4). Feeding `combo =
comboMultiplier` directly would let a ×4 streak on a 4-square pass inject `1 + 4 + 4 =
9`, still near a fast-forward. The intent (README/engine docstring) is "weight ≈ 3-5 for
a typical clear, ~3-4 clears reveal one tier, ~6-8 clears earn an advance." New formula:

```
lineClear weight = 1 + squares + (comboMultiplier - 1)
chain weight     = 2 + min(8, size)        // unchanged
```

- A typical 2-square, no-streak pass: `1 + 2 + 0 = 3` → matches the documented ≈3.
- A 1-square pass: `1 + 1 + 0 = 2`.
- A 4-square single-sweep harvest, no streak: `1 + 4 + 0 = 5` (rewards the big clear,
  the Lumines risk/reward, without fast-forwarding — 5 ≪ 30).
- A 4-square pass during a ×3 streak: `1 + 4 + 2 = 7` (a sustained streak advances
  faster, intended).

`(comboMultiplier - 1)` is used (not `comboMultiplier`) because a multiplier of 1 means
"no streak" and must add 0, matching the old `combo: 0` baseline that the pacing knobs
(30 / 6) were sized against. The `onScore` cap (`ADVANCE_THRESHOLD * 2 = 60`) and NaN
guard are retained — they already bound a single huge weight to at most one extra
advance's worth, which is the other half of the no-fast-forward guarantee. The knobs
30 / 6 are unchanged; only the weight expression changes so real inputs reproduce the
intended pacing. Documented inline against 30 / 6.

*Alternative considered:* scale weight by `squares * comboMultiplier` (mirror the score
formula). Rejected — reintroduces the explosive coupling B1 warned about (a streaked
big clear would slam the cap and fast-forward).

### D3. Vocals → mandatory advance, including carried-in tops (the B2 fix)

**The failure walked through.** `advanceSegment` sets `entryFloor = this.tier` (the tier
reached) for the next segment (`engine.ts:1126`). Once any segment is fully revealed,
every later segment ENTERS at the top tier (vocals from bar one). But `shouldAdvance`
gate (b) requires the top reveal to be EARNED in the current segment
(`segmentScore ≥ top·TIER_REVEAL_STEP`), explicitly excluding a carried-in top. And
`enterSegment` resets `segmentScore = 0`. So a carried-in-top segment has `tier = top`
but `segmentScore = 0`, never satisfies gate (b), and the mandatory advance never fires
— vocals loop until the player grinds the full 30-point clear-gate in that segment.
That is exactly the reported bug.

**The fix.** Cap the carried `entryFloor` at `top - 1` on entry (vocals are
*re-earned* per segment), AND make the mandatory advance fire for any segment whose top
is audible for a full loop regardless of how the top was reached. Concretely:

1. In `enterSegment`, clamp the carried floor below the new segment's top:
   `startTier = min(startTier, max(tierFloorFor(seg), top - 1))`. The min-audible floor
   (≥2 layers) still applies. A segment never enters AT its top from a carry; it enters
   at most one tier below and the player re-earns the top by clearing. This alone closes
   the loop-forever steady state for the common case (carried full reveal).
2. Rewrite `shouldAdvance` gate (b). Replace "top reveal earned in-segment" with "the
   top tier has been AUDIBLE for a full loop". Track a per-segment flag
   `topHeldSinceBoundary` set true on the boundary *after* the one that first put
   `this.tier === top` (so the top is heard for one whole loop first). The mandatory
   advance fires when `top > tierFloorFor(seg)` (gate (a) — headroom, the low-tier
   exclusion) AND `topHeldSinceBoundary` AND `tierBefore >= top` (gate (c) — the
   ramp-cancel guard: never advance on the boundary the top was just revealed). Because
   step 1 means a carried-in top is no longer possible (the floor caps at top-1), the
   top is always re-revealed in-segment and then held one loop — so the rule fires
   uniformly whether the top was earned from the floor or from bare, with no special
   case for carries.

**Invariants preserved:**
- *forward-only / one-step:* unchanged — `advanceSegment` steps the index by exactly 1
  and the in-flight lock + `segmentScore = 0` reset block a second step.
- *in-flight lock:* `shouldAdvance` still returns false while `transitionInFlight`.
- *no cascade through multiple segments:* the new segment enters at ≤ top-1 (step 1), so
  it cannot itself be instantly at-top; `topHeldSinceBoundary` resets false on entry and
  needs a fresh full loop at top before it can fire again. One mandatory advance per
  segment, never a chain.
- *ramp-cancel guard (gate c):* retained verbatim — `tierBefore < top` blocks advancing
  on the reveal boundary.
- *gate (a) low-tier exclusion:* retained — a segment whose top IS its min-audible floor
  (`top <= tierFloorFor`) has no headroom, never mandatorily advances, so it can only
  advance via the clear-gate (needs real clears — no zero-clear auto-advance).
- *TERMINAL → onSongComplete:* unchanged — an earned advance off the last segment routes
  to `complete()` / the skin switch.

*Alternative considered:* keep `entryFloor = this.tier` (carry the full top) and only
fix gate (b) to accept carried-in tops. Rejected — a carried-in-top segment would arm
the mandatory advance the moment its first loop completes with ZERO clears, making the
song fast-forward through every post-climax segment on autopilot (autonomous-timeline by
the back door). Capping the floor at top-1 forces the player's clears to re-reveal the
top, keeping clears in the loop (README §1) while still guaranteeing vocals never loop
forever.

### D4. Clear-stage + universal lock SFX routing

`sfxRouting.ts` is the pure action→SFX map. Changes:

- **Clear stage (B3):** `lineClear` and `chain` route to `stage`. `play()` currently
  `return`s before SFX routing for these — that early return is removed; clears now BOTH
  feed `segmentScore` (progression, unchanged) AND fire the `stage` one-shot (sound).
  Velocity scales with clear size: `velocity = clamp(0.6 + 0.1 * squares, 0.6, 1.0)` for
  `lineClear` (bigger clear = hotter), `chain` uses a fixed-hot `0.95` (or a layered
  `stage` + `drop` hit — see D4a). The "a clear is SILENT by design" comment is deleted.
- **Universal lock (B4):** `lock` routes to `drop` for EVERY settle (the deriver now
  emits a lock per settle via `lastLock`, not only hard drops). Velocity scales with
  cause: `hard → 1.0`, `soft → 0.7`, `gravity → 0.6`. Hard keeps the heavier slam.
- **Move:** stays SILENT (no routing). Documented decision: Rai's brief listed a move
  sound as optional ("rotate / fast-drop / small-drop / clear-stage"); per-action move
  blips on every column step are noise against a music-led mix and were already removed
  with the procedural voices. Rotate, soft-drop, lock, and clear cover the felt actions.

**D4a. Chain routing.** A chain is a bigger, rarer event than a normal clear. It routes
to `stage` at high velocity AND layers a `drop` hit (the impact of the flood), giving it
a distinct, fatter sound than a plain `lineClear`. If layering proves muddy in the
ear-check, fall back to `stage` at velocity 1.0 alone. Kept as a single decision point in
`routeEvent` so the ear-gate can A/B it.

The `harddrop`→`drop` name-quirk: `sfxRouting.ts` uses `SfxName = "harddrop"` while the
manifest key is `drop`, mapped in `sfxUrlFor`. With lock now the universal settle sound,
the routing SfxName is renamed `drop` to match the manifest (kill the quirk); `sfxUrlFor`
loses its special case. (The `SfxName` union members become `move | rotate | softdrop |
drop | stage`, matching the manifest keys 1:1.)

### D5. Per-segment SFX palettes (the B5 fix)

**Manifest schema (additive, back-compatible):** each segment MAY carry an optional
`sfx` map with the same shape as the song-level `sfx`:

```
segments[].sfx?: { move?, rotate?, softdrop?, drop?, stage? }   // relative .opus paths
songs[].sfx?:    { ... }                                         // existing fallback
```

Resolution: `segmentSfxUrlFor(name, seg, song, base)` = the segment's entry if present,
else the song-level entry, else undefined (silence). Old manifests (no `segments[].sfx`)
resolve to the song-level set exactly as today — no behaviour change without new assets.

**Engine pool hot-swap:** the SFX pool is currently song-scoped (`sfxPools` keyed by
`SfxName`, loaded from `song.sfx`). It becomes SEGMENT-scoped:

- On `enterSegment(index)`, prefetch the entering segment's SFX pool (alongside the tier
  prefetch) from its resolved per-segment urls. If a segment has no per-segment sfx, its
  pool resolves to the song-level urls — so a mixed manifest (some segments with, some
  without) works.
- On the advance settle (where the left-behind segment is disposed), dispose that
  segment's SFX voices too (like its tier players). The active segment's pool is the one
  `playSfx` reads.
- `playSfx(name)` reads the ACTIVE segment's pool. A swap mid-fire is fine — a dropped
  one-shot never surfaces (existing guard).

This keys SFX to "what's currently playing": an intro's ad-libs differ from a beat-drop's.
The cut is driven by the segment's `character` field (D6).

*Alternative considered:* one global pool but with per-segment volume/EQ. Rejected — the
problem is the SOURCE one-shot (an ad-lib from the wrong section), not its level; only a
different sample fixes "sounds out of place."

### D6. Pipeline: per-segment SFX cut + top-tier master fidelity

These are ASSET-pipeline changes (`scripts/audio/`), runnable only with the local source
stems (`~/dev/llmines-audio-build/audio-src/`, gitignored). They are ordered AFTER all
code tasks and explicitly marked as requiring the local pipeline.

- **Per-segment SFX cut (`render-sfx.py` extension):** for each segment, slice action
  one-shots from THAT segment's own stems within the segment's bar window (using the
  segment's `character` to bias selection — e.g. a "build" segment's stage sound is a
  riser from its own build stems, a "beat-drop" segment's drop is its own kick/impact).
  Keep the song-level set as the fallback for any segment that yields no clean slice.
  Originals preserved (new output dirs, like the existing fine-cut convention).
- **Top-tier == master (B6, `render-tiers.py` extension):** for each segment, render the
  TOP tier by cutting the **full-mix master** (`song1/0 Especifico Primero.wav`,
  `song2/0 pipeline male phonk.wav`) at the SAME bar boundaries used for the stem cuts,
  instead of summing the stems. Lower tiers stay cumulative stem sums (the no-hiss bed
  invariant). The crossfade from tier N-2 (stem sum) to tier N-1 (master slice) stays
  constant-sum; a one-time level-match aligns the master slice's bed level to the stem
  bed so the cross doesn't jump (see validation).
- **Level-match validation (new `validate-master-tier.py`, `check-loops.py` style):**
  for each segment, compare the integrated loudness (LUFS) / RMS of the rendered top
  tier against the master slice for that time range; assert the delta is within a small
  tolerance (e.g. ±1.0 LU) — so "full reveal IS the song," verifiably, not by eyeball.
  Fails the pipeline if a segment's top tier drifts from its master slice.
- **Manifest emit (`transcode-and-manifest.py` extension):** write `segments[].sfx`
  alongside `tiers`; keep emitting song-level `sfx` for fallback.

### D7. Ship code before assets: dual-manifest compatibility + temporary telemetry adapter

Two independent ordering risks, both handled so this change can land safely:

- **Assets lag code.** The engine/events code (D1-D5) must work against the CURRENT
  manifest (song-level sfx, summed top tier) AND the new one. Achieved by: `segments[].sfx`
  is optional with song-level fallback (D5); top-tier-as-master is purely an asset
  property the engine doesn't know about (it just plays `tierN-1`). So code ships first,
  assets regenerate later, nothing breaks in between.
- **Core (telemetry) lags audio.** If `core-lumines-fidelity` hasn't merged, RenderState
  has no `lastPass` / `lastLock`. The deriver reads those fields through a single
  `readTelemetry(rs)` adapter. When the fields are absent the adapter returns "no pass /
  no lock this frame" — clears and locks simply don't fire (silent, but never LYING).
  This is a TEMPORARY shim with a `// TODO(core-lumines-fidelity)` marker; the changes
  are designed to merge core-first, and the adapter is deleted then. Crucially the shim
  is *absence*, not the score-diff path — it never reintroduces B1.

## Risks / Trade-offs

- **[Telemetry contract drift]** The exact `lastPass` / `lastLock` field names/shapes are
  owned by the sibling change and may differ at merge. → Isolate ALL field access in the
  `readTelemetry` adapter (D7); a rename is a one-line change, and the events tests assert
  against the adapter's output, not raw RenderState fields.
- **[Mandatory-advance regression]** The gate-(b) rewrite (D3) is the subtlest part; a
  mistake either fast-forwards (zero-clear auto-advance) or reintroduces loop-forever. →
  Engine integration tests cover all four cases: (i) carried-in floor capped at top-1 +
  re-earn + advance, (ii) low-tier segment never auto-advances with zero clears (gate a),
  (iii) ramp-cancel guard (no advance on the reveal boundary), (iv) no cascade (one
  mandatory advance, next segment needs a fresh full loop). Plus the strict-autoplay
  harness asserts vocals actually sound (RMS) and then move on.
- **[Clears now make noise]** Wiring `stage`/`drop` changes the felt mix; could be too
  busy. → Velocity scaling (D4) + the chain A/B point (D4a); final arbiter is Rai's ear
  on the FINE-cut soundboard, as for the original sign-off.
- **[Top-tier master crossfade jump]** Swapping the summed top tier for a master slice
  can introduce a level/timbre step at the tier N-2 → N-1 crossfade. → The level-match
  validation (D6) bounds the bed-level delta; constant-sum crossfade unchanged.
- **[Per-segment SFX cut quality]** A bad slice could sound worse than the song-level
  fallback. → The pipeline keeps the song-level fallback for any segment with no clean
  slice; per-segment is an improvement layer, never a hard dependency.
- **[Two changes, one engine file]** Both changes touch the audio path indirectly (core
  emits, audio consumes) but the FILE sets are disjoint (core = `src/game/core` +
  `controller.ts` emit side; audio = `events.ts` / `engine.ts` / `sfxRouting.ts` consume
  side). → Merge core-first; the adapter (D7) makes audio resilient to either order.

## Migration Plan

1. **Code-first wave (no assets, no core dependency at runtime):** rewrite `events.ts`
   to the telemetry adapter + real events (D1, D7 shim), retune the weight formula in
   `engine.play/onScore` (D2), implement the mandatory-advance fix in `enterSegment` /
   `shouldAdvance` (D3), wire clear/lock SFX in `sfxRouting.ts` + `engine.play` (D4),
   add the optional `segments[].sfx` schema + per-segment pool hot-swap (D5 engine side).
   Ships against the current manifest (song-level sfx fallback) and degrades to silent
   (never lying) if core telemetry is absent.
2. **Merge order:** land `core-lumines-fidelity` first (or together); then the
   `readTelemetry` adapter's fields light up and the `// TODO` shim is removed.
3. **Asset wave (requires local pipeline, ordered last):** extend `render-sfx.py`
   (per-segment cut), `render-tiers.py` (top-tier master), add `validate-master-tier.py`,
   extend `transcode-and-manifest.py` (emit `segments[].sfx`). Regenerate, validate, swap
   `public/audio/`. Originals preserved.
4. **Rollback:** the code wave is safe to revert independently (events/engine/sfx files);
   the asset wave is a manifest+opus swap — revert by restoring the prior `public/audio/`.
   No persisted state, no schema migration.
5. **Gates each step:** vitest + typecheck + lint + build + production-start e2e +
   `node scripts/repro-autoplay.mjs`; the asset wave additionally runs the pipeline
   validators (`check-loops.py`, `validate-master-tier.py`) and an ear-check on the
   soundboard before the `public/audio/` swap.

## Open Questions

- **Exact telemetry field names.** `lastPass` / `lastLock` and their member names are the
  sibling change's to finalise. The adapter (D7) absorbs the final names; if the sibling's
  design.md lands first, reconcile names there before implementation.
- **Lock cause granularity.** Does the core distinguish soft vs gravity locks, or only
  hard vs not-hard? The deriver handles three causes but degrades gracefully to two
  (gravity velocity used for any non-hard, non-soft). Confirm against the sibling.
- **Chain SFX layering vs single hot stage (D4a)** — resolve on the ear-check, not in
  spec; the spec requires "a chain is audibly distinct from a plain clear," leaving the
  realization to the ear-gate.
