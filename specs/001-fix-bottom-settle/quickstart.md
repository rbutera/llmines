# Quickstart: Fix Bottom Settle Validation

## Prerequisites

- Use the existing repository dependencies installed with `pnpm`.
- Run browser validation with test mode enabled so the deterministic LLMines test API is available.

## Setup

```bash
pnpm install
```

## Unit/Core Validation

Run the existing core checks to confirm model-level bottom-row locking still behaves correctly:

```bash
pnpm test
```

Expected outcome:

- Gravity steps lock pieces on the bottom rows.
- Hard drop lands immediately on the floor.
- Existing sweep, scoring, and settle tests continue to pass.

## Browser Validation

Run the Playwright suite:

```bash
pnpm test:e2e
```

Expected outcome:

- The deterministic test API is available in test mode.
- A spawned 2x2 piece advanced by ticks lands on rows 8 and 9 with no out-of-bounds cells.
- A hard-dropped piece lands on the same valid bottom rows.
- No browser assertion or screenshot/pixel check detects a visible cell below the playfield.

## Manual Smoke Check

Start the app:

```bash
pnpm dev
```

Then in the browser:

1. Start a game.
2. Hard-drop pieces that have clear space to the floor.
3. Let pieces naturally fall to the bottom row.
4. Build an uneven stack and land a piece across the overhang.

Expected outcome:

- Bottom-row landings are visually contained within the playfield at all times.
- Pieces lock without a below-grid delay or snap-back artifact.
- The existing per-column overhang settle remains smooth.

## Related Design References

- [data-model.md](data-model.md) defines the playfield, falling piece, landed grid, and settle motion entities.
- [contracts/test-api.md](contracts/test-api.md) defines the test API observations required for this feature.
