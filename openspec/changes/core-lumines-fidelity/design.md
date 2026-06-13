## Context

LLMines is a Lumines clone with a strict layer split: `src/game/core/**` is a pure,
time-free, fully unit-testable game core; `src/game/engine/controller.ts` owns the single
`GameState`, all wall-clock timing, and projects a render-only `RenderState` for React/Pixi.
The audio engine (`src/game/audio/**`) is downstream and currently infers clears from score
deltas (audit B1) — a separate `audio-truth` change will consume the telemetry this change
emits, so the field shapes here are a contract, not throwaway.

The README §3b "Verified Lumines mechanics reference" is the implementation ground truth, and
the "Root-cause audit" (A1-A8, D1-D5) pins exactly where the deployed code diverges. The
current core is faithful in skeleton (pure functions, identity-based marks, deferred per-column
settle, faithful `passScore`) but wrong in six player-felt ways:

- **A1** `hardDrop` (`piece.ts:393-408`) rebuilds the active piece without `special` on each
  descent step, so a gem hard-dropped (the common case) locks as a plain block. Move/rotate/
  gravity already carry it; hard drop was missed.
- **A2/D2** `startPass` (`sweep.ts:24-29`) snapshots the marked set ONCE when the bar wraps to
  column 0. A square completed mid-pass ahead of the bar is invisible to the current pass and
  waits a full extra traversal. Real Lumines marks as the leading edge reaches each column.
- **A3/D2** `processColumn` (`sweep.ts:97-115`) deletes + settles each marked column the instant
  the edge crosses it. Real Lumines erases a contiguous marked GROUP as one batch when the bar
  reaches a gap (a column with no marks) or the right edge, then settles once.
- **A4** Fixed seed: `createGame(seed = 1)` (`grid.ts:18`) + `controller.restart(1)`. Every run
  deals identical pieces.
- **A5/D4** `SPAWN_ROW = 0` (`constants.ts:18`): pieces spawn inside the visible field, forfeiting
  the top two rows and ending games prematurely. Real Lumines stages pieces above the field.
- **A7/D1** No single-sweep ×4 package: 4+ squares in one pass must score 640 (+160 each beyond),
  the core risk/reward of Lumines. `passScore` currently only applies the cross-pass `COMBO_CURVE`.
- **A8** No replay record. A8 notes seed + input log = a full deterministic replay (the core is
  already a pure function of (state, inputs), so this is cheap once the seed is real).

A6 (sweep-BPM vs music-BPM coupling) and D3 (difficulty curve) are explicitly **out of scope**
here (they entangle the core-skin vs host-skin unification and the audio engine). This change is
the pure-core fidelity pass; the audio coupling is a follow-up.

## Goals / Non-Goals

**Goals:**
- Hard drop preserves the gem (A1).
- Mark-as-the-bar-passes sweep: squares completed ahead of the bar clear on the CURRENT pass (A2).
- Per-group batch erase with deferred gravity; chain floods fire at group-erase time (A3).
- Faithful Challenge scoring: 1-3 squares = 40 each; 4+ = 640 + 160/extra; awarded at the right
  edge; retain the cross-pass streak multiplier as a documented Lumines II+ house mechanic layered
  on top; retain soft-drop +1/cell on lock and board-state bonuses as house bonuses (A7/D1).
- Pieces spawn above the visible field; game over only when a piece cannot enter (A5/D4).
- Per-game crypto random seed, surfaced in RenderState + game-over (A4).
- Replay record `{seed, schemaVersion, inputs:[{t, action}]}` exposed on game over (A8).
- Clear/lock telemetry in RenderState (pass-completion event + lock event) for the audio layer.
- Rewrite the stale core tests to the new semantics (not skip).

**Non-Goals:**
- A6 sweep/music BPM coupling and the core-skin vs host-skin unification — deferred.
- D3 difficulty/BPM curve redesign — deferred (depends on A6).
- Any audio-engine change (`src/game/audio/**`), SFX rework (B3-B6), or skin/UI changes (C, README
  "Known Issues" UI/auth items). This change only *emits* telemetry; consuming it is `audio-truth`.
- Burst (Arise), additional modes, leaderboard.

## Decisions

### D1 — Mark-as-the-bar-passes (A2): incremental detection against the live grid

