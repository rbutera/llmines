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
];

describe("audio presets (v2.7)", () => {
  it("narrows mix strings, defaulting to B", () => {
    expect(asAudioMix("A")).toBe("A");
    expect(asAudioMix("C")).toBe("C");
    expect(asAudioMix("nonsense")).toBe(DEFAULT_MIX);
    expect(DEFAULT_MIX).toBe("B");
  });

  it("every ACTION makes some sound in every preset (rotate especially)", () => {
    for (const mix of ["A", "B", "C"] as AudioMix[]) {
      for (const ev of ACTIONS) {
        const r = routeEvent(PRESETS[mix], ev);
        const audible = r.sfx != null || r.blip === true;
        expect(audible, `${mix}/${ev.type} must be audible`).toBe(true);
      }
      const rot = routeEvent(PRESETS[mix], { type: "rotate" });
      expect(rot.sfx != null || rot.blip === true).toBe(true);
    }
  });

  it("CLEARS are SILENT in every preset (no routing — the core v2.7 rule)", () => {
    for (const mix of ["A", "B", "C"] as AudioMix[]) {
      const lc = routeEvent(PRESETS[mix], {
        type: "lineClear",
        squares: 4,
        combo: 1,
      });
      const ch = routeEvent(PRESETS[mix], { type: "chain", size: 5 });
      expect(lc.sfx, `${mix} lineClear must have no SFX`).toBeUndefined();
      expect(lc.blip, `${mix} lineClear must not blip`).not.toBe(true);
      expect(ch.sfx, `${mix} chain must have no SFX`).toBeUndefined();
      expect(ch.blip, `${mix} chain must not blip`).not.toBe(true);
    }
  });

  it("A is sparse on movement ad-libs; C fires an ad-lib on every action", () => {
    expect(routeEvent(PRESETS.A, { type: "move" }).sfx).toBeUndefined();
    for (const ev of ACTIONS) {
      expect(
        routeEvent(PRESETS.C, ev).sfx,
        `C/${ev.type} should map an ad-lib`,
      ).toBeDefined();
    }
  });

  it("B fires ad-libs on rotate, soft-drop, and hard-drop (lock)", () => {
    expect(routeEvent(PRESETS.B, { type: "rotate" }).sfx).toBe("rotate");
    expect(routeEvent(PRESETS.B, { type: "softDrop" }).sfx).toBe("softdrop");
    expect(routeEvent(PRESETS.B, { type: "lock" }).sfx).toBe("harddrop");
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

  it("vocal reveals SOONER under C than A (lower voxUnlockClears)", () => {
    expect(PRESETS.C.voxUnlockClears).toBeLessThan(PRESETS.A.voxUnlockClears);
  });

  it("advances FASTER under C than A for the same manifest gate (lower gateScale)", () => {
    const gate = 4;
    const effective = (mix: AudioMix) =>
      Math.round(gate * PRESETS[mix].gateScale);
    expect(effective("C")).toBeLessThan(effective("A"));
    // B sits between (or at) the extremes and still advances.
    expect(effective("B")).toBeGreaterThan(0);
    expect(effective("B")).toBeLessThanOrEqual(effective("A"));
  });
});
