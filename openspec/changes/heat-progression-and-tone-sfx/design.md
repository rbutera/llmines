## Context

The interactive-audio engine (`src/game/audio/procedural/engine.ts`) drives song
progression from the player's clears under the CLEAR-GATED model: a per-segment monotonic
`segmentScore` reveals cumulative stem tiers (sticky, forward-only) and gates a forward-only
one-step segment advance, evaluated only on the segment's loop boundary. That model satisfies
the README listener-coherence rubric for advancing, but the owner has flagged two failures in
play (README "Known issues" + B2):

1. **Jarring vocal cut at a transition.** `segmentScore` RESETS to 0 on every segment entry
   (`enterSegment`) and the carried sticky floor is CAPPED at `top - 1` (`enterSegment`, the
   B2/D3 cap). So a player at full vocals who advances drops to `top-1` in the next segment and
   must re-grind the reveal: full mix is heard, the segment advances, vocals vanish. The cap was
   added to keep the "vocals revealed -> mandatory advance" rule honest, but it produces the
   exact unmusical cut the rubric forbids.

2. **The recorded ad-lib SFX clash.** One per-segment sample set is cut from each segment's
   stems; against a music-led mix they sound wrong and out of place (README B4/B5). The owner
   wants subtle SYNTHESISED tones in the song's key instead, with the recorded path kept behind
   a selector.

The proposal replaces the `segmentScore` / sticky-up-only / `top-1`-cap model with a continuous
**heat** meter, and adds a **tone** SFX engine plus a NEW **match** event.

Constraints that bind this design (from README §4 + the proposal):
- **No-hiss invariant:** the cumulative tier renders mean at most 2 bed players are audible
  across a crossfade. The heat->tier mapping must still cross-fade ONE tier to ONE tier; it must
  never sum many stems.
- **Autoplay:** Tone loads lazily inside the unlock() gesture; nothing may construct an
  AudioContext at module-eval. The new tone synth is also lazy-constructed (inside unlock/first
  use), never at import.
- **Loop-boundary cadence:** tier changes and advances are evaluated ONLY at the segment loop
  boundary (`onLoopBoundary`). The sub-loop cadence hack was reverted (`d61c084`); keep it
  reverted. No fast-forward, forward-only, one-step, in-flight-locked.
- **Test probe:** the headless e2e drives `window.__luminesAudioDev` (`getAudioState`,
  `__injectClears`, `__stepBoundary`). Mechanics stay headless-verifiable; feel stays Rai's ear
  + the strict-autoplay harness.

## Goals / Non-Goals

**Goals:**
- A continuous `heat` meter (0..1): gain on clear (scaled by squares + combo), decay on a
  clear-less loop pass.
- Heat drives the audible cumulative tier UP AND DOWN, quantised, one step per loop boundary,
  bounded below by the min-audible floor.
- The tier CARRIES ACROSS a segment transition from heat (no reset, no `top-1` cap), so
  sustained heat keeps vocals playing across the hand-off (closes failure 1).
- A heat-gated forward-only advance with loop retention and the end-of-song skin switch, keeping
  every existing invariant (forward-only / one-step / in-flight-lock / no-fast-forward /
  no-advance-on-the-reveal-boundary / TERMINAL -> onSongComplete).
- A synthesised in-key tone SFX engine behind an SFX-MODE selector (`"tone" | "sample"`,
  default `"tone"`), keeping the recorded per-segment sample path available.
- A NEW `match` event (a 2x2 square newly staged on a lock/settle) -> a short in-key "ding",
  distinct from the (silent) sweep clear.
- Manifest gains an optional per-song `key` (root + scale) for the tone palette, with a default.
- README audio-model section rewritten.

**Non-Goals:**
- No change to core sweep / scoring / spawn / gem / gravity mechanics, the video backdrop,
  skins/chrome, or auth (the README "Known issues" gameplay bugs are out of scope here).
- No autonomous musical timeline (explicitly rejected, README §1). Heat is still driven by
  clears, evaluated at loop boundaries.
