## 1. Faithful scoring formula (replace deletedCount * distinctSquares)

- [ ] 1.1 Create `src/game/core/scoring.ts` with `COMBO_CURVE = [4, 8, 12, 16]`, a `passScore(squares, combo)` (`squares * 40 * (squares >= 4 ? curve[min(combo, last)] : 1)`), and configurable `SINGLE_COLOUR_BONUS = 1000` / `ALL_CLEAR_BONUS = 10000` constants. Integer-only.
- [ ] 1.2 In `src/game/core/types.ts`, add `combo: number` to `GameState`.
- [ ] 1.3 In `src/game/core/sweep.ts`, replace `passScore = deletedCount * distinctSquares` with the new `passScore(pass.distinctSquares, state.combo)`; after each pass set `combo = distinctSquares >= 4 ? combo + 1 : 0`.
- [ ] 1.4 Add board-state bonus checks on the settled grid after each pass: single-colour bonus when the field is one colour; all-clear bonus when no locked cells remain.
- [ ] 1.5 Add soft-drop +1/row in the soft-drop path (`engine/controller.ts` and/or `core/piece.ts` softDrop), scoring per descended row.
- [ ] 1.6 Expose `combo` additively on `publicState` (`core/index.ts`) and the test-api type (`test-api/install.ts`).

## 2. Scoring tests

- [ ] 2.1 Construct boards clearing exactly 3, 4, 5 squares in a pass; assert score deltas and that the 4+ multiplier applies only at >= 4.
- [ ] 2.2 Drive consecutive 4+ passes; assert the curve `40 * 4 * {4, 8, 12, 16}` and the 16x cap.
- [ ] 2.3 Combo reset: a < 4 pass between two 4+ passes resets to x4.
- [ ] 2.4 Soft-drop N rows -> +N. Single-colour board -> +1000. All-clear board -> +10000.
- [ ] 2.5 Assert score is always an integer (no floats).

## 3. Chain special blocks (generation, canonical RNG order)

- [ ] 3.1 In `src/game/core/types.ts`, add `specials: Set<number>` (coords `row*COLS+col`) to `GameState` and a `GeneratedPiece = { cells: Piece, special?: { cellIndex } }` shape.
- [ ] 3.2 In `src/game/core/piece.ts`, add `generateNext(rngState)` drawing in the canonical order: 4 colour bits (existing), then `nextFloat` special roll (`< SPECIAL_RATE`, default 1/30), then if special one more draw to pick the cell index. Document the order.
- [ ] 3.3 On lock, record any chain cell coordinate into `state.specials`.

## 4. Chain flood-fill clear (shares the sweep delete/score step)

- [ ] 4.1 Create `src/game/core/chain.ts` with a 4-connected `floodFill(grid, coord, colour)` returning the connected same-colour component (visited set, order-independent result).
- [ ] 4.2 In `src/game/core/sweep.ts`, in the per-column delete step, when a cleared square contains a `specials` coord, flood-fill the connected same-colour region and delete it in the same step; exclude flooded extras from `distinctSquares`/score.
- [ ] 4.3 Activation precondition: chain fires only when its cell is part of a cleared square (must-be-in-square). Ensure the post-flood grid is settled per-column (proposal A settle).

## 5. Special tests

- [ ] 5.1 Long seeded run -> specials appear at ~1/30 and at the same piece indices on repeat (deterministic).
- [ ] 5.2 Contrived board: chain cell inside a mono square with a long same-colour tail -> `sweepNow`/sweep -> whole connected region cleared; score counts only the square(s), not the tail.
- [ ] 5.3 Chain NOT in a square -> no flood. Two chain cells in one region -> single flood (no double-count). Flood reaches ahead of the bar -> those cells cleared immediately.
- [ ] 5.4 Same seed -> identical special positions; specials-enabled vs -disabled keep identical colour draws (canonical order).
- [ ] 5.5 Expose `specials` additively on `publicState` + test-api type.

## 6. Next-3 preview queue

- [ ] 6.1 In `src/game/core/types.ts`, add `queue: GeneratedPiece[]` to `GameState`; set `PREVIEW_DEPTH = 3`.
- [ ] 6.2 In `src/game/core/piece.ts`, add `refillQueue` (keep length >= PREVIEW_DEPTH + 1 via `generateNext`) and `spawnFromQueue` (shift head, refill, place at spawn); replace `spawnNext` usage in the controller with the queue path.
- [ ] 6.3 Expose `queue` additively on `publicState` + test-api type; render the 3-piece preview (render-only, e.g. `react/GameShell.tsx`), surfacing an upcoming special.

## 7. Preview tests

- [ ] 7.1 Same seed -> identical queue piece-for-piece.
- [ ] 7.2 Preview enabled vs single-draw baseline (same canonical order) -> identical spawned sequence.
- [ ] 7.3 A queued special is reflected in the preview before it spawns.

## 8. Skin / BPM progression

- [ ] 8.1 Create `src/game/core/skins.ts` with an ordered list of >= 2-3 skins `{ id, blockPalette, visualTheme, bpm, timeSignature }`.
- [ ] 8.2 In `src/game/core/types.ts`, add `skinIndex: number` and `clearsInSkin: number`; add `advanceSkinIfDue` (advance when `clearsInSkin >= SKIN_ADVANCE_THRESHOLD`, reset counter).
- [ ] 8.3 In `engine/controller.ts`, source BPM from `SKINS[state.skinIndex].bpm` into the time->columns conversion (proposal A); apply a BPM change only from the next bar boundary so the bar does not jump mid-pass.
- [ ] 8.4 Expose `skinIndex` and active BPM additively on `publicState` + test-api type; swap palette/visual theme in render (render-only).

## 9. Skin tests

- [ ] 9.1 Set skin index -> assert sweep cols/sec matches the skin BPM (via FakeClock).
- [ ] 9.2 Cross the squares-cleared threshold -> assert `skinIndex` advanced and the per-skin counter reset.
- [ ] 9.3 Same seed/inputs -> skins advance at the same points (deterministic).
- [ ] 9.4 Mid-pass BPM change -> `sweepX` does not discontinuously jump.

## 10. Determinism + seam guard

- [ ] 10.1 Assert exactly one RNG stream is used (no `Math.random`, no second seed) across scoring/specials/queue/skins.
- [ ] 10.2 Assert the canonical per-piece draw order is honoured and documented.
- [ ] 10.3 Assert `window.__lumines` method set is unchanged and `state()` grew only additively (`combo`, `queue`, `skinIndex`/BPM, `specials`).

## 11. Verify

- [ ] 11.1 Run the unit suite — all green.
- [ ] 11.2 Run lint/typecheck — no new warnings.
- [ ] 11.3 Manually run a normal build: confirm the 3-piece preview, a chain special clearing a connected region, the combo curve on consecutive big passes, and a skin/BPM change speeding the sweep.
