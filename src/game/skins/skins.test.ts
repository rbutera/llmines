import { describe, expect, it } from "vitest";
import {
  DEFAULT_SKIN,
  nextSkin,
  skinById,
  SKIN_NEON,
  SKIN_PIPELINE,
  SKINS,
} from "./skins";

describe("skin registry", () => {
  it("ships exactly the two skins in cycle order", () => {
    expect(SKINS.map((s) => s.id)).toEqual(["neon", "pipeline"]);
  });
  it("defaults to neon", () => {
    expect(DEFAULT_SKIN.id).toBe("neon");
  });
});

describe("nextSkin cycles", () => {
  it("neon -> pipeline -> neon", () => {
    expect(nextSkin("neon").id).toBe("pipeline");
    expect(nextSkin("pipeline").id).toBe("neon");
  });
  it("unknown id falls back to the first cycle step", () => {
    expect(nextSkin("nope").id).toBe("neon");
  });
});

describe("skinById", () => {
  it("resolves known ids", () => {
    expect(skinById("pipeline")).toBe(SKIN_PIPELINE);
  });
  it("defaults unknown / null to neon", () => {
    expect(skinById("nope")).toBe(SKIN_NEON);
    expect(skinById(null)).toBe(SKIN_NEON);
  });
});

describe("palette cohesion", () => {
  it("the two skins have distinct accents (a real recolour)", () => {
    expect(SKIN_NEON.board.darkEmissive).not.toBe(
      SKIN_PIPELINE.board.darkEmissive,
    );
    expect(SKIN_NEON.chrome.accent).not.toBe(SKIN_PIPELINE.chrome.accent);
  });
  it("the neon skin matches the round-2 baked-in board palette", () => {
    // Guards P0: switching back to neon must reproduce the exact dark-surround
    // tuning the round-2 visual shipped (so the skin layer can never regress it).
    expect(SKIN_NEON.board.darkFace).toBe("#1a0e33");
    expect(SKIN_NEON.board.darkEmissive).toBe("#3b1d6e");
    expect(SKIN_NEON.board.darkCore).toBe("#2a1147");
    expect(SKIN_NEON.board.darkCoreEmissive).toBe("#7c3aed");
    expect(SKIN_NEON.board.background).toBe("#0a0a12");
  });
});
