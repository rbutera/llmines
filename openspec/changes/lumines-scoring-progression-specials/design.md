## Context

Proposal A fixes the sweep so squares clear on the covering pass with incremental per-column settle and beat-derived timing. This change adds the depth on top. The relevant current code:

- `core/sweep.ts` scores `passScore(pass) = pass.deletedCount * pass.distinctSquares` — not the Lumines rule.
- `core/piece.ts` `nextPiece(rngState)` draws 4 colour bits via `nextBit` and returns a piece; spawn draws one piece on demand (`spawnNext`). No preview queue, no specials.
- `core/rng.ts` provides `nextFloat`/`nextBit` over the single in-state `rngState` (mulberry32). RNG state lives in `GameState` and is advanced functionally — already seedable.
- `core/detect.ts` `computeMarked` gives `distinctSquares` and the marked union.
- `core/types.ts` `GameState` has no `combo`, `queue`, `skinIndex`, or `specials`; `index.ts` `publicState` projects `{grid, score, gameOver, sweepX}`.
- `constants.ts` has a single `BPM = 120`; `engine/controller.ts` converts time to columns (proposal A) using BPM.

The `[VERIFY]` rule values from the research are **decided here** so tests are stable: combo curve 4/8/12/16 (cap 16); single-colour/all-clear bonus 1,000/10,000 (configurable); chain activation = must-be-in-square (PSP-faithful); special rate ~1/30 per-piece probability; skin advance = squares-cleared threshold.

## Goals / Non-Goals

**Goals:**
- Replace the score formula with the faithful rule (40/square, 4/8/12/16 combo, soft-drop +1/row, single-colour/all-clear bonuses), integer-only, banked per pass.
- Add seedable chain specials with a flood-fill clear that shares the sweep's single deterministic delete/score step; flooded extras score nothing.
- Add a next-3 preview queue that preserves seeded reproducibility via a canonical RNG draw order.
- Model progression as skin/BPM data driving sweep speed via proposal A's conversion, advancing on a deterministic squares-cleared threshold.
- Keep one RNG stream, determinism, and the `window.__lumines` seam intact; grow `state()` additively.

**Non-Goals:**
- Audio: stems, one-shots, SFX palettes, the audio half of a skin bundle — proposal C.
- AI-generated skins — proposal D.
- Any change to the sweep ordering / incremental settle / timing fixed in proposal A.

## Decisions

### Decision 1: Faithful scoring formula (replace `deletedCount * distinctSquares`)

`score = squares_in_pass * 40`, where `squares_in_pass` is the count of distinct snapshot squares actually cleared this pass (NOT incidental flood-fill cells). A pass clearing `>= 4` squares applies a multiplier from a fixed curve; consecutive qualifying passes escalate it; a `< 4` pass resets it.

```
GameState.combo: number            // consecutive qualifying-pass count (0 = none)
const COMBO_CURVE = [4, 8, 12, 16] // index by min(combo, last); cap 16
passScore(pass, combo):
  squares = pass.distinctSquares           // snapshot squares cleared (not chain extras)
  base = squares * 40
  mult = squares >= 4 ? COMBO_CURVE[min(combo, COMBO_CURVE.length-1)] : 1
  return base * mult
// after a pass: combo = squares >= 4 ? combo + 1 : 0
```

Soft-drop adds `+1` per descended row (the controller/soft-drop path already steps rows; add the score). Single-colour bonus (default 1,000) when the settled field is reduced to one colour; all-clear bonus (default 10,000) when the board has no locked cells — both checked on the settled grid after each pass. All values integer; no floats enter the score.

**Why the curve is pinned 4/8/12/16:** the research flags the exact ramp as `[VERIFY]`; pinning one deterministic curve makes the combo tests stable. Bonus values are configurable constants so they are easy to tune without spec churn.

**Alternative considered — score per deleted cell:** rejected; that is the current wrong rule and ignores the square-staging skill the game rewards.

### Decision 2: Combo and bonuses are state, banked at the pass boundary

`combo` lives in `GameState` (deterministic + inspectable). Scoring banks at pass completion (the boundary proposal A preserves). Flood-fill extras (Decision 4) are excluded from `squares_in_pass`, so a chain clear does not inflate the multiplier.

### Decision 3: Specials decided at generation time, off the single RNG, in canonical order

Generation rolls the special when the piece is generated (so the preview can show it), using one extra draw off the same `rngState`. The canonical per-piece draw order is pinned: **4 colour bits, then 1 special roll (`nextFloat < SPECIAL_RATE`, default 1/30), then if special 1 cell-index pick.** This order is the contract that keeps a seeded run identical whether or not preview/specials are enabled.

```
// GeneratedPiece = { cells: Piece, special?: { cellIndex: 0|1|2|3 } }
generateNext(rngState):
  [s1, piece] = nextPieceCells(rngState)     // 4 colour bits (existing order)
  [s2, r] = nextFloat(s1)
  special = r < SPECIAL_RATE ? pickCell(s2) : undefined   // pickCell draws once more if special
  return [finalState, { cells: piece, special }]
```

