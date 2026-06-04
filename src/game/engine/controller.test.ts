import { describe, expect, it } from "vitest";
import { HOLD_MS, type Piece } from "../core";
import { GameController } from "./controller";

const MONO_A: Piece = [
  [0, 0],
  [0, 0],
];

function playing(): GameController {
  const c = new GameController({ testMode: true, seed: 1 });
  c.testSpawn(MONO_A);
  return c;
}

describe("GameController hold behaviour", () => {
  it("a spawned block is held at the top", () => {
    const c = playing();
    const s = c.testState();
    expect(s.hold).toEqual({ active: true, remainingMs: HOLD_MS });
    expect(s.grid[0]![7]).toBe(0); // still at the top
    expect(s.grid[1]![7]).toBe(0);
  });

  it("a hold-aware tick consumes the hold without moving the piece", () => {
    const c = playing();
    c.testTick(); // one beat (700ms) >= HOLD_MS (500ms) -> releases, no move
    const s = c.testState();
    expect(s.hold.active).toBe(false);
    expect(s.grid[0]![7]).toBe(0); // did NOT advance during the hold beat
    expect(s.grid[2]![7]).toBe(null);
  });

  it("after the hold lapses the block falls at normal gravity", () => {
    const c = playing();
    c.testTick(); // release
    c.testTick(); // first real gravity step
    const s = c.testState();
    expect(s.grid[0]![7]).toBe(null);
    expect(s.grid[1]![7]).toBe(0);
    expect(s.grid[2]![7]).toBe(0);
  });

  it("a carried-over hold (no fresh press) does not advance the new block", () => {
    const c = playing();
    // Simulate holding the key: we never call pressSoftDrop across the spawn.
    const before = c.testState();
    expect(before.grid[0]![7]).toBe(0);
    expect(before.hold.active).toBe(true);
  });

  it("a fresh soft-drop press cancels the hold and advances immediately", () => {
    const c = playing();
    c.testPressSoftDrop();
    const s = c.testState();
    expect(s.hold.active).toBe(false);
    expect(s.grid[0]![7]).toBe(null);
    expect(s.grid[1]![7]).toBe(0); // moved down one row at once
    expect(s.grid[2]![7]).toBe(0);
  });

  it("a fresh hard-drop press cancels the hold and drops to the floor", () => {
    const c = playing();
    c.testPressHardDrop();
    const s = c.testState();
    expect(s.grid[9]![7]).toBe(0);
    expect(s.grid[8]![7]).toBe(0);
  });
});
