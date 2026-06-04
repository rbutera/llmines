# Research: LLMines Game

## Decision: Use a pure TypeScript game engine as the source of truth

**Rationale**: Collision, locking, square detection, sweep clears, gravity, scoring, spawning, game-over checks, and deterministic test controls are easier to test and reason about when they do not depend on React render timing, Pixi display objects, or audio playback. The 16x10 board is small, so immutable snapshots for tests and simple synchronous rule updates are sufficient.

**Alternatives considered**: Keeping state in React components was rejected because it would couple acceptance-critical rules to rendering. Keeping state in Pixi display objects was rejected because test assertions need structured grid data and deterministic stepping.

## Decision: Render the board with PixiJS mounted inside a client React component

**Rationale**: PixiJS is a fixed stack requirement and is appropriate for polished block animation, sweep effects, glow/highlight states, and collapse animation. A React wrapper component can own the canvas container ref and translate engine state into Pixi sprites/graphics while the surrounding HUD and screens remain normal accessible DOM.

**Alternatives considered**: CSS grid rendering was rejected because the MVP requires PixiJS and polished canvas animation. Full-canvas UI was rejected because start/restart controls, score, instructions, and accessibility are better handled in DOM.

## Decision: Keep the create-t3-app scaffold and avoid adding backend behavior

**Rationale**: The product is a local browser game with no persistence or accounts in the MVP. The existing tRPC scaffold can remain, but gameplay does not need server procedures, database access, or authentication.

**Alternatives considered**: Adding API routes or tRPC procedures for game state was rejected as extra scope. Removing tRPC scaffold files was rejected as unrelated churn.

## Decision: Drive normal sweep timing from audio time, with deterministic override in test mode

**Rationale**: Normal play needs the sweep locked to a 120 BPM looping backing track. Mapping audio current time modulo 4.0 seconds to sweep position keeps visual timing aligned with the track. In test mode, deterministic `dtMs` advancement avoids headless browser audio and wall-clock flake.

**Alternatives considered**: Using only `requestAnimationFrame` elapsed time was rejected because it can drift from audio. Attempting autoplay workarounds was rejected because acceptance explicitly does not require bypassing browser gesture policies.

## Decision: Count squares by top-left coordinate and clear marked cells by sweep column

**Rationale**: The pinned scoring rule depends on distinct aligned 2x2 squares, including overlaps in larger monochrome regions. Keeping a set of square top-left coordinates and a separate set of marked cells makes scoring and deletion explicit: score per sweep is total deleted cells multiplied by distinct squares cleared in that sweep.

**Alternatives considered**: Counting connected components was rejected because it would undercount 2x3 and 3x3 regions. Counting deleted cells only was rejected because it misses the required multiplier.

## Decision: Use Vitest and Playwright for required validation

**Rationale**: Vitest is suited to deterministic engine tests for collision, rotations, square detection, scoring, gravity, game over, and sweep math. Playwright is suited to start/game-over flows, keyboard controls, stable DOM hooks, audio element contract, and the `window.__lumines` interface.

**Alternatives considered**: Testing only through Playwright was rejected because visual/browser tests are slower and less precise for rules. Testing only unit logic was rejected because acceptance includes browser-visible UI, audio element, keyboard behavior, and test-mode exposure.

## Decision: Expose the exact deterministic harness only behind `NEXT_PUBLIC_TEST_MODE=1`

**Rationale**: Acceptance requires external automation to seed RNG, inspect state, spawn pieces, tick gravity, run sweeps, and advance sweep progress. The production behavior must not expose those hooks, so the browser global should be installed only when the public test-mode environment flag is set.

**Alternatives considered**: Always exposing the harness was rejected because normal builds must not include test hooks. Using DOM-only controls was rejected because acceptance must not depend on timing, audio decode, or visual scraping.

## Decision: Keep surrounding UI in DOM and game action visuals in Pixi

**Rationale**: DOM controls, score, instructions, and screens preserve accessibility and stable automation selectors. Pixi handles the playfield visuals where animation polish matters most: falling sub-blocks, locks, marked-square highlights, sweep pass, clear effects, and column collapse.

**Alternatives considered**: Rendering all UI in Pixi was rejected because it would weaken accessibility and DOM selectors. Rendering all gameplay in DOM was rejected because PixiJS is required and better fits the animation target.
