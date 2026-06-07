import { describe, expect, it } from "vitest";
import type { AudioEvent } from "./engine";
import {
  asAudioMix,
  type AudioMix,
  DEFAULT_MIX,
  layerGain,
  PRESETS,
  routeEvent,
} from "./presets";

const ACTIONS: AudioEvent[] = [
  { type: "move" },
  { type: "rotate" },
  { type: "softDrop" },
  { type: "lock" },
  { type: "lineClear", squares: 4, combo: 1 },
  { type: "chain", size: 5 },
];

describe("audio presets", () => {
  it("narrows mix strings, defaulting to B", () => {
    expect(asAudioMix("A")).toBe("A");
    expect(asAudioMix("C")).toBe("C");
    expect(asAudioMix("nonsense")).toBe(DEFAULT_MIX);
    expect(DEFAULT_MIX).toBe("B");
  });

  it("every action makes SOME sound in every preset (rotate especially)", () => {
    for (const mix of ["A", "B", "C"] as AudioMix[]) {
      for (const ev of ACTIONS) {
        const r = routeEvent(PRESETS[mix], ev);
        const audible = r.sfx != null || r.blip === true;
        expect(audible, `${mix}/${ev.type} must be audible`).toBe(true);
      }
      // rotate specifically
      const rot = routeEvent(PRESETS[mix], { type: "rotate" });
      expect(rot.sfx != null || rot.blip === true).toBe(true);
    }
  });

  it("A is sparse on movement ad-libs; C fires an ad-lib on every action", () => {
    // A: no recorded ad-lib on move / rotate (they stay procedural blips).
    expect(routeEvent(PRESETS.A, { type: "move" }).sfx).toBeUndefined();
    expect(routeEvent(PRESETS.A, { type: "rotate" }).sfx).toBeUndefined();
    // C: every action type maps a recorded ad-lib.
    for (const ev of ACTIONS) {
      expect(routeEvent(PRESETS.C, ev).sfx, `C/${ev.type} should map an ad-lib`).toBeDefined();
    }
  });

  it("B fires ad-libs on match, hard-drop (lock), rotate, and chain", () => {
    expect(routeEvent(PRESETS.B, { type: "lineClear", squares: 4, combo: 0 }).sfx).toBe("match");
    expect(routeEvent(PRESETS.B, { type: "lock" }).sfx).toBe("harddrop");
    expect(routeEvent(PRESETS.B, { type: "rotate" }).sfx).toBe("rotate");
    expect(routeEvent(PRESETS.B, { type: "chain", size: 4 }).sfx).toBe("chain");
  });

  it("only B/C are intensity-reactive", () => {
    expect(PRESETS.A.intensityReactive).toBe(false);
    expect(PRESETS.B.intensityReactive).toBe(true);
    expect(PRESETS.C.intensityReactive).toBe(true);
  });

  it("layerGain ramps 0 -> 1 across a reveal band", () => {
    expect(layerGain(0, [0.2, 0.6])).toBe(0);
    expect(layerGain(0.2, [0.2, 0.6])).toBe(0);
    expect(layerGain(0.4, [0.2, 0.6])).toBeCloseTo(0.5, 5);
    expect(layerGain(0.6, [0.2, 0.6])).toBe(1);
    expect(layerGain(1, [0.2, 0.6])).toBe(1);
  });

  it("reveals the VOX MORE slowly under A than C (per-clear bump + earlier band)", () => {
    // A's per-clear vertical bump is smaller than C's...
    const bump = (mix: AudioMix) =>
      PRESETS[mix].curve.perClear + 1 * PRESETS[mix].curve.perSquare;
    expect(bump("A")).toBeLessThan(bump("C"));
    // ...and after ONE typical clear, A's vox is quieter than C's (not saturated).
    const voxAfterOne = (mix: AudioMix) =>
      layerGain(bump(mix), PRESETS[mix].curve.vocalBand);
    expect(voxAfterOne("A")).toBeLessThan(voxAfterOne("C"));
  });

  it("advances segments faster under C than A for the same clears (horizontal)", () => {
    // weight per clear = 1 + squares + combo; segment index = floor(sum/threshold)
    const segAfter = (mix: AudioMix, clears: number, squares = 1, combo = 0) => {
      const per = PRESETS[mix].curve.clearsPerSegment;
      const weight = 1 + squares + combo;
      return Math.floor((clears * weight) / per);
    };
    // After 6 single clears, C should be on a LATER segment than A.
    expect(segAfter("C", 6)).toBeGreaterThan(segAfter("A", 6));
    // And a handful of clears must move the song forward at all under B.
    expect(segAfter("B", 6)).toBeGreaterThan(0);
  });

  it("every preset reaches full vox within a few clears (not subtle)", () => {
    for (const mix of ["A", "B", "C"] as AudioMix[]) {
      const c = PRESETS[mix].curve;
      let p = 0;
      // 4 typical clears (squares=1, combo=0)
      for (let i = 0; i < 4; i++) p = Math.min(1, p + c.perClear + c.perSquare);
      const vox = layerGain(p, c.vocalBand);
      expect(vox, `${mix} vox should be clearly audible after 4 clears`).toBeGreaterThan(0.5);
    }
  });
});
