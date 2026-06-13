import { describe, expect, it } from "vitest";
import type { Piece } from "../core";
import { FakeClock } from "../time/clock";
import { GameController } from "./controller";

/**
 * Replay recording (audit A8): the controller records every player input tagged
 * with `t` = ms since game start, plus the run seed. Seed + ordered inputs
 * reproduce the run because the core is a pure function of (seed, inputs).
 */

const MONO: Piece = [
  [0, 0],
  [0, 0],
];

/** A started test-mode controller with an active piece and a manual clock. */
function startedController(seed = 1234): { c: GameController; clock: FakeClock } {
  const clock = new FakeClock();
  const c = new GameController({ testMode: true, seed, clock });
  c.start(); // anchors replayStartT to clock.now() (= 0)
  c.testSpawn(MONO); // gives an active piece so input() is accepted
  return { c, clock };
}

describe("ReplayRecord shape + seed capture", () => {
  it("captures schemaVersion 1 and the game seed", () => {
    const { c } = startedController(98765);
    const replay = c.getReplay();
    expect(replay.schemaVersion).toBe(1);
    expect(replay.seed).toBe(98765);
    expect(replay.seed).toBe(c.testRawState().seed);
  });

  it("starts with an empty input log before any input", () => {
    const { c } = startedController();
    expect(c.getReplay().inputs).toEqual([]);
  });
});

describe("input recording (order + monotonic timestamps)", () => {
  it("records each action in order, tagged with non-decreasing t", () => {
    const { c, clock } = startedController();
    c.input("left");
    clock.advance(0.1); // +100ms
    c.input("right");
    clock.advance(0.05); // +50ms
    c.input("rotate");
    clock.advance(0.2); // +200ms
    c.pressSoftDrop();
    clock.advance(0.0); // same instant
    c.pressHardDrop();

    const { inputs } = c.getReplay();
    expect(inputs.map((i) => i.action)).toEqual([
      "left",
      "right",
      "rotate",
      "softDrop",
      "hardDrop",
    ]);
    // Timestamps are non-decreasing (clock is monotonic).
    for (let i = 1; i < inputs.length; i++) {
      expect(inputs[i]!.t).toBeGreaterThanOrEqual(inputs[i - 1]!.t);
    }
    // First input at t=0 (no clock advance yet), second at ~100ms.
    expect(inputs[0]!.t).toBeCloseTo(0, 6);
    expect(inputs[1]!.t).toBeCloseTo(100, 6);
    expect(inputs[2]!.t).toBeCloseTo(150, 6);
  });

  it("getReplay returns a copy: mutating it does not change the controller log", () => {
    const { c } = startedController();
    c.input("left");
    const replay = c.getReplay();
    replay.inputs.push({ t: 999, action: "right" });
    expect(c.getReplay().inputs).toHaveLength(1); // unchanged
  });

  it("a no-op input while held (drop) is still recorded as an input event", () => {
    // The controller records at the input entry point (before the held-key no-op),
    // so the replay reflects what the player actually pressed.
    const { c } = startedController();
    // A fresh spawn holds; a carried-over softDrop input is a gameplay no-op but a
    // real key event.
    c.input("softDrop");
    expect(c.getReplay().inputs.map((i) => i.action)).toEqual(["softDrop"]);
  });
});

describe("seed + inputs reproduce the run (determinism contract)", () => {
  it("two controllers with the same seed + identical inputs reach the same state", () => {
    const drive = (): GameController => {
      const clock = new FakeClock();
      const c = new GameController({ testMode: true, seed: 555, clock });
      c.start();
      c.testSpawn(MONO);
      c.input("left");
      c.input("rotate");
      c.pressHardDrop();
      return c;
    };
    const a = drive();
    const b = drive();
    expect(b.testState().grid).toEqual(a.testState().grid);
    expect(b.testState().score).toBe(a.testState().score);
    // The replays are identical too (same seed, same ordered inputs).
    expect(b.getReplay()).toEqual(a.getReplay());
  });
});
