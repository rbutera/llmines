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

  it("reveals the song MORE slowly under A than C for the same clears", () => {
    // Simulate N identical line-clears and compare resulting progression.
    const simulate = (mix: AudioMix, clears: number) => {
      const c = PRESETS[mix].curve;
      let p = 0;
      for (let i = 0; i < clears; i++) {
        p = Math.min(1, p + 4 * c.perSquare + 1 * c.perCombo);
      }
      return p;
    };
    const a = simulate("A", 3);
    const cc = simulate("C", 3);
    expect(a).toBeLessThan(cc);
  });
});
