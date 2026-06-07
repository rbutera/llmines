import { describe, expect, it } from "vitest";
import {
  blendSkins,
  chromeCssVars,
  hexToRgb,
  lerpBoard,
  lerpChrome,
  lerpHex,
  rgbToHex,
} from "./crossfade";
import { SKIN_NEON, SKIN_PIPELINE } from "./skins";

describe("hex <-> rgb", () => {
  it("parses 6-digit hex", () => {
    expect(hexToRgb("#ff8000")).toEqual([255, 128, 0]);
  });
  it("parses 3-digit shorthand", () => {
    expect(hexToRgb("#0f0")).toEqual([0, 255, 0]);
  });
  it("round-trips", () => {
    expect(rgbToHex(hexToRgb("#3b1d6e"))).toBe("#3b1d6e");
  });
  it("clamps out-of-range channels", () => {
    expect(rgbToHex([300, -10, 128])).toBe("#ff0080");
  });
});

describe("lerpHex", () => {
  it("returns the start at t=0 and the end at t=1", () => {
    expect(lerpHex("#000000", "#ffffff", 0)).toBe("#000000");
    expect(lerpHex("#000000", "#ffffff", 1)).toBe("#ffffff");
  });
  it("interpolates the midpoint", () => {
    expect(lerpHex("#000000", "#ffffff", 0.5)).toBe("#808080");
  });
  it("clamps t outside [0,1]", () => {
    expect(lerpHex("#000000", "#ffffff", -1)).toBe("#000000");
    expect(lerpHex("#000000", "#ffffff", 2)).toBe("#ffffff");
  });
});

describe("palette lerps", () => {
  it("board t=0 is from, t=1 is to", () => {
    expect(lerpBoard(SKIN_NEON.board, SKIN_PIPELINE.board, 0)).toEqual(
      SKIN_NEON.board,
    );
    expect(lerpBoard(SKIN_NEON.board, SKIN_PIPELINE.board, 1)).toEqual(
      SKIN_PIPELINE.board,
    );
  });
  it("chrome t=0 is from, t=1 is to", () => {
    expect(lerpChrome(SKIN_NEON.chrome, SKIN_PIPELINE.chrome, 0)).toEqual(
      SKIN_NEON.chrome,
    );
    expect(lerpChrome(SKIN_NEON.chrome, SKIN_PIPELINE.chrome, 1)).toEqual(
      SKIN_PIPELINE.chrome,
    );
  });
  it("midpoint differs from both endpoints (a real blend)", () => {
    const mid = lerpBoard(SKIN_NEON.board, SKIN_PIPELINE.board, 0.5);
    expect(mid.darkEmissive).not.toBe(SKIN_NEON.board.darkEmissive);
    expect(mid.darkEmissive).not.toBe(SKIN_PIPELINE.board.darkEmissive);
  });
});

describe("blendSkins", () => {
  it("blends both surfaces together", () => {
    const { board, chrome } = blendSkins(SKIN_NEON, SKIN_PIPELINE, 1);
    expect(board).toEqual(SKIN_PIPELINE.board);
    expect(chrome).toEqual(SKIN_PIPELINE.chrome);
  });
});

describe("chromeCssVars", () => {
  it("maps to the accent CSS custom properties", () => {
    const vars = chromeCssVars(SKIN_PIPELINE.chrome);
    expect(vars["--accent"]).toBe(SKIN_PIPELINE.chrome.accent);
    expect(vars["--accent-bright"]).toBe(SKIN_PIPELINE.chrome.accentBright);
    expect(vars["--accent-deep"]).toBe(SKIN_PIPELINE.chrome.accentDeep);
  });
});