**Decision.** Replace the once-at-pass-start snapshot with incremental marking. As the bar's
leading edge reaches each column, detect completed squares against the **current settled grid**
and set marks for any newly-completed square cells whose columns have not yet been passed. Squares
formed mid-pass ahead of the bar are therefore picked up when the edge reaches them and clear on
the current pass.

**Mechanism.** Keep `SweepPass.marks` (the identity-based boolean grid) and the mark-aware settle
(`settleColumnWithMarks`) — that machinery is correct and must stay (marks travel with cells
through settles). Change only *when* marks get set: instead of one `computeMarked` at `startPass`,
re-run square detection incrementally as columns are crossed. Concretely, `sweep.ts` gains a
`markColumn(grid, marks, col)` step that, for each column `c` the edge newly crosses, scans the 2×2
windows whose **top-left (anchor) column is `c`** and sets marks for all four cells of any
all-same-colour square (the right column `c+1`'s cells are marked ahead of the bar — legal, they
extend the contiguous run when the edge reaches them). `computeMarked` in `detect.ts` already does
the corner-anchored 2×2 scan; factor its per-window test into a reusable predicate so `markColumn`
can ask "is the square with top-left (r,c) complete?" without re-scanning the whole grid.

**Marking rule (pinned, self-consistent):** a square is marked if and only if it is complete at the
moment the leading edge reaches its LEFT (anchor) column. A square whose left column was already
passed before it completed waits for the next pass (consistent with the refuted-claims note in §3b:
a square forming while the bar is mid-square does NOT get partially cleared). No cell in an
already-passed-and-erased column is ever re-marked.

`distinctSquares` is no longer a pass-start constant — it accumulates as squares are marked during
the pass (used for scoring at the right edge, see D3). The square count is *distinct corners marked
this pass*, deduped (a square that was already marked earlier in the pass is not recounted).

**Alternative considered.** Keep the snapshot but re-snapshot every column — rejected: it loses the
identity-based marks discipline (re-deriving marks per column can re-mark a stale row that a settle
refilled) and duplicates detection work. Incremental marking against the live grid with a
per-window predicate is both faithful and cheap (the field is 16×10).

### D2 — Per-group batch erase + deferred gravity (A3)

**Decision.** Erase marked cells as a **contiguous-group batch**, not per column. As the edge
crosses columns it only *marks* (D1) — it does not delete. Erasure fires when the bar reaches a
**gap** (a column with no marked cells in it) or the **right edge**: at that moment, every marked
cell in the contiguous run of columns just completed is erased in one batch, then gravity settles
**once** (only the affected columns). Chain (gem) floods activate at this group-erase moment.

**Mechanism.** `sweep.ts` tracks the current contiguous marked run. Walking column `col` as the
edge crosses it:
1. `markColumn(grid, marks, col)` (D1) — set marks for squares now complete at/behind `col`.
2. If column `col` has at least one mark, it extends the current run.
3. If column `col` has NO marks (a gap) OR `col` is the last column, the current run *ends*: call
   a new `eraseGroup(grid, pass, runCols, specials, record)` that deletes every marked cell across
   `runCols`, activating chain floods (`chainFlood`) for any special in the batch, then settles the
   touched columns once via `settleColumnWithMarks`. Reset the run.

This replaces `processColumn`'s delete-and-settle-per-column. `deleteColumn` is generalised to
`eraseGroup` (a span of columns). The existing `chainFlood` call, the `specials` set maintenance,
and the `ChainClearRecord` record sink all move into `eraseGroup` unchanged in behaviour — only the
*granularity* (a group, not a single column) changes. Chain floods reaching ahead of the bar still
clear those cells and their marks (identity-based marks already handle the cross-column settle).

**Cascade timing.** After a group erase + settle, new squares may form (the post-settle stack).
Per the reference (§3b item 4: "cascades resolve on later passes"), those are picked up by D1's
incremental marking **when the bar later reaches their columns on the current pass if they are
behind the unpassed edge, otherwise on the next pass.** Because erasure happens at a gap/right-edge
and the edge keeps moving right, a cascade that forms behind the just-erased group (to its left, all
already passed) is harvested on the **next** pass (`startPass`/its incremental equivalent re-detects
from column 0); a cascade forming under unpassed columns is marked when the edge reaches them. This
is faithful and avoids infinite same-pass cascade loops.