- No re-cut of the existing tier audio assets. The heat model reuses the SAME cumulative tier
  files; only the engine's tier-selection logic changes.
- No removal of the recorded-sample SFX assets or pipeline (kept behind the selector).

## Decisions

### D1. The heat meter (0..1): gain curve

`heat: number` (0..1) replaces `segmentScore` as the engine's progression quantity. It is a
SONG-LEVEL accumulator (NOT reset per segment) so it can carry across transitions; the
no-fast-forward guarantee is enforced by the advance rule + in-flight lock, not by a per-segment
reset (see D4).

A clear adds heat scaled by the real `(squares, combo)` already fed truthfully from
`lastPassComplete` (events.ts D1):

```
HEAT_GAIN_BASE   = 0.06    // a clear is always worth at least this
HEAT_GAIN_SQUARE = 0.025   // per square cleared this pass
HEAT_GAIN_COMBO  = 0.02    // per streak step (comboMultiplier - 1)
gain  = HEAT_GAIN_BASE + HEAT_GAIN_SQUARE*squares + HEAT_GAIN_COMBO*comboStep
heat  = clamp01(heat + gain)
```

Rationale (calibrated against the loop-boundary cadence and the manifest content — song1 = 12
segments x 4 tiers, song2 = 10 x 5):
- A typical no-streak 2-square clear = 0.06 + 0.05 + 0 = **0.11**.
- A strong 4-square single-sweep harvest = 0.06 + 0.10 + 0 = **0.16**; on a x3 streak (comboStep
  2) = 0.20.
- So a steady competent clearer banking ~one 2-square clear per bar window reaches **full layers**
  (heat 1.0 -> top tier) in roughly **9-10 clears**, i.e. several bar windows of clean play —
  fast enough to feel the song fill out, slow enough that the bed/bass/instruments are each heard
  before vocals. A strong run reaches the top tier in ~5-6 clears, so (after the top is held one
  loop, D4) it advances sooner; a weaker run loops the segment until it builds the top.
- The cumulative `weight = 1 + squares + combo` of the old model maps cleanly onto this (same
  inputs, rescaled to 0..1).

A chain feeds heat like a hot clear: `gain = HEAT_GAIN_BASE + HEAT_GAIN_SQUARE * min(8, size)`,
so a big flood is rewarding but bounded.

NaN/Infinity defence is retained: a non-finite gain is ignored and `heat` is re-clamped to 0..1.

### D2. Heat decay on clear-less passes

Decay is evaluated at the loop boundary (`onLoopBoundary`), the same cadence as reveals/advances
— never on a wall clock. The engine tracks whether ANY clear arrived since the last boundary
(`clearedSinceBoundary`, set true in `onScore`, read+reset at the boundary):

```
HEAT_DECAY_PER_EMPTY_PASS = 0.08   // a clear-less loop pass sheds this much heat
if (!clearedSinceBoundary) heat = clamp01(heat - HEAT_DECAY_PER_EMPTY_PASS)
clearedSinceBoundary = false
```

Rationale: the owner's brief is "heat would drop if you had multiple passes without a clear; the
layers would drop." Decay (0.08) is deliberately SMALLER than a typical clear gain (0.11, a
no-streak 2-square clear — D1), so the alternation clear→empty-pass→clear nets slightly POSITIVE
(+0.11 − 0.08 = +0.03 per cycle) and does NOT thrash a layer up and down. One empty pass between
two clears is near-neutral; the layer only sheds under a SUSTAINED drought (the player genuinely
struggling). With `maxTier` = 3 (song1) the tier step is `1/3 ≈ 0.333` of heat (D3), so from a
topped-out heat it takes **~5 consecutive clear-less passes to shed one layer**
(`0.333 / 0.08 ≈ 4.2`, rounded up at the `round()` boundary); for song2 (`maxTier` = 4, step
0.25) it is **~3-4 consecutive empty passes**. So a couple of dry passes are forgiven, a real
drought audibly thins the mix — exactly as intended. Heat floors at 0; the audible tier still
cannot drop below the min-audible floor (D3), so the song is never silent. (Promote/demote
hysteresis — requiring the desired tier to differ for two consecutive boundaries before a DOWN
step commits — is available as a further anti-thrash tuning lever if play surfaces flicker, but
the decay-below-gain margin already prevents single-pass thrash without it.)

