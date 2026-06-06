# Research: Fix Bottom Settle

## Decision: Treat the bug as an active-piece render boundary problem first

**Rationale**: Existing core tests already verify that gravity locking and hard drop place a 2x2 piece on rows 8 and 9, and `piece.ts` rejects positions below the grid. The reported artifact is visible clipping below the canvas before snapping into the correct landed rows, which points to the active-piece visual interpolation (`fallProgress`) continuing past the last valid visible position.

**Alternatives considered**:

- Change core `hardDrop` or `gravityStep`: rejected unless new tests prove incorrect state, because the current model already lands pieces on valid bottom rows.
- Add a post-lock visual delay: rejected because acceptance requires immediate, smooth settle with no delay/clip artifact.

## Decision: Constrain active-piece drawing to the last valid visible landing position

**Rationale**: The active piece is drawn separately from the settled grid for smooth descent. Near the bottom row, a full-row visual interpolation can place the piece below the playfield even though the model has not legally moved there. The renderer should ensure the drawn cells never exceed the playfield boundary while keeping normal in-air interpolation.

**Alternatives considered**:

- Clip the entire canvas layer: rejected as a fallback-only approach because it can hide the symptom while leaving a visible timing/snap issue.
- Disable active-piece interpolation globally: rejected because it would regress normal smooth descent.

## Decision: Preserve settled-grid collapse offsets separately from active-piece landing correction

**Rationale**: The existing per-column overhang/collapse polish is driven by settled-grid column matching and fall offsets after grid changes. The bottom-row fix should not change that animation path. Tests should include uneven-stack and near-bottom cases to make this explicit.

**Alternatives considered**:

- Rework all settle animation into a unified landing system: rejected as too broad for a single brownfield bug fix.
- Remove column offsets when near the bottom: rejected because the spec explicitly requires preserving smooth per-column overhang settle.

## Decision: Validate through both deterministic state and rendered bounds

**Rationale**: State correctness alone can pass while the visual artifact remains. Browser validation should combine `window.__lumines.state().grid` checks with canvas/playfield visual assertions or screenshot/pixel checks that detect cells below the board.

**Alternatives considered**:

- Unit tests only: rejected because the reported failure is visual.
- Manual inspection only: rejected because the feature is explicitly testable and should be repeatable.
