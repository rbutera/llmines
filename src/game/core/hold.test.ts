import { describe, expect, it } from "vitest";
import { HOLD_MS } from "./constants";
import { createGame } from "./grid";
import { freshHold, isHolding, noHold, releaseHold, tickHold } from "./hold";
import type { GameState } from "./types";

const MONO_A = [
  [0, 0],
  [0, 0],
] as const;

function held(): GameState {
  return {
    ...createGame(1),
    active: { cells: MONO_A as never, pos: { row: 0, col: 7 } },
    hold: freshHold(),
  };
}

describe("hold helpers", () => {
  it("freshHold is active with the full window; noHold is inactive", () => {
    expect(freshHold()).toEqual({ active: true, remainingMs: HOLD_MS });
    expect(noHold()).toEqual({ active: false, remainingMs: 0 });
  });

  it("isHolding is true only with an active piece and an active hold", () => {
    expect(isHolding(held())).toBe(true);
    expect(isHolding({ ...held(), hold: noHold() })).toBe(false);
    expect(isHolding({ ...createGame(1), active: null })).toBe(false);
  });

  it("tickHold decrements remainingMs without moving the piece", () => {
    const s = tickHold(held(), 100);
    expect(s.hold).toEqual({ active: true, remainingMs: HOLD_MS - 100 });
    expect(s.active!.pos).toEqual({ row: 0, col: 7 });
  });

  it("tickHold releases the hold when the window lapses", () => {
    const s = tickHold(held(), HOLD_MS + 50);
    expect(s.hold).toEqual({ active: false, remainingMs: 0 });
  });

  it("tickHold on a non-holding state is a no-op", () => {
    const base = { ...held(), hold: noHold() };
    expect(tickHold(base, 100)).toBe(base);
  });

  it("releaseHold cancels an active hold", () => {
    expect(releaseHold(held()).hold).toEqual({ active: false, remainingMs: 0 });
  });

  it("createGame starts with no hold", () => {
    expect(createGame(1).hold).toEqual({ active: false, remainingMs: 0 });
  });
});