### D3. Heat -> tier mapping (up AND down, one step per boundary, min-audible floor)

The desired audible tier is quantised from heat:

```
desiredTier = round(heat * maxTier(seg))          // maxTier = tierCount - 1
flooredTier = max(desiredTier, tierFloorFor(seg)) // never below the ≥2-layer floor
```

At each loop boundary the audible tier moves AT MOST ONE STEP toward `flooredTier` (musical — no
multi-tier jumps mid-song), demoted to the nearest LOADED tier so a missing file never silences:

```
if flooredTier > this.tier  -> step up   one tier  (crossfade up)
if flooredTier < this.tier  -> step down one tier  (crossfade down)   // NEW: down is allowed
```

This REPLACES the sticky-up-only reveal: layers now drop with heat. `MIN_AUDIBLE_LAYERS` (2) and
`tierFloorFor` are retained unchanged as the hard floor. The crossfade is still ONE tier -> ONE
tier with the existing constant-sum linear ramp, so the no-hiss invariant (≤2 audible bed
players) holds by construction.

**The one-step rule is WITHIN-SEGMENT only.** The "at most one step per boundary" cap governs
tier moves on a segment's OWN loop boundaries (the gradual build/shed feel). It does NOT apply to
SEGMENT ENTRY: on entry the tier is instantiated DIRECTLY from heat (D5's carry-across), which can
be a multi-step jump — e.g. a player at heat ≈ 1.0 entering the next segment starts at its top
tier in one move, not one step up from the floor. The carry is the whole point of the no-vocal-cut
fix; the one-step-per-boundary cap is a separate, within-segment smoothing rule. See D5.

Alternative considered: jump straight to `flooredTier` in one boundary. Rejected — a multi-tier
jump on a hot/cold swing is unmusical; one-step-per-boundary keeps the build/shed audibly
gradual, matching the existing reveal feel.

### D4. Heat-gated advance + loop retention (the chosen rule)

A segment advances forward ONLY once ALL its layers have been built up AND its top tier has been
heard a full loop. **Chosen rule (a single conjunction — there is NO bare-heat path):**

```
advance(seg, tierBefore) :=
  not transitionInFlight
  AND not justRevealedTopThisBoundary            // (= tierBefore < maxTier AND this.tier >= maxTier)
  AND this.tier >= maxTier(seg)                  // ALL layers built (top tier audible)
  AND topHeldSinceBoundary                       // top tier has played one full loop
```

There is **no `ADVANCE_HEAT` constant** — it is DELETED. (It is not in the constant set in D1.)

- **Why the bare-heat path is removed.** A `heat >= ADVANCE_HEAT` path let a segment advance
  before its top tier was even audible. Concretely, with `ADVANCE_HEAT = 0.85`: song2 has
  `maxTier = 4`, so its top tier (tier4) only reveals when `round(heat * 4) = 4`, i.e. at
  heat ≥ 0.875 (D3). At heat 0.85 the audible tier is `round(0.85 * 4) = 3` — the vocals have NOT
  sounded yet — and the bare-heat path would advance off the segment anyway, SKIPPING unheard
  vocal material. That violates the owner's hard rule ("never skip unheard material") and the
  "progression opens once ALL the layers are built up" intent. Removing the path guarantees a
  segment can never advance past a tier the player has not heard.
- **The single advance condition** is the owner's explicit rule: reach the top tier (all layers
  audible) AND hold it one full loop (`topHeldSinceBoundary` — vocals are heard a whole loop),
  then the segment MUST advance so the top mix never loops forever.
