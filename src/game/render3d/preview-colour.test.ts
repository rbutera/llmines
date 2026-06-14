import { describe, expect, it } from "vitest";
import { previewSlotIsBright } from "./PreviewDock";
import { createGame } from "../core/grid";
import { refillQueue, spawnFromQueue } from "../core/piece";

/**
 * FIX A (preview colours look inverted): every preview SLOT must show the TRUE
 * colour of its queued piece's cell at that position. The dock renders
 * `cells[r][c]` (r=0 top, r=1 bottom; c=0 left, c=1 right) — the SAME mapping the
 * board's active piece uses (Scene3D `setActive` reads `cells[r][c]` for the same
 * r,c). These tests lock that there is no per-slot (esp. right-column) colour
 * swap, and that the preview head's colours are exactly the piece that spawns.
 *
 * The bright verdict is the visual read (bright = the light cell, dark = the dark
 * cell); the renderer drives the inner shape + colour off it, so locking the
 * verdict per slot guarantees the colours can't be swapped between columns.
 */

/** Mirror of the board's active-piece bright mapping (Scene3D `setActive`). */
function boardActiveBright(
  cells: [[0 | 1, 0 | 1], [0 | 1, 0 | 1]],
  r: 0 | 1,
  c: 0 | 1,
): boolean {
  return cells[r][c] === 0;
}

describe("preview slot colour fidelity (FIX A)", () => {
  it("each of the 4 slots maps to its OWN cell colour (no transposition / column swap)", () => {
    // An asymmetric piece where every cell differs from its row/col neighbours,
    // so any swap (left<->right, top<->bottom, transpose) would change a verdict.
    const piece: [[0 | 1, 0 | 1], [0 | 1, 0 | 1]] = [
      [0, 1],
      [1, 0],
    ];
    expect(previewSlotIsBright(piece, 0, 0)).toBe(true); // top-left = 0 = bright
    expect(previewSlotIsBright(piece, 0, 1)).toBe(false); // top-right = 1 = dark
    expect(previewSlotIsBright(piece, 1, 0)).toBe(false); // bottom-left = 1 = dark
    expect(previewSlotIsBright(piece, 1, 1)).toBe(true); // bottom-right = 0 = bright
  });

  it("the RIGHT column specifically is NOT inverted vs its true cell", () => {
    // Right column distinct from left so an inversion would be caught.
    const piece: [[0 | 1, 0 | 1], [0 | 1, 0 | 1]] = [
      [0, 0],
      [1, 1],
    ];
    // left column: top bright, bottom dark
    expect(previewSlotIsBright(piece, 0, 0)).toBe(true);
    expect(previewSlotIsBright(piece, 1, 0)).toBe(false);
    // right column: MUST read identically to its own cells, not flipped
    expect(previewSlotIsBright(piece, 0, 1)).toBe(true);
    expect(previewSlotIsBright(piece, 1, 1)).toBe(false);
  });

  it("preview verdict === board active-piece verdict for every slot, every colour combo", () => {
    for (const a of [0, 1] as const)
      for (const b of [0, 1] as const)
        for (const c of [0, 1] as const)
          for (const d of [0, 1] as const) {
            const piece: [[0 | 1, 0 | 1], [0 | 1, 0 | 1]] = [
              [a, b],
              [c, d],
            ];
            for (const r of [0, 1] as const)
              for (const col of [0, 1] as const) {
                expect(previewSlotIsBright(piece, r, col)).toBe(
                  boardActiveBright(piece, r, col),
                );
              }
          }
  });

  it("the preview HEAD's per-slot colours equal the piece that actually spawns", () => {
    for (let seed = 1; seed < 40; seed++) {
      const filled = refillQueue(createGame(seed));
      const head = filled.queue[0]!;
      const spawned = spawnFromQueue(filled).active!.cells;
      for (const r of [0, 1] as const)
        for (const c of [0, 1] as const) {
          expect(
            previewSlotIsBright(head.cells, r, c),
            `seed ${seed} r${r}c${c}`,
          ).toBe(boardActiveBright(spawned, r, c));
        }
    }
  });
});