**`runFullSweep`** (the test/`sweepNow` path) is rewritten to the same group-batch model: mark all
columns, erase contiguous groups, settle once per group.

**Alternative considered.** Erase the whole pass's marks at the right edge only (one batch per
pass) — rejected: the reference is explicit that erasure fires per contiguous group at a gap, and
grouping affects chain-flood timing and the visible "groups pop together" feel.

### D3 — Faithful scoring + retained house mechanics (A7/D1)

**Decision.** Rewrite `passScore` to the faithful base, then layer the existing cross-pass streak
multiplier and board-state bonuses on top as documented house mechanics.

**Base package (faithful, README §3b item 5).** For `squares` distinct squares cleared in a pass:
- `squares` in 1..3 → `squares * 40` (40 / 80 / 120).
- `squares >= 4` → `640 + (squares - 4) * 160` (4 = 640, 5 = 800, 6 = 960).

New constants in `constants.ts`: `BIG_CLEAR_THRESHOLD = 4`, `BIG_CLEAR_BASE = 640`,
`BIG_CLEAR_STEP = 160` (keep `SQUARE_BASE_SCORE = 40`). `COMBO_MIN_SQUARES` stays 4.

**Streak multiplier (Lumines II+ house mechanic, retained — values CORRECTED).** A pass that clears
≥4 squares (qualifying) escalates `combo`; a pass clearing <4 resets it to 0. **The big-clear
package already contains the single-sweep ×4** (`640 + 160(n-4) ≡ 40n × 4` for n ≥ 4), so the curve
applied ON TOP of the package must be `STREAK_CURVE = [1, 2, 3, 4]` — NOT the old `[4,8,12,16]`,
which would double-count the ×4 and pay a first qualifying pass 2560 instead of 640. This exactly
matches the research (§3b item 6): streak labels 1×/2×/3×/4× ≈ ×4/×8/×12/×16 over the LINEAR 40/sq
base ≡ ×1/×2/×3/×4 over the package.
`passScore(squares, combo) = package(squares) * (qualifies ? STREAK_CURVE[min(combo, 3)] : 1)`,
so consecutive qualifying passes pay 640 → 1280 → 1920 → 2560 (for 4-square passes). `COMBO_CURVE`
in `constants.ts` is replaced by `STREAK_CURVE = [1,2,3,4]`; `COMBO_MIN_SQUARES = 4` stays. The
README sanctions the streak as a sequel mechanic provided the base ×4 exists; the design records it
as deliberate, not faithful-base.

**Award timing.** Unchanged: deferred to the right edge (pass completion). With D2, erasure happens
mid-pass at gaps, but *scoring* is still banked once when `sweepX` reaches the right edge, using the
accumulated `distinctSquares` for the pass.

**Soft drop / hard drop (faithful).** Soft drop stays +1/cell, accrued in `softDropBonus` and banked
on lock (`piece.ts` `softDrop`/`lockPiece` — already correct). Hard drop awards no drop points
(already correct).

**Board-state bonuses (house, retained + documented).** `SINGLE_COLOUR_BONUS = 1000`,
`ALL_CLEAR_BONUS = 10000` stay, assessed only when a clear happened this pass (already correct).
The spec marks these explicitly as house bonuses, not Lumines-faithful values.

**Alternative considered.** Drop the streak multiplier to be purely faithful — rejected: Rai's
design keeps it, and the reference blesses it as a sequel mechanic provided the base ×4 exists.

### D4 — Spawn staging above the field (A5/D4)

**Decision.** Stage pieces in **virtual rows above row 0** (rows -2 / -1), descending into the
visible 16×10. Game over only when the piece cannot enter the field (its target cells in the
visible field are blocked). Do **not** extend the grid array — use virtual negative spawn coords
plus a relaxed `canPlace` that treats above-field rows as always free. This is the least-blast-
radius choice: the grid stays 16×10, `settle`/detection/sweep are untouched, and only the spawn/
placement/game-over/render path changes.

**Mechanism.**
- `SPAWN_ROW = -2` (top of the 2×2 at row -2, bottom at row -1 — fully above the field).
- `canPlace` (`piece.ts:157-166`) already tolerates `row < 0` (its comment says so) and only checks
  occupancy for `row >= 0`. Verify and keep: a cell at row < 0 is never "occupied", a cell at
  `row >= ROWS` is out of bounds (false). This already supports above-field staging — the only bug
  is `SPAWN_ROW` sitting at 0.
