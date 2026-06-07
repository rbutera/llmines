import { describe, expect, it } from "vitest";
import {
  energyToDegree,
  midiToNote,
  ROOT_MIDI,
  scaleDegreeToMidi,
  scaleNote,
} from "./scale";

describe("procedural-audio scale helpers", () => {
  it("converts MIDI to note names", () => {
    expect(midiToNote(60)).toBe("C4");
    expect(midiToNote(ROOT_MIDI)).toBe("C#2"); // ROOT_MIDI = 37
    expect(midiToNote(69)).toBe("A4");
  });

  it("walks the C# natural-minor scale by degree", () => {
    // C# minor from C#2: C# D# E F# G# A B (then C# up an octave)
    expect(scaleNote(0)).toBe("C#2");
    expect(scaleNote(1)).toBe("D#2");
    expect(scaleNote(2)).toBe("E2");
    expect(scaleNote(3)).toBe("F#2");
    expect(scaleNote(7)).toBe("C#3"); // octave up
  });

  it("wraps octaves and handles negative degrees", () => {
    expect(scaleDegreeToMidi(7)).toBe(ROOT_MIDI + 12);
    expect(scaleDegreeToMidi(-7)).toBe(ROOT_MIDI - 12);
  });

  it("clamps energy to a musical span", () => {
    expect(energyToDegree(-5)).toBe(0);
    expect(energyToDegree(3)).toBe(3);
    expect(energyToDegree(999)).toBe(14);
  });
});
