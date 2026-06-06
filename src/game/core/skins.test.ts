import { describe, expect, it } from "vitest";
import { COLS, ROWS, SKIN_ADVANCE_THRESHOLD } from "./constants";
import { createGame } from "./grid";
import { skinAt, skinBpm, SKINS } from "./skins";
import { advanceSweep } from "./sweep";
import type { GameState } from "./types";

describe("skin data", () => {
  it("is an ordered list of >= 2 skins, each with BPM + palette + theme", () => {
    expect(SKINS.length).toBeGreaterThanOrEqual(2);
    for (const skin of SKINS) {
      expect(typeof skin.bpm).toBe("number");
      expect(skin.bpm).toBeGreaterThan(0);
      expect(skin.blockPalette).toHaveLength(2);
      expect(typeof skin.visualTheme).toBe("string");
    }
  });

  it("BPM rises with each successive skin (faster sweep on progression)", () => {
    for (let i = 1; i < SKINS.length; i++) {
      expect(SKINS[i]!.bpm).toBeGreaterThan(SKINS[i - 1]!.bpm);
    }
  });

  it("skinAt / skinBpm clamp at the last skin", () => {
    expect(skinAt(999).id).toBe(SKINS[SKINS.length - 1]!.id);
    expect(skinBpm(999)).toBe(SKINS[SKINS.length - 1]!.bpm);
  });
});

/**
 * A solid mono block `h` rows x `w` cols anchored on the floor -> (h-1)(w-1)
 * distinct 2x2 squares, all cleared in one pass. `w <= COLS`, `h <= ROWS`.
 */
function monoBlock(h: number, w: number, color: 0 | 1 = 0): GameState {
  const base = createGame();
  for (let r = ROWS - h; r < ROWS; r++) {
    for (let c = 0; c < w; c++) base.grid[r]![c] = color;
  }
  return base;
}

describe("deterministic skin advancement on squares cleared", () => {
  it("crossing the threshold advances the skin and resets the per-skin counter", () => {
    // A 3x11 mono block = (3-1)(11-1) = 20 = SKIN_ADVANCE_THRESHOLD squares.
    expect(SKIN_ADVANCE_THRESHOLD).toBe(20);
    let s = monoBlock(3, 11);
    expect(s.skinIndex).toBe(0);
    s = advanceSweep(s, COLS);
    expect(s.skinIndex).toBe(1);
    expect(s.clearsInSkin).toBe(0);
  });

  it("below the threshold does not advance the skin", () => {
    // 2x3 mono block = (2-1)(3-1) = 2 squares < threshold.
    let s = monoBlock(2, 3);
    s = advanceSweep(s, COLS);
    expect(s.skinIndex).toBe(0);
    expect(s.clearsInSkin).toBe(2);
  });

  it("seeded/identical inputs advance skins at the same point (deterministic)", () => {
    const run = () => advanceSweep(monoBlock(3, 11), COLS);
    const a = run();
    const b = run();
    expect(a.skinIndex).toBe(b.skinIndex);
    expect(a.clearsInSkin).toBe(b.clearsInSkin);
  });
});
