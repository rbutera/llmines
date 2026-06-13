# Proposal: heat-progression-and-tone-sfx

## Why

Two owner-driven reworks of the interactive audio model:

1. **The clear-gated progression is too binary and produces a jarring vocal cut.** Today the
   horizontal advance is gated by a per-segment monotonic `segmentScore` that RESETS on every
   segment entry, and the vertical tier reveal is sticky-up-only with the carried floor CAPPED at
   `top-1` (so vocals are re-earned each segment). The audible result: full-mix vocals are playing,
   the segment advances, and the next segment drops back below vocals — a hard, unmusical cut. The
   owner wants a continuous **heat / performance** model: clearing builds heat; heat drives how many
   layers play (more heat = more layers, up to vocals); heat decays on clear-less passes (layers
   drop); a segment only advances once heat has earned it; and crucially the layer count CARRIES
   ACROSS a segment transition (the next segment starts at the same layers unless heat dropped) so a
   sustained-heat player hears vocals continue seamlessly instead of being cut. The loop mechanic is
   retained — a low-heat player loops in place rather than the song running on regardless.

2. **The recorded ad-lib SFX are jarring and wrong.** They are not the per-section sounds the owner
   described; they clash. The owner wants the **tones-based** approach instead: subtle SYNTHESISED
   tones in the song's key. Specifically: **the sweep CLEAR is silent**; **forming a 2×2 match
   (staging blocks for clear) plays a little in-key "ding"**; rotate / drop are subtle in-key tones.
   Keep both approaches in the code (recorded vs tone) behind a selector, defaulting to tones.

## What Changes

### Heat-driven progression (replaces the clear-gated segmentScore/sticky-tier model)

- **NEW: a continuous `heat` meter** (0..1) on the audio engine. A clear adds heat (scaled by
  squares + combo); a sweep pass with NO clear decays heat by a step (consecutive clear-less passes
  compound the decay).
- **BREAKING: layers follow heat, up AND down.** The audible cumulative tier is derived from heat
  (`tier ≈ round(heat × maxTier)`, quantised, one step per loop boundary so it stays musical).
  Replaces the sticky-up-only reveal: layers now DROP when heat drops (clear-less passes), per the
  owner's "the layers would drop."
- **BREAKING: layer count carries across segment transitions.** Entering the next segment, the
  audible tier is the CURRENT heat-derived tier — NOT reset/capped to `top-1`. So if vocals were
  playing (high heat), the next segment also enters at vocals (no cut). This is the fix for the
  jarring vocal drop. (Removes the `entryFloor` cap at `top-1` and the per-segment `segmentScore`
  reset.)
- **BREAKING: heat-gated advance, loop retained.** A segment advances forward only once the
  segment has been built to its TOP tier (ALL layers audible) AND that top tier has been heard for
  a full loop ("progression opens at the end once all the layers are built up"). There is NO
  bare-heat advance threshold — advancing on heat alone could fire before the top tier is audible
  (the heat→tier `round()` mapping reveals the song2 top only at heat ≥ 0.875), which would skip
  unheard vocals; the owner's hard rule is never to skip unheard material. Below the top-built +
  held gate the segment LOOPS in place (no autonomous run-on, no skip). Forward-only, one-step,
  in-flight-locked, no-fast-forward preserved. End-of-song still fires `onSongComplete` (skin
  switch).
- **Minimum-audible floor retained** (never fully silent: ≥ the min layers even at zero heat).

### Tone-based SFX (replaces the recorded ad-lib one-shots by default)

- **NEW: a synthesised, in-key tone SFX engine** (Tone.js synth). Each action plays a short tone
  drawn from the active song's musical key/scale so it never clashes.
- **BREAKING: the sweep CLEAR is silent** (unchanged intent, made explicit) and **forming a 2×2
  match plays a short in-key "ding"** — a NEW event ("match"/"stage") emitted when blocks become a
  staged-to-clear square, distinct from the (silent) sweep clear.
