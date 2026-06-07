import { describe, expect, it } from "vitest";
import { COLS, ROWS } from "../core";
import { GameController } from "./controller";

/**
 * Render-only `floodPreview`: the cells a gem is ABOUT TO flood-clear on the
 * next pass, surfaced so the renderer can mark the chain extent BEFORE the sweep
 * harvests it (item 6 — previously the flooded blocks vanished with no warning).
 *
 * It must equal exactly what the chain flood WOULD delete, and only when the gem
 * is actually armed (its cell is part of a completed square this pass). It is a
 * pure projection of the grid + specials; it must never mutate game state.
 */
describe("floodPreview (gem about-to-flood marking)", () => {
  const idx = (row: number, col: number) => row * COLS + col;

  it("is empty when there are no specials on the board", () => {
    const c = new GameController({ testMode: true, seed: 1 });
    expect(c.getRenderState().floodPreview).toEqual([]);
  });

  it("is empty when a gem exists but is NOT part of a completed square", () => {
    const c = new GameController({ testMode: true, seed: 1 });
    // A lone gem cell with same-colour neighbours but no 2x2 square: not armed.
    c.testSetCell(ROWS - 1, 0, 0);
    c.testSetCell(ROWS - 1, 1, 0);
    c.testSetSpecial(ROWS - 1, 0);
    expect(c.getRenderState().floodPreview).toEqual([]);
  });

  it("marks the full connected same-colour region of an ARMED gem", () => {
    const c = new GameController({ testMode: true, seed: 1 });
    const r0 = ROWS - 2;
    const r1 = ROWS - 1;
    // A 2x2 square of colour 0 at cols 0..1 (completed square => armed) PLUS a
    // connected tail of colour 0 reaching out to col 3 — the flood should grab
    // the whole connected region, not just the square.
    c.testSetCell(r0, 0, 0);
    c.testSetCell(r0, 1, 0);
    c.testSetCell(r1, 0, 0);
    c.testSetCell(r1, 1, 0);
    c.testSetCell(r1, 2, 0); // tail
    c.testSetCell(r1, 3, 0); // tail
    // A different-colour cell that must NOT be included.
    c.testSetCell(r0, 3, 1);
    // Gem sits on a square cell, so it is armed.
    c.testSetSpecial(r1, 0);

    const preview = new Set(c.getRenderState().floodPreview);
    // All six connected colour-0 cells are in the preview.
    for (const cell of [
      idx(r0, 0),
      idx(r0, 1),
      idx(r1, 0),
      idx(r1, 1),
      idx(r1, 2),
      idx(r1, 3),
    ]) {
      expect(preview.has(cell)).toBe(true);
    }
    // The colour-1 cell is excluded.
    expect(preview.has(idx(r0, 3))).toBe(false);
  });

  it("does not mutate game state (pure projection)", () => {
    const c = new GameController({ testMode: true, seed: 1 });
    const r1 = ROWS - 1;
    c.testSetCell(r1 - 1, 0, 0);
    c.testSetCell(r1 - 1, 1, 0);
    c.testSetCell(r1, 0, 0);
    c.testSetCell(r1, 1, 0);
    c.testSetSpecial(r1, 0);
    const before = JSON.stringify(c.testState());
    c.getRenderState();
    c.getRenderState();
    expect(JSON.stringify(c.testState())).toBe(before);
  });
});