- **Game over** must test "can the piece *enter the field*", not "can it sit at the spawn row".
  A piece spawned at row -2 always "places" (its cells are above the field). The real top-out
  condition is: after spawning above and descending, the piece **cannot reach any in-field row** —
  i.e. the entry columns are blocked up to the top of the field. Define game over as: `canPlace`
  fails for the piece at the **first in-field row it would occupy** (row 0 top → cells at rows 0,1
  in the spawn columns). So game-over detection moves from "spawn cells occupied" to "the cells at
  rows 0-1 in the spawn columns are occupied" — exactly README §3b item 1 ("game over = blocks pile
  to the top").
- `pieceCells`/`viewGrid`/`inBounds`: `pieceCells` returns rows that may be negative; `viewGrid`
  composites only `inBounds` cells (already guards row >= 0), so above-field cells are simply not
  drawn in the board grid. The renderer draws the active piece separately (the controller already
  passes `active` through RenderState), so the descending piece is visible above the field via the
  active-piece overlay if the renderer chooses to show staging — but the **board grid projection is
  unchanged**, keeping renderer blast radius nil. The active piece's negative-row cells render in
  the staging area only if the renderer extends its draw box; if not, the piece visually "drops in"
  from the top edge, which is acceptable and matches the current feel.
- Hold window / gravity: a piece spawned at row -2 descends under normal gravity into the field;
  the spawn-hold (`HOLD_MS`) still applies. No timing change.
- **Lock-above-field = game over (closes the lateral-shift hole).** A piece staged above the field
  can be moved sideways over a full-height column; it then cannot descend (`canDescend` false) and
  would lock with cells at negative rows — which `lockPiece` currently DISCARDS silently (merges
  only `inBounds` cells), losing blocks with no game over. Rule: if a lock would leave ANY of the
  piece's cells above row 0, the lock IS the top-out — set `gameOver` (merging the in-field cells
  is acceptable; the above-field cells are the "pile to the top"). `lockPiece` gains this check.
  This is the faithful "blocks pile to the top" condition for mid-air locks, complementing the
  spawn-time entry check.

**Alternative considered.** Extend the grid to 12 rows with the top 2 as hidden staging — rejected:
it ripples into `ROWS`, detection bounds, sweep height, `settle`, every test that hard-codes 10
rows, and the `BOARD_ASPECT`. Virtual negative coords keep the change surgical.

### D5 — Gem through hard drop (A1)

**Decision.** Carry `active.special` through the `hardDrop` descent loop, exactly as `movePiece`,
`rotateCW`, and `gravityStep` already do. One-line-class fix: each rebuilt `active` in the loop
keeps `special: active.special`. Add a regression scenario (gem hard-dropped → settled cell is in
`specials`).

### D6 — Per-game crypto seed (A4)

**Decision.** `createGame()` takes an optional seed; production passes a fresh random seed derived
from `crypto.getRandomValues` (fallback to `Date.now()` when crypto is unavailable, e.g. older SSR
contexts). The seed is stored on `GameState` so it can be surfaced and replayed.

**Mechanism.**
- Add `seed: number` to `GameState` (the raw seed, distinct from `rngState` which is the evolving
  mulberry state). `createGame(seed)` records `seed` and sets `rngState = seedState(seed)`.
- New `rng.ts` helper `randomSeed(): number` → a uint32 from `crypto.getRandomValues(new
  Uint32Array(1))[0]`, fallback `(Date.now() ^ (Math.random()*2**32)) >>> 0`. Pure-ish but
  crypto-touching, so it lives behind a function the controller calls — the core stays
  deterministic given a seed.
- `controller.ts`: `constructor` and `restart()` call `randomSeed()` when no explicit seed is
  given. **`restart()` must NOT default to `1`** — change `restart(seed?: number)` to use
  `seed ?? randomSeed()`. `GameShell.tsx`'s `handleRestart` must stop passing `1` (out-of-scope
  file, but the controller default makes the no-arg path correct; the shell change is listed in
  tasks as a one-line follow-up so the deployed restart is actually random).
- `RenderState` and `PublicState` gain `seed: number` so the HUD/game-over screen can show it and
  tests can assert reproducibility.

