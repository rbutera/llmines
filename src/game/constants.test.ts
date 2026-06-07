import { describe, expect, it } from "vitest";
import {
  BEAT_MS,
  BPM,
  COLS,
  GRAVITY_INTERVAL_MS,
  ROWS,
  SPAWN_COLS,
  SPAWN_ROWS,
  SWEEP_MS_PER_COL,
  SWEEP_PERIOD_MS,
} from "./constants";

describe("game constants", () => {
  it("define the expected playfield dimensions and timings", () => {
    expect(COLS).toBe(16);
    expect(ROWS).toBe(10);
    expect(SPAWN_COLS).toEqual([7, 8]);
    expect(SPAWN_ROWS).toEqual([0, 1]);
    expect(BPM).toBe(120);
    expect(BEAT_MS).toBe(500);
    expect(SWEEP_MS_PER_COL).toBe(250);
    expect(SWEEP_PERIOD_MS).toBe(4000);
    expect(GRAVITY_INTERVAL_MS).toBe(BEAT_MS);
  });
});