- **Below this the segment LOOPS in place** — a player who has not built to the top (insufficient
  heat) hears the section repeat, never an autonomous run-on and never a skip.

Preserved invariants (unchanged mechanism):
- **Forward-only / one-step:** `advanceSegment` steps the index by exactly 1, sets
  `transitionInFlight`, never decrements.
- **In-flight lock:** `transitionInFlight` blocks a second advance until the crossfade settles.
- **No fast-forward.** The advance gate requires the top tier AUDIBLE + HELD A LOOP, the within-
  segment tier move is one step per boundary (D3), and an advance is the only thing that happens
  per boundary under the in-flight lock — so a burst that pins heat to 1.0 still cannot skip:
  reaching the top tier itself takes several one-step boundaries, the top must then be held a full
  loop, and the post-advance segment must independently build its OWN top and hold it before it can
  advance again. There is no way to step multiple segments in one boundary or to advance past
  material that has not played. (The old per-segment `segmentScore` reset is gone; the in-flight
  lock + the audible-top-held gate + one-step-per-boundary + boundary cadence carry the guarantee.)
- **No-advance-on-the-reveal-boundary:** `justRevealedTopThisBoundary` (the existing
  `tierBefore < top && this.tier >= top` guard) is kept verbatim — a boundary that JUST revealed
  the top tier does not also advance off it (the reveal ramp would be cancelled and the vocals
  would never sound; they play a full loop first).
- **TERMINAL / end-of-song:** an earned advance off the last segment fires `onSongComplete`
  (skin switch), unchanged.

Why this rule over the alternatives: the proposal offered a "heat >= ADVANCE_HEAT" path OR a
"top tier built + held one loop" path and asked design to pick a coherent rule. The bare-heat
path is rejected outright because, as shown above, the heat→tier `round()` mapping means a heat
threshold below 1.0 can fire BEFORE the top tier is audible (heat 0.85 vs the 0.875 song2 reveal),
which is exactly the "skip unheard material" the owner forbids. The audible-top-held rule is the
owner's stated "progression opens at the end once ALL the layers are built up" and is the only one
of the two that is safe by construction. There is no play style it strands: a strong player simply
reaches the top sooner; a weak player loops until they do.

### D5. Carry-across (the no-vocal-cut fix)

On segment entry the audible tier is the CURRENT heat-derived tier, NOT reset and NOT capped at
`top-1`:

```
enterSegment(index):
  startTier = clamp(round(heat * maxTier(seg)), tierFloorFor(seg), maxTier(seg))
  startTier = nearestAvailableAtOrBelow(seg, startTier)
  this.tier = this.armedTier = this.targetTier = startTier
```

- Removed: the `segmentScore = 0` reset and the `entryFloor` `top-1` cap.
- `entryFloor` is retired as a concept (heat is the single carry-across state). The per-segment
  `topHeldSinceBoundary` latch is RESET on entry (so the advance gate re-arms per segment — the
  new segment must reach AND hold ITS top a loop before it can advance), which is correct: it
  gates the advance, not the carry.
- **Entry instantiates the heat-derived tier DIRECTLY — this is the carry, and it is exempt from
  the one-step-per-boundary cap (D3).** A player at sustained high heat enters the next segment AT
  its top tier in one move (a multi-step jump straight to the top), not one step up from the floor.
  The one-step cap applies only to tier moves WITHIN a segment, never to this entry carry. (If
  heat has fallen, `startTier` is correspondingly lower and the segment enters thinner — the carry
  follows heat in both directions.)

**Walk of the jarring-cut failure, and why this closes it.** Old model: player at vocals
(`tier == top`, `segmentScore` high) earns an advance; `enterSegment` resets `segmentScore = 0`
and caps the carried floor at `top - 1`; the next segment enters at `top - 1` and ramps the top
tier DOWN -> the vocals audibly cut, and must be re-earned over several bars. New model: heat is
~1.0 at the advance (that is WHY it advanced); `enterSegment` computes `startTier =
round(1.0 * maxTier) = top`; the next segment enters AT the top tier; the crossfade is top-tier
-> top-tier across the hand-off -> vocals continue seamlessly. If heat has dropped (player went
cold before the advance), `startTier` is lower and the next segment correctly enters thinner —
the layers follow heat across the boundary in both directions.