**Why one stream, this order:** §5 of the spike — never add a second RNG; document the order once. A second RNG or a different order would make seeded reproducibility (and the eval) fragile.

### Decision 4: Chain flood-fill shares the sweep's single delete/score step

A chain cell is tracked as a coordinate carrying a chain marker (`GameState.specials: Set<row*COLS+col>`), separate from the cell colour. Activation precondition: the chain cell must be **part of a completed (marked) square** that the sweep clears (PSP-faithful). When such a square is cleared, the same clear step also removes every same-colour cell **orthogonally connected** (4-connected BFS/DFS) to the chain cell. The flood may reach cells in columns ahead of the bar — those vanish immediately (the chain overrides the left-to-right order for connected cells). Two chain cells in one connected region resolve as one flood fill (shared visited set). Flooded extras clear but contribute **zero** to `squares_in_pass`.

```
// inside the sweep's delete step, when a cleared square contains a special coord:
comp = floodFill(grid, specialCoord, sameColour)   // 4-connected, visited set
deleteAll(grid, comp)                               // no square-score for these
```

Flood-fill is order-independent in result (it is the connected component); the visited set only prevents double-counting. The settle (incremental, proposal A) then runs on the post-flood grid.

**Why must-be-in-square:** research `[VERIFY]` between Remastered (touch-one-neighbour) and Live!/PSP (must-be-in-square); the spike recommends PSP fidelity. Pinning it makes activation deterministic and testable.

### Decision 5: Next-3 preview is a pre-generated queue

Replace draw-one-on-spawn with a queue kept at depth `PREVIEW_DEPTH + 1` (3 + 1). `refillQueue` advances `rngState` via `generateNext` (Decision 3 order); `spawnFromQueue` shifts the head and refills. The queue contents are deterministic for a seed, and because they draw in the canonical order, a run is identical with or without the preview existing.

### Decision 6: Progression is skin/BPM data driving the sweep, advancing on squares cleared

```
Skin = { id, blockPalette, visualTheme, bpm, timeSignature }   // audio fields added in proposal C
GameState.skinIndex: number
GameState.clearsInSkin: number
advanceSkinIfDue(state): if clearsInSkin >= SKIN_ADVANCE_THRESHOLD: skinIndex++; clearsInSkin = 0
// controller: bpm = SKINS[state.skinIndex].bpm  → feeds proposal A's time→columns conversion
```

Changing skin changes BPM, which changes sweep speed (faster BPM = more columns/sec). Switching BPM mid-pass SHALL NOT jump the bar: recompute the target from the new BPM at the next bar boundary, not instantly. Advancement trigger is a squares-cleared threshold (deterministic and testable) rather than wall-clock time. At least 2-3 skins ship. Palette/visual swap is render-only.

**Why squares-cleared, not time:** research `[VERIFY]` on the trigger; a squares-cleared threshold is deterministic, so a seeded run advances skins reproducibly (testable). The audio half (track stems + SFX palette) waits for proposal C; the schema is shaped to receive it.

## Risks / Trade-offs

- **Determinism regression from a second RNG or reordered draws** → The single highest risk. Mitigation: one stream only; canonical order pinned in the spec; a test asserts identical seeded queues/specials with preview/specials toggled.
- **Flood-fill double-counting / non-determinism** → Mitigation: visited set; assert the result is the connected component regardless of traversal order; assert flooded extras score zero.
- **Combo multiplier inflated by chain extras** → Mitigation: `squares_in_pass` counts snapshot squares only; explicit test that a chain clear does not bump the combo via its extras.
- **Skin BPM change jumping the bar mid-pass** → Mitigation: recompute target at the next bar boundary; test that a mid-pass BPM change does not discontinuously move `sweepX`.
- **Float drift in score** → Mitigation: integer-only scoring (40, x4/x8/x12/x16, +1/row, flat bonuses); no floats enter the asserted score.

## Migration Plan

In-place, additive to state. New core modules (`scoring.ts`, `chain.ts`, `skins.ts`); `GameState` gains `combo`, `queue`, `skinIndex`, `clearsInSkin`, `specials`; `publicState` projects the new inspectable fields. The scoring formula swap is a localized change to `passScore`/the pass-complete step. Rollback = restore `passScore = deletedCount * distinctSquares`, drop the new modules and state fields, and revert spawn to `spawnNext`.

## Open Questions

- All `[VERIFY]` rule values are decided in this design (combo 4/8/12/16; bonuses 1,000/10,000 configurable; activation must-be-in-square; rate 1/30 per-piece; skin advance = squares-cleared threshold). These are latitude per the rubric; the spec pins one deterministic value each so tests are stable. No remaining blocker.