- Rotate / soft-drop / hard-drop play subtle in-key tones; move stays silent; a **chain** (a gem
  flood at sweep time — a clear) is SILENT in tone mode like the sweep clear (clearing makes no
  noise; only forming a MATCH dings). Sample mode keeps its existing recorded chain routing.
- **An SFX-mode selector** keeps both approaches (recorded `sample` vs `tone`) in the code,
  defaulting to `tone`. The per-segment recorded-sample path (and assets) remain available.
- **Manifest carries the song key/scale** (e.g. root + scale degrees) so tones are in key; a
  sensible default if absent.

### Docs

- **README updated**: the audio model section replaced to describe heat-driven progression (layers
  follow heat up/down, carry across segments, heat-gated advance, loop retained) and the tone-SFX
  model (clear = silent; match = in-key ding; rotate/drop = subtle in-key tones; recorded path kept
  behind the selector).

## Capabilities

### New Capabilities
- `heat-progression`: the heat meter (gain on clear, decay on clear-less passes), heat→layer
  mapping (up/down, quantised, min-audible floor), forward-only advance gated on the top tier
  being audible AND held a full loop (no bare-heat threshold, so unheard material is never
  skipped) with loop retention + end-of-song switch, and layer-count carry-across-segment (the
  no-vocal-cut rule).
- `tone-sfx`: the synthesised in-key tone SFX engine, the match-ding event, clear-silence, the
  recorded-vs-tone selector defaulting to tone, and the manifest key/scale.

### Modified Capabilities
(none persisted — prior changes were archived as deltas, no standing specs to amend)

## Impact

- `src/game/audio/procedural/engine.ts` — the largest change: replace `segmentScore` + sticky tier
  reveal + `entryFloor` cap + `shouldAdvance` gates with the heat meter, heat→tier mapping, and
  heat-gated advance; add the tone-SFX engine + match event; keep the sample path behind a selector.
- `src/game/audio/procedural/events.ts` — emit a `match` event when the render-only
  `markedSquares` count RISES versus the previous frame (NOT gated on `lastLock.id`, which a
  cascade-formed square would not bump); clears (a count DECREASE) and chain stay silent.
- `src/game/audio/procedural/sfxRouting.ts` — route under the tone/sample selector; clear → none;
  chain → none (tone mode); match → ding; rotate/drop → tones.
- `src/game/engine/controller.ts` + `src/game/core/*` — add a render-only `markedSquares: number`
  projection (`computeMarked(grid).distinctSquares`, already returned by `computeMarked` and
  already exposed on `PublicState`) onto `RenderState` so the deriver has a clean lock-independent
  square-count signal (additive, render-only, zero determinism impact).
- `public/audio/manifest.json` + `scripts/audio/*` — add song key/scale to the manifest.
- Tests: engine integration tests rewritten for the heat model (heat gain/decay, layer up/down,
  carry-across, heat-gated advance, loop retention); events/sfx tests for the match event + tone
  routing; the strict-autoplay + production-start e2e must stay green and SHOULD assert the
  no-vocal-cut carry-across observably (tier ≥ prev at a transition when heat is sustained).
- Does NOT change: core sweep/scoring/spawn/gem mechanics, the video backdrop, skins/chrome, auth.

## Open Questions (for design)

(Resolved in design.md.)

- Exact heat curve: `HEAT_GAIN_*` = base 0.06 + 0.025/square + 0.02/combo-step;
  `HEAT_DECAY_PER_EMPTY_PASS` = 0.08 (deliberately below a typical 0.11 clear gain so alternating
  clear/empty-pass does not thrash a layer; a sustained drought sheds). Final values are Rai's
  ear-check, not a blocker (D1/D2).
- Advance rule: design chose the top-tier-built-AND-held-a-loop gate, with NO bare-heat threshold
  (a heat threshold below 1.0 can fire before the top tier is audible and skip unheard material).
  See D4.
- Key/scale: hand-authored per song in the manifest, default `{ root: "A", scale: "minor" }`; the
  first ear-check is on per-song authored keys (the manifest-key step is sequenced before the tone
  ear-check). Tone palette per D6 (match = consonant high degree; rotate = root; drop = low
  degrees; move/clear/chain silent).