### D6. Tone SFX engine + the match event + the selector

**Selector.** `type SfxMode = "tone" | "sample"` on the engine, default `"tone"`. `setSfxMode`
switches at runtime. `"sample"` keeps the existing per-segment recorded path verbatim.

**Tone synth (lazy).** A single `Tone.PolySynth(Tone.Synth)` (or a small monosynth pool),
constructed lazily on first tone-SFX use INSIDE the unlock gesture (same lazy-Tone discipline as
the tier players — never at module-eval). Routed through `this.master`. A short envelope
(`attack ~0.005`, `decay ~0.08`, `sustain 0`, `release ~0.12`) for a subtle click/ding, played
`triggerAttackRelease(note, "16n", time, velocity)`.

**Key/scale source + manifest.** `ManifestSong` gains an optional
`key?: { root: string; scale: "major" | "minor" | "pentatonicMinor" | "pentatonicMajor" }`.
Default if absent: `{ root: "A", scale: "minor" }` (song1's character; phonk song2 also sits in
minor). The engine builds the scale's note set once per song (root MIDI + scale degrees, e.g.
natural minor = [0,2,3,5,7,8,10], pentatonic minor = [0,3,5,7,10]) across ~2 octaves.

**Tone palette (which scale degrees map to which action).** Velocities deliberately subtle:

| Event       | Note choice                                  | Octave / register | Velocity | Duration |
|-------------|----------------------------------------------|-------------------|----------|----------|
| `match`     | scale degree 5 (or the 3rd if pentatonic), a clear consonant "ding", pitch nudged up slightly per square (more squares = brighter) | mid-high | 0.5..0.7 by squares | "16n" |
| `rotate`    | root (degree 1)                              | mid               | 0.30     | "32n"    |
| `softDrop`  | degree 2                                     | low-mid           | 0.25     | "32n"    |
| `lock` (hard drop / settle) | degree 1 one octave DOWN     | low               | 0.30..0.45 by cause | "16n" |
| `move`      | SILENT                                        | —                 | —        | —        |
| `lineClear` (sweep CLEAR) | SILENT (explicit)              | —                 | —        | —        |
| `chain` (gem flood — a sweep-time clear) | SILENT (explicit) | —              | —        | —        |

Rationale: degrees drawn from the song key guarantee the tones never clash with the backing;
keeping `match` on a consonant high degree makes the most rewarding moment (staging a square)
the brightest sound; rotate/drop on root/low degrees are felt but recede; **silence on move, on
the sweep clear, AND on a chain** matches the owner's brief exactly. A `chain` is a gem flood at
sweep time — it CLEARS gems, and clearing makes no noise; only forming a MATCH dings. So `chain`
is silent in tone mode for the same reason `lineClear` is (Codex MEDIUM: chain tone consistency —
there is NO "chain arpeggio" in the tone palette). Heat is still fed by the chain (D1). The
sample mode keeps its existing recorded chain routing (`stage` + layered `drop`) unchanged.

**The match event (NEW) — where it is derived, and why NOT off `lastLock.id`.** A `match` = a 2x2
square NEWLY FORMED (staged for clear), NOT the sweep that erases it. The derivation must NOT be
gated on `lastLock.id`, because of a real-code fact: **`lastLock.id` is bumped ONLY in `lockPiece`
(the piece-settle merge — `piece.ts`, the single `lastLock: { id: …+1 }` write), and NOT by the
sweep or the gravity cascade.** Verified: `sweep.ts` and `chain-clear.ts` never touch `lastLock`.
So a square FORMED by a post-clear gravity CASCADE (cells fall and line up into a new square with
no piece lock) would advance no lock id — and a `lastLock.id`-gated deriver would emit NOTHING for
it, leaving a real, rewardable square silent. (This corrects the design's earlier false claim that
cascades bump `lastLock.id`.)

