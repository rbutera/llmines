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

  it("the four brief actions map DISTINCT one-shots in every preset", () => {
    // rotate / fast-drop (lock) / small-drop (softDrop) / clear-stage (lineClear)
    for (const mix of ["A", "B", "C"] as AudioMix[]) {
      const p = PRESETS[mix];
      expect(routeEvent(p, { type: "rotate" }).sfx, `${mix} rotate`).toBe("rotate");
      expect(routeEvent(p, { type: "lock" }).sfx, `${mix} fast-drop`).toBe("harddrop");
      expect(routeEvent(p, { type: "softDrop" }).sfx, `${mix} small-drop`).toBe("softdrop");
      expect(routeEvent(p, { type: "lineClear", squares: 1, combo: 0 }).sfx, `${mix} clear`).toBe(
        "match",
      );
    }
  });

  it("A stays sparse on plain MOVE (no ad-lib); C fires an ad-lib on every action", () => {
    // A: a plain move stays a procedural blip (the brief's four actions excluded).
    expect(routeEvent(PRESETS.A, { type: "move" }).sfx).toBeUndefined();
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

  it("unlocks the VOX sooner (fewer in-segment clears) under C than A", () => {
    // voxUnlockClears: A gentlest, C slammiest -> A needs MORE in-segment clearing.
    expect(PRESETS.A.curve.voxUnlockClears).toBeGreaterThan(PRESETS.C.curve.voxUnlockClears);
    expect(PRESETS.B.curve.voxUnlockClears).toBeGreaterThanOrEqual(PRESETS.C.curve.voxUnlockClears);
  });

  it("advances segments faster under C than A for the same clears (forward-only)", () => {
    // Threshold to reach segment N is N*clearsPerSegment; lower per = faster.
    expect(PRESETS.C.curve.clearsPerSegment).toBeLessThan(PRESETS.A.curve.clearsPerSegment);
    // A handful of typical clears (weight 2 each) must be enough to move B forward.
    const weightPerClear = 1 + 1 + 0;
    const clearsToStep = (mix: AudioMix) =>
      Math.ceil(PRESETS[mix].curve.clearsPerSegment / weightPerClear);
    expect(clearsToStep("B")).toBeLessThanOrEqual(4);
  });
});
