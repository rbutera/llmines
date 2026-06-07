import { describe, expect, it } from "vitest";
import { ROWS, SPAWN_COL, SPAWN_ROW } from "./constants";
import { createGame } from "./grid";
import { releaseHold, softDrop, spawnPiece } from "./piece";
import type { GameState, Piece } from "./types";

const MONO: Piece = [
  [0, 0],
  [0, 0],
];

/** Spawn a piece on an empty board and release the spawn-hold so it can fall. */
function readyPiece(): GameState {
  let s = createGame(1);
  s = spawnPiece(s, MONO);
  s = releaseHold(s);
  return s;
}

describe("soft-drop scoring: accrue-on-settle (real Lumines semantics)", () => {
  it("does NOT change the authoritative score per descended row", () => {
    const s = readyPiece();
    expect(s.score).toBe(0);

    // Soft-drop a couple of rows; the piece descends but the score must NOT
    // tick up in realtime — points only land on settle.
    const before = s.score;
    const r1 = softDrop(s);
    expect(r1.locked).toBe(false);
    expect(r1.state.score).toBe(before); // no realtime score change
    expect(r1.state.softDropBonus).toBe(1); // accrued instead

    const r2 = softDrop(r1.state);
    expect(r2.locked).toBe(false);
    expect(r2.state.score).toBe(before); // still no realtime change
    expect(r2.state.softDropBonus).toBe(2);
  });

  it("banks the accrued bonus exactly once on settle; total = rows dropped", () => {
    let s = readyPiece();
    let locked = false;
    let rowsDescended = 0;

    // Drive the piece to the floor purely by soft-drop, counting descents.
    while (!locked) {
      const r = softDrop(s);
      s = r.state;
      locked = r.locked;
      if (!locked) rowsDescended += 1;
    }

    // The MONO piece spawns at SPAWN_ROW and its lowest cells rest on the floor.
    const expectedRows = ROWS - 1 - (SPAWN_ROW + 1);
    expect(rowsDescended).toBe(expectedRows);

    // On settle the score equals exactly the number of soft-dropped rows (the
    // total is unchanged vs the old per-row rule; only the TIMING moved to lock),
    // and the pending bonus is reset for the next piece.
    expect(s.score).toBe(expectedRows);
    expect(s.softDropBonus).toBe(0);
    expect(s.active).toBeNull(); // it locked
    expect(s.grid[ROWS - 1]![SPAWN_COL]).not.toBeNull();
  });

  it("resets the pending bonus when a new piece spawns", () => {
    let s = readyPiece();
    s = softDrop(s).state; // accrue 1
    expect(s.softDropBonus).toBe(1);

    // A fresh spawn (before settling) starts the next piece clean.
    s = spawnPiece(s, MONO);
    expect(s.softDropBonus).toBe(0);
  });
});