The correct, lock-independent derivation, in `events.ts`, off an additive render-only count:
- The controller projects a render-only `markedSquares: number` onto `RenderState` (and
  `PublicState`) equal to `computeMarked(grid).distinctSquares` — the count of distinct completed
  2x2 squares on the settled grid this frame. `computeMarked` already returns `distinctSquares`
  and `publicState` already exposes it, so this is a pure additive projection — render-only, zero
  determinism impact.
- The deriver emits `match` when `markedSquares` RISES versus the previous frame, on ANY frame —
  NOT gated on `lastLock.id`. `match` carries `squares = markedSquares − prevMarkedSquares` (the
  positive delta) for the velocity / brightness nudge.
- A DECREASE in `markedSquares` (squares erased by the sweep) emits NOTHING — the clear stays
  silent. So forming a square dings (whether by a piece lock OR a cascade settle); the sweep
  erasing it is silent; the two are fully decoupled and no longer share the lock-id path.

`AudioEvent` gains `{ type: "match"; squares: number }`; `sfxRouting.ts` routes `match` under
the selector (tone -> the match ding; sample -> the existing `stage` sample, preserving the
recorded path's clear-stage sound). The (silent) `lineClear`/`chain` SFX routing in `play()`
becomes: in `"tone"` mode the sweep clear AND the chain play NOTHING (heat is still fed); the
match ding is the audible reward. In `"sample"` mode behaviour is the current per-segment recorded
routing (chain keeps its `stage` + layered `drop`).

### D7. State migration inside the engine

`segmentScore`, `entryFloor`, `TIER_REVEAL_STEP`, `ADVANCE_THRESHOLD`, `ADVANCE_HEAT` (never
introduced — see D4), `TIER_ENTRY_FLOOR`'s use as a sticky floor, and `evaluateTier`'s
`revealed = floor(segmentScore/STEP)` are removed/rewired to heat.

`getAudioState()` adds `heat: number`. **The `segmentScore` alias is REMOVED entirely** — it is
NOT kept as a deprecated numeric alias. Leaving a numeric `segmentScore` would silently back the
old contract's zombie assertions (a test reading `segmentScore` would keep "passing" against a
derived number that no longer means anything), so it is dropped and every consumer is migrated to
`heat` (the e2e `AudioState` interface + assertions are updated from `segmentScore` to `heat` —
see tasks §5 and the stale-test rewrite in §3). `intensity` stays aliased to `heat` (it was always
a generic "how hot" alias, and that meaning is preserved).

Dev hooks (two DISTINCT hooks, up-path and down-path):
- `__injectClears(n)` banks `n` typical clears' worth of heat (the UP path), as today.
- `__stepBoundary()` runs the next loop boundary; on a step with no injected clear since the prior
  boundary it applies decay (so a plain `__stepBoundary` is the "empty pass" the engine sees).
- **`__decayPasses(n)` (NEW, DISTINCT)** steps `n` loop boundaries each of which is GUARANTEED to
  see `clearedSinceBoundary = false` (i.e. it forces the no-clear flag false before each boundary,
  so every one of the `n` steps decays heat). This is the deterministic DOWN-path driver for the
  e2e (build heat with `__injectClears` + `__stepBoundary`, then shed it with `__decayPasses`),
  kept separate from the UP-path `__injectClears` + `__stepBoundary` so the two paths can't be
  conflated.

`topHeldSinceBoundary` is retained for the single advance gate (D4).

Velocity parity NIT: in `sample` mode the `match` event reuses the existing
`stageVelocityForSquares(squares)` for its recorded-`stage` velocity, so the sample-mode match hit
keeps perceptual parity with the prior clear-stage routing (same squares→velocity curve); the
tone-mode match uses the D6 palette's `0.5..0.7 by squares` ding velocity.

