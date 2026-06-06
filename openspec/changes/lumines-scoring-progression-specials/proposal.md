## Why

Once the sweep plays correctly (proposal A `lumines-grid-and-sweep`), the game still lacks the depth that makes Lumines compelling: a faithful score that rewards staging big multi-square harvests, the chain special block that lets a player rescue a near-topped-out board, the three-piece preview that drives colour-staging strategy, and skin-driven tempo progression. Worse, our current scoring is simply wrong: `core/sweep.ts` computes `passScore = deletedCount * distinctSquares`, which is not the Lumines rule and does not reward 4+-square passes or cross-pass combos. This change replaces the scoring formula with the real rule (base 40/square, 4/8/12/16 combo curve, soft-drop +1/row, single-colour/all-clear bonuses), adds seedable chain special blocks with flood-fill clears sharing the deterministic delete/score step, adds a next-block preview queue, and models progression as skin/BPM data. All randomness draws from the single in-state RNG in one documented canonical order so seeded runs stay reproducible.

## What Changes

- **Correct scoring (replaces `deletedCount * distinctSquares`):** score = `squares_in_pass x 40`, where `squares_in_pass` is the count of distinct snapshot squares actually cleared this pass. A single pass clearing **>= 4 squares** applies a multiplier; **consecutive** qualifying passes escalate the multiplier on a documented deterministic curve **4 / 8 / 12 / 16** (cap 16), reset to x1 on any pass clearing < 4. Soft-drop awards **+1 per row** descended. A **single-colour bonus** (field reduced to one colour, default 1,000) and an **all-clear bonus** (board emptied of locked cells, default 10,000) are awarded. All scoring is integer-only.
- **Combo state in `GameState`:** add a `combo` counter (consecutive qualifying-pass count) so the multiplier curve is deterministic and inspectable; expose `combo` on the test `state()`.
- **Chain special blocks (seedable):** the generator occasionally emits a chain special at a target rate ~**1 per 30 pieces**, decided at generation time (a single deterministic draw off the existing in-state RNG) so it appears in the preview. When a chain cell is part of a cleared square, the clear also removes **every same-colour cell orthogonally connected** to it (4-connected flood fill), sharing the same deterministic delete/score step the sweep triggers. Flooded-in extras clear but **do not add to the square score**. Activation precondition: **must be part of a completed square** (PSP-faithful).
- **Next-3 preview queue:** replace draw-one-on-spawn with a pre-generated queue (depth 3) so the preview is truthful; the queue draws in the canonical RNG order so a seeded run is identical with or without preview/specials enabled. The preview shows an upcoming special if one is in the queue.
- **Skin / BPM-driven progression:** model progression as an ordered list of skins, each `{ id, blockPalette, visualTheme, bpm, timeSignature }`; advancing to the next skin changes the BPM and therefore the sweep speed (via proposal A's time->columns conversion). Advancement trigger: a **squares-cleared threshold** (deterministic, testable). At least 2-3 skins ship to demonstrate the transition. The audio half of skins (track stems + SFX) is deferred to proposal C.
- Preserve determinism (one RNG stream, canonical draw order) and the `window.__lumines` test seam as explicit requirements; `state()` grows additively (`combo`, `queue`, `skinIndex`/BPM, `specials`).

## Capabilities

### New Capabilities
- `scoring`: The faithful Lumines score — base 40/square, a 4/8/12/16 cross-pass combo curve with reset, soft-drop +1/row, single-colour and all-clear bonuses, integer-only, banked per pass — replacing the current `deletedCount * distinctSquares` rule.
- `special-blocks`: Seedable chain special blocks (~1/30 pieces, decided at generation time off the single in-state RNG) whose flood-fill clear removes all same-colour orthogonally-connected cells when the chain cell is part of a cleared square, sharing the sweep's deterministic delete/score step, with flooded extras scoring nothing.
- `preview-queue`: A pre-generated next-3 piece preview queue that draws in the canonical RNG order so seeded runs are reproducible with or without preview, and surfaces upcoming specials.
- `skin-progression`: Progression modelled as ordered skin data carrying BPM (and palette/visual theme) that drives sweep speed via the timeline conversion, advancing on a deterministic squares-cleared threshold.

### Modified Capabilities
<!-- None as openspec/specs deltas: openspec/specs/ is empty. The scoring formula
     currently lives in code (core/sweep.ts passScore) with no captured spec, so it
     is introduced here as a new `scoring` capability rather than a MODIFIED delta. -->

## Impact

- **Code**: `src/game/core/sweep.ts` (replace `passScore`; thread `combo`; share the delete/score step with flood-fill); new `src/game/core/scoring.ts` (curve + bonus helpers, integer-only); new `src/game/core/chain.ts` (4-connected flood fill); `src/game/core/piece.ts` (generation rolls the special in canonical order); `src/game/core/types.ts` + `index.ts` (add `combo`, `queue`, `skinIndex`, `specials` to state + public projection); new `src/game/core/skins.ts` (declarative skin list); `src/game/engine/controller.ts` (BPM from current skin feeds the time->columns conversion; spawn from queue); `src/game/test-api/install.ts` (expose new state additively); `src/game/react/GameShell.tsx` / render layer (preview panel, palette swap — render-only).
- **Depends on**: proposal A (`lumines-grid-and-sweep`) for the pass boundary, incremental settle, and the time->columns conversion. The audio half of skins depends on the future proposal C.
- **Determinism**: one RNG stream only; canonical per-piece draw order pinned (4 colour bits, then 1 special roll, then if special 1 cell-index pick); flood fill order-independent in result (visited set avoids double-count); scoring integer-only.
- **No impact** on: the `core/**` purity boundary, the existing `window.__lumines` method set (only `state()` grows), or the grid/detection/sweep-ordering behaviour fixed in proposal A.