### D7 — Replay record (A8)

**Decision.** The controller records every input with a timestamp and the seed, exposed as a
downloadable JSON on game over. Shape:

```ts
interface ReplayRecord {
  schemaVersion: 1;
  seed: number;
  inputs: { t: number; action: InputAction }[];  // t = ms since game start
}
```

**Mechanism (controller-owned, not core).** The controller already funnels all player actions
through `input()` / `pressSoftDrop()` / `pressHardDrop()`. Add a private `replayInputs: {t, action}[]`
and a `replayStartT` (set on `start()`). Each input appends `{t: clock.now()*1000 - replayStartT,
action}`. On game over the controller exposes `getReplay(): ReplayRecord`. A minimal but real
download seam: expose `window.__lumines.downloadReplay()` (test/dev seam, same pattern as the
existing `window.__lumines` hooks) that serialises `getReplay()` to a Blob and triggers a download;
the game-over screen can also call it. Replay *playback* (re-driving the core from the log) is
out of scope — recording + export is the deliverable (A8 only asks for the record/repro tool).

**Why controller, not core.** Timestamps are wall-clock (the core is time-free). The core is already
a pure function of (seed, input sequence), so seed + ordered inputs is sufficient to reproduce; the
controller is the only layer that sees time + the input stream.

**Alternative considered.** Record in the core as part of GameState — rejected: pollutes the pure
core with an append-only log and time. Keep it controller-side.

### D8 — Clear + lock telemetry in RenderState (audio-truth contract)

**Decision.** The core emits two monotonic event fields that the controller passes through to
RenderState, so the audio layer reads truth instead of inferring from score deltas (B1).

**Pass-completion event (clear telemetry).** Emitted by `advanceSweep` when a pass completes at the
right edge. Shape on `GameState` (record-only, like `lastChainClear`):

```ts
lastPassComplete?: {
  id: number;                 // monotonic; renderer/audio fire once per new id
  squares: number;            // distinct squares cleared this pass (scoring count)
  comboMultiplier: number;    // the multiplier actually applied (1 or STREAK_CURVE[idx], i.e. 1..4)
  groupErases: { cells: number[]; hadChain: boolean }[];  // per group erased this pass
};
```

`groupErases` is populated by D2's `eraseGroup` (each batch pushes `{cells, hadChain}` where `cells`
are the erased `row*COLS+col` coords and `hadChain` is whether a flood fired). At pass completion the
accumulated groups for that pass are attached and `id` is bumped. Between passes the field carries
forward unchanged (monotonic id means an unchanged value never re-fires) — same discipline as
`lastChainClear`.

