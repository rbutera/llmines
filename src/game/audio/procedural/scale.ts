/**
 * Pitch helpers for the procedural-audio spike. Everything the game plays is
 * drawn from ONE scale (C# natural minor) so no two events can clash — being
 * in-key is the harmony guarantee the spike leans on (action notes scheduled at
 * arbitrary moments still sound intentional).
 *
 * Pure data + pure functions. No Tone import here so it stays trivially testable
 * and importable in any environment.
 */

/** Semitone offsets of the natural-minor scale from the root. */
const NATURAL_MINOR_STEPS = [0, 2, 3, 5, 7, 8, 10] as const;

/** MIDI note number for F2 — the bass root the bed sits on. */
export const ROOT_MIDI = 37; // C#2

const NOTE_NAMES = [
  "C",
  "C#",
  "D",
  "D#",
  "E",
  "F",
  "F#",
  "G",
  "G#",
  "A",
  "A#",
  "B",
] as const;

/** Convert a MIDI note number to a Tone-compatible note name (e.g. 53 -> "F3"). */
export function midiToNote(midi: number): string {
  const name = NOTE_NAMES[((midi % 12) + 12) % 12]!;
  const octave = Math.floor(midi / 12) - 1;
  return `${name}${octave}`;
}

/**
 * The MIDI note `degree` scale-steps above {@link ROOT_MIDI}, where `degree`
 * may exceed the 7-note scale length (it wraps into higher octaves). Negative
 * degrees walk below the root. Always lands on an in-scale pitch.
 */
export function scaleDegreeToMidi(degree: number, baseMidi = ROOT_MIDI): number {
  const len = NATURAL_MINOR_STEPS.length;
  const octave = Math.floor(degree / len);
  const idx = ((degree % len) + len) % len;
  return baseMidi + octave * 12 + NATURAL_MINOR_STEPS[idx]!;
}

/** Convenience: an in-scale note name `degree` steps above the (optional) base. */
export function scaleNote(degree: number, baseMidi = ROOT_MIDI): string {
  return midiToNote(scaleDegreeToMidi(degree, baseMidi));
}

/**
 * Map a small integer "energy" (e.g. number of squares cleared, combo depth)
 * to a scale degree, clamped into a musically useful span so a huge clear does
 * not fly off into inaudible-high territory. Used to make bigger clears sound
 * brighter / higher without ever leaving the key.
 */
export function energyToDegree(energy: number, span = 14): number {
  return Math.max(0, Math.min(span, Math.round(energy)));
}