## Risks / Trade-offs

- [Heat constants mis-tuned -> song fills too fast/slow] -> All constants are named and
  centralised; the strict-autoplay harness + Rai's ear-check are the final gate. The numbers are
  derived against the actual manifest tier counts and bar cadence (D1-D3) and are easy to retune.
- [Tier thrash on alternating clear/empty passes] -> Decay (0.08) is SMALLER than a typical clear
  gain (0.11), so an alternating clear→empty-pass→clear cycle nets slightly POSITIVE (+0.03) and
  never sheds a layer; a layer only drops under a SUSTAINED drought (~5 consecutive empty passes
  on song1, ~3-4 on song2). One-step-per-boundary (D3) further bounds any visible move to at most
  one tier per boundary, and the crossfade smooths it. (Promote/demote hysteresis is available as
  a further lever — D2 — but is not needed given the decay-below-gain margin.)
- [Carry-across re-introduces "vocals loop forever"] -> The advance gate (D4: top tier audible +
  `topHeldSinceBoundary`) still MANDATES advancing one loop after the top is held, per segment, so
  a topped-out segment always moves on; carry only removes the CUT, not the mandatory advance.
- [Tone synth constructed off-gesture -> autoplay block] -> Lazy construction inside unlock/first
  use, same discipline as the tier players; the strict-autoplay harness (`repro-autoplay.mjs`)
  asserts real RMS output and catches a regression.
- [No-vocal-cut not observable headlessly] -> Add an e2e assertion via the dev probe: build heat
  to the top tier, advance, assert the post-transition `tier` is >= the pre-transition `tier`
  (the carry-across observable). Mechanics are probe-verifiable; feel stays Rai's ear.
- [match double-counts or misses across cascades] -> The match delta is computed against the
  previous frame's `markedSquares` count (the render-only `computeMarked(grid).distinctSquares`
  projection), emitting only on a RISE — independent of `lastLock.id`. So a square formed by a
  piece lock OR by a post-clear gravity cascade (which does NOT bump `lastLock.id`) dings exactly
  once when the count rises; the sweep that erases marked squares LOWERS the count and emits
  nothing (clear is silent). It cannot double-count (only the positive delta fires) and cannot
  miss a cascade-formed square (the rise is observed regardless of any lock).

## Migration Plan

- Pure code change in `src/game/audio/**` + an additive render-only `markedSquares` projection in
  the controller + an optional `key` field on the manifest (default applied if absent, so the
  existing committed manifest works unchanged). No asset re-cut.
- Tests rewritten for the heat model; e2e gains the carry-across check; strict-autoplay + the
  production-start probe stay green.
- Rollback: revert the engine/events/sfxRouting/controller diff and drop the manifest `key`
  field; the recorded-sample path is preserved behind the selector, so even in production the SFX
  can be flipped to `"sample"` without a code change if the tones disappoint.
- Deploy via the normal `pnpm cf:deploy` after Rai's ear-check.

## Open Questions

- Final values for `HEAT_GAIN_*` and `HEAT_DECAY_PER_EMPTY_PASS` after Rai plays — the design
  picks defensible defaults; the ear is the arbiter. (There is no `ADVANCE_HEAT` — the advance is
  gated on the top tier being audible + held, not on a heat threshold; see D4.)
- Per-song authored `key` values. The engine default is `{ root: "A", scale: "minor" }`, but the
  FIRST ear-check will be on that DEFAULT key until per-song keys are authored in the manifest, so
  the manifest-key authoring step is sequenced BEFORE the tone ear-check (tasks §6) — Rai should
  hear the tones in the real per-song keys, not the placeholder, when he judges them.
- (Resolved, no longer open: `match` on a cascade-formed square. The derivation is keyed off the
  render-only `markedSquares` count RISING, NOT off `lastLock.id` — which is bumped only by a
  piece lock, never by a cascade — so a cascade-formed square is covered by construction. See D6.)