**Lock event (lock telemetry).** Emitted whenever a piece locks, carrying its cause so the audio
layer can route the right lock/thud SFX (fixes B4's "lock only audible on hard drop"). Shape:

```ts
lastLock?: { id: number; cause: "gravity" | "soft" | "hard" };
```

Set in `lockPiece` is not possible (it doesn't know the cause), so the cause is threaded from the
caller: `gravityStep` (→ "gravity"), `softDrop` (→ "soft"), `hardDrop` (→ "hard") each stamp
`lastLock` with a bumped `id` when they lock. `lockPiece` gains an optional `cause` param defaulting
to "gravity", and the three callers pass their cause. Monotonic `id` so the consumer fires once.

**Controller passthrough.** `RenderState` gains `lastPassComplete?` and `lastLock?`, copied straight
from state (pure projection, no logic). `PublicState` gains them too so tests assert the payloads.

**Why these shapes.** The audio engine needs (a) real `(squares, comboMultiplier)` per pass to drive
clear-gated horizontal advance + the clear-stage SFX (replacing the lying score-delta deriver), and
(b) lock cause to play the right thud on every lock, not just hard drops. The shapes are minimal but
carry exactly those facts. They are additive and record-only, so they never affect determinism.

### D9 — Stale test rewrites

**Decision.** Rewrite, not skip, the tests whose assertions encode the old semantics. Families that
change:

- **`core.test.ts`** — sweep timing assertions (snapshot-at-start, per-column erase) → mark-as-pass +
  group-batch erase; mid-pass-ahead-of-bar square now clears same pass; game-over assertions move to
  the new spawn-above / top-out condition; any `SPAWN_ROW`/spawn-occupied assertions updated.
- **`chain.test.ts`** — chain floods now fire at group-erase time, not per-column delete; assertions
  on *when* a flood resolves within a pass updated (the *result* — flooded set, score=0 for extras —
  is unchanged).
- **`scoring.test.ts`** — add the single-sweep ×4 package cases (4→640, 5→800, 6→960); keep the
  streak-multiplier cases but assert multiplier-on-package; keep board-state bonus cases.
- **`determinism.test.ts` / `purity.test.ts`** — seed is now per-game; tests pass an explicit seed
  (the determinism contract is "same seed → same run", which still holds) and assert `randomSeed()`
  varies. Purity tests assert `advanceSweep`/`lockPiece` still return new state and the new telemetry
  fields are record-only (don't change deletion/scoring).
- **`preview.test.ts` / `softdrop.test.ts` / `skins.test.ts`** — RNG order is unchanged so these are
  largely intact; update any that construct `createGame(1)`-implied identical-sequence assumptions.
- **`controller.test.ts` / `controller.v2.test.ts`** — `restart()` no longer reseeds to 1; replay
  recording + telemetry passthrough get new tests; game-over via the new top-out path.

New tests: a `replay.test.ts` (record shape, append order, timestamps monotonic, seed captured) and
telemetry assertions folded into `core.test.ts`/`scoring.test.ts`.

## Risks / Trade-offs

- **Incremental marking re-detection cost (D1)** → 16×10 field, per-window predicate, O(cols×windows)
  per pass — negligible; bounded and tested for purity.
- **Cascade timing ambiguity (D2)** → the reference says cascades resolve on later passes; pinning
  "cascade behind the erased group → next pass; cascade under unpassed columns → this pass when the
  edge reaches them" is a deliberate, testable rule. Risk: a same-pass infinite cascade loop —
  mitigated by only ever marking columns the edge has reached and erasing at gaps/right-edge, so the
  edge always advances; no re-entrant erase within a column.
- **Identity-based marks must survive the group rewrite (D2)** → keep `settleColumnWithMarks` and the
  marks-travel-with-cells discipline verbatim; the only change is batching the delete. Regression
  scenario: a chain flood under a not-yet-erased marked cell must still delete the right cell post-
  settle.
- **Spawn-above game-over edge (D4)** → if the top-out test is wrong, games either never end or end
  early again. Mitigation: explicit scenario — fill the spawn columns to row 0, spawn a piece, assert
  game over; leave one free row in spawn columns, assert NOT game over and the piece enters.
- **Crypto seed in SSR/test (D6)** → `crypto.getRandomValues` may be absent in some Node/SSR paths;
  the fallback covers it. Tests always pass an explicit seed, so determinism is untouched.
- **Replay download seam (D7)** → DOM Blob/anchor is browser-only; gated behind the `window.__lumines`
  dev seam + a game-over button, never in the core. No-op under SSR/tests.
- **Telemetry shape churn for audio-truth (D8)** → these fields are a contract the follow-up consumes;
  if they're wrong the audio change reworks them. Mitigation: shapes derived directly from B1/B4's
  stated needs (real squares+combo, lock cause), reviewed against the audit. Record-only so wrong
  shapes can't break gameplay.
- **GameShell.tsx restart(1) (D6)** → an out-of-scope client file. The controller default fixes the
  no-arg path; the shell's explicit `restart(1)` must be dropped or it overrides the random seed.
  Listed as a one-line task; without it A4 is only half-fixed.

## Migration Plan

Personal repo, work on `main`, no feature branches (README §5). No data migration — pure in-memory
state. Deploy via `pnpm cf:deploy` after gates pass. Rollback = revert the commit (the live deploy is
`4509c7e` + docs). Implementation is wave-decomposed in `tasks.md`; each wave is independently green
on `pnpm test` / `typecheck` / `lint` / `build` before the next.

## Open Questions

- **Renderer staging visuals (D4):** does the renderer draw the piece in the above-field staging area,
  or does the piece "appear" at the top edge? The core change is identical either way; the renderer
  polish is a separate, optional follow-up. Defaulting to "board grid projection unchanged" (piece
  enters from the top edge) for minimal blast radius.
- **Replay playback:** out of scope now (record + export only). A future change can re-drive the core
  from `{seed, inputs}` for true replay/desync-repro.
