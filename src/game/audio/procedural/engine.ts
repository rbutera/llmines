/**
 * Interactive-audio ENGINE for LLMines — manifest-driven, N-tier, loop-quantized,
 * HEAT-DRIVEN model. The player's CLEARS build a continuous performance meter (`heat`)
 * that drives the song; the song does NOT advance on its own clock.
 *
 * ── The model in one paragraph ───────────────────────────────────────────────
 * Each song is a sequence of SEGMENTS. Every segment is pre-rendered at N CUMULATIVE
 * TIERS — tier0 = layer-1 bed (drums), tier1 = +bass, tier2 = +instruments, … the
 * top tier = the full mix incl. vocals. The tier count is read PER-SEGMENT from the
 * manifest (song1 = 4 tiers, song2 = 5), so the engine is tier-count-agnostic. The
 * tiers are pre-rendered cumulative renders (NOT live stem summing) — the no-hiss
 * mechanic: at steady state exactly ONE bed player has non-zero gain (≤2 across a
 * crossfade), so the runtime never sums many stems.
 *
 * A single continuous `heat` meter (0..1) — built by clears (scaled by squares +
 * combo), shed by clear-less loop passes — drives BOTH progressions, quantized to loop
 * boundaries (never an autonomous clock):
 *  - VERTICAL (cumulative tier) follows heat UP AND DOWN: the desired audible tier is
 *    `round(heat * maxTier)`, floored at the ≥2-layer min-audible floor, ceilinged at
 *    the segment's top. At each loop boundary the audible tier moves at most ONE step
 *    toward the desired tier (gradual, musical), so more heat reveals layers and a
 *    sustained drought sheds them. Crossfades use a constant-sum (linear) ramp —
 *    correct for these CUMULATIVE renders (the shared bed stays at full; true
 *    equal-power would +3dB-bump it).
 *  - CARRY-ACROSS: on segment ENTRY the start tier is set DIRECTLY from heat (the same
 *    `round(heat * maxTier)`, NOT reset, NOT capped at top-1), exempt from the one-step
 *    cap — so sustained heat keeps vocals playing across a transition (the no-vocal-cut
 *    fix); fallen heat enters the next segment thinner.
 *  - HORIZONTAL (segment advance) is HEAT-GATED, FORWARD-ONLY, ONE-STEP, IN-FLIGHT-
 *    LOCKED. A segment advances ONLY once its TOP tier (all layers) is AUDIBLE AND has
 *    been held one full loop — there is NO bare-heat threshold, so the song can never
 *    advance past unheard material. Below that gate the segment LOOPS in place. One
 *    advance per boundary; never backward. Advancing PAST the last (TERMINAL) segment
 *    fires {@link onSongComplete} (the host swaps to the other song via switchTrack — a
 *    skin switch).
 *
 * SSR-safe: nothing touches Tone until {@link InteractiveAudioEngine.unlock} runs on
 * a real user gesture (Start). Every Tone call is guarded so a failure degrades to
 * SILENCE — it must NEVER throw into the game. A missing/malformed manifest or
 * missing tier asset → silence.
 */

// TYPE-ONLY import: erased at compile time, so it carries NO runtime side effect.
// The `tone` barrel (index.js) eagerly runs `getContext()` at module-eval to build
// its deprecated `Transport` / `Destination` / `Master` singletons. A static value
// import of the barrel therefore CONSTRUCTS a real AudioContext the instant this
// module loads (at React mount, OFF any user gesture). Strict-autoplay browsers then
// permanently block that off-gesture context, so a later in-gesture resume produces
// no audible output — the recurring "AudioContext was not allowed to start" bug.
//
// We instead load Tone LAZILY, inside the unlock() user gesture (see `loadTone`), so
// the AudioContext is first constructed in-gesture and is allowed to play.
import type * as Tone from "tone";
import { routeEvent, type SfxName } from "./sfxRouting";

/** Runtime Tone module, populated lazily inside the unlock() gesture. */
type ToneModule = typeof Tone;
let ToneRT: ToneModule | undefined;

/**
 * Load the Tone module exactly once, inside a user gesture. The dynamic import
 * defers the barrel's eager `getContext()` singletons until this runs, so the
 * AudioContext is created in-gesture (strict-autoplay safe). Returns the module.
 */
async function loadTone(): Promise<ToneModule> {
  ToneRT ??= await import("tone");
  return ToneRT;
}

/**
 * The already-loaded Tone module. Safe to call only AFTER unlock()/the primer has
 * run loadTone() (which is true for every code path that touches Tone at runtime —
 * all gated behind `started`). Returns undefined if (somehow) called before load, so
 * callers degrade rather than throw.
 */
function tone(): ToneModule | undefined {
  return ToneRT;
}

/** Fallback BPM until a manifest is read. */
const FALLBACK_BPM = 110;
/** Default base path for the audio assets + the single manifest. */
const ASSET_BASE = "/audio";
/**
 * Tier/segment crossfade duration (seconds). The crossfade is constant-sum (linear) —
 * correct for the CUMULATIVE tier renders (the shared bed stays at full through the
 * fade); true equal-power would +3dB-bump the shared bed.
 */
const XFADE_S = 0.4;
/** A near-instant ramp (used for fresh bed entry). */
const SNAP_S = 0.012;
/** Voices per SFX name (round-robin pool so rapid same-type hits can overlap). */
const SFX_VOICES = 4;
/** Min spacing between two starts on the SFX pool so Tone never sees a tie. */
const SFX_RETRIGGER_EPSILON = 0.002;
/** Default velocity for the non-scaled action one-shots (rotate / soft-drop). */
const SFX_ACTION_VELOCITY = 0.85;
/** Fixed-hot velocity for a chain's clear-stage hit (bigger than any plain clear). */
const SFX_CHAIN_VELOCITY = 0.95;

/**
 * Clear-stage velocity from the clear size: a bigger clear sounds hotter (D4).
 * `clamp(0.6 + 0.1*squares, 0.6, 1.0)` — a 1-square clear = 0.7, a 4-square = 1.0.
 * Exported for the routing/velocity unit test.
 */
export function stageVelocityForSquares(squares: number): number {
  const s = Number.isFinite(squares) ? Math.max(0, squares) : 0;
  return Math.max(0.6, Math.min(1.0, 0.6 + 0.1 * s));
}

/**
 * Universal-lock velocity from the settle cause (D4): hard hits hardest, gravity /
 * soft are softer. An absent/unknown cause (neutral lock) uses the gravity floor.
 * Exported for the routing/velocity unit test.
 */
export function dropVelocityForCause(
  cause: "hard" | "soft" | "gravity" | undefined,
): number {
  switch (cause) {
    case "hard":
      return 1.0;
    case "soft":
      return 0.7;
    default: // "gravity" or undefined → the neutral floor
      return 0.6;
  }
}

// ── tone SFX (design D6) ─────────────────────────────────────────────────────
/** The default key applied when a song has no `key` in the manifest (design D6). */
const DEFAULT_KEY: { root: string; scale: ScaleName } = {
  root: "A",
  scale: "minor",
};
/** Semitone offsets (from the root) for each supported scale (design D6). */
const SCALE_DEGREES: Record<ScaleName, number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  pentatonicMinor: [0, 3, 5, 7, 10],
  pentatonicMajor: [0, 2, 4, 7, 9],
};
/** Pitch-class semitone for each note letter + accidentals (C = 0). */
const NOTE_PCS: Record<string, number> = {
  C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11,
};
/** A short subtle envelope for the tone synth (design D6). */
const TONE_ENVELOPE = { attack: 0.005, decay: 0.08, sustain: 0, release: 0.12 };
/** Tone-SFX velocities (design D6) — deliberately subtle against the music-led mix. */
const TONE_VEL_ROTATE = 0.3;
const TONE_VEL_SOFTDROP = 0.25;

/**
 * Parse a note name ("A", "C#", "Eb", "F#3") to a MIDI number. A bare letter (no
 * octave) defaults to octave 3 (a mid register). Returns the MIDI of the root pitch
 * class at that octave; the scale builder spreads degrees up from it. Defaults to
 * A3 (57) on any malformed input so the tone path never throws.
 */
function noteNameToMidi(name: string): number {
  const m = /^([A-Ga-g])([#b]?)(-?\d+)?$/.exec(name?.trim() ?? "");
  if (!m) return 57; // A3 fallback
  const letter = m[1]!.toUpperCase();
  const accidental = m[2] === "#" ? 1 : m[2] === "b" ? -1 : 0;
  const octave = m[3] != null ? parseInt(m[3], 10) : 3;
  const pc = NOTE_PCS[letter];
  if (pc == null) return 57;
  // MIDI: C-1 = 0, so C{oct} = (oct + 1) * 12.
  return (octave + 1) * 12 + pc + accidental;
}

/** MIDI number → frequency in Hz (A4 = 69 = 440 Hz). */
function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/**
 * Build the in-key note set (MIDI numbers) for a resolved key across ~2 octaves up
 * from the root (design D6). The first entry is the root; degrees follow in order,
 * then the same degrees one octave up, so callers can pick "the 5th", "degree 2",
 * "the root one octave down", etc. by index relative to the per-octave length.
 */
function buildScaleMidis(key: { root: string; scale: ScaleName }): number[] {
  const rootMidi = noteNameToMidi(key.root);
  const degrees = SCALE_DEGREES[key.scale] ?? SCALE_DEGREES.minor;
  const midis: number[] = [];
  for (let oct = 0; oct < 2; oct++) {
    for (const d of degrees) midis.push(rootMidi + d + 12 * oct);
  }
  return midis;
}

// ── heat-driven tuning (the named knobs — design D1-D4) ──────────────────────
//
// The progression is driven by a continuous `heat` meter (0..1): clearing builds
// heat, a clear-less loop pass sheds it, and the audible cumulative tier follows heat
// UP and DOWN (one step per loop boundary). A segment advances only once its TOP tier
// has been built AND held a full loop — there is NO bare-heat advance threshold, so
// the song can never advance past unheard material (design D4).
//
/**
 * Heat gain for a clear, scaled by squares + combo (design D1):
 *   gain = HEAT_GAIN_BASE + HEAT_GAIN_SQUARE*squares + HEAT_GAIN_COMBO*comboStep
 * evaluated against the loop-boundary cadence + the manifest content (song1 = 12
 * segments × 4 tiers, song2 = 10 × 5):
 *  - a typical no-streak 2-square clear = 0.06 + 0.05 + 0 = 0.11;
 *  - a strong 4-square single-sweep harvest = 0.06 + 0.10 + 0 = 0.16; on a ×3 streak
 *    (comboStep 2) = 0.20.
 * So a steady clearer reaches full layers (heat 1.0 → top tier) in ~9-10 clears; a
 * strong run in ~5-6. These are Rai's ear-check, not a blocker — easy to retune.
 */
const HEAT_GAIN_BASE = 0.06;
/** Heat per square cleared this pass (design D1). */
const HEAT_GAIN_SQUARE = 0.025;
/** Heat per combo streak step (`comboMultiplier - 1`) this pass (design D1). */
const HEAT_GAIN_COMBO = 0.02;
/**
 * Heat shed by ONE clear-less loop pass (design D2). Deliberately BELOW a typical
 * clear gain (0.11, a no-streak 2-square clear — D1) so the alternation
 * clear→empty-pass→clear nets slightly POSITIVE (+0.11 − 0.08 = +0.03 per cycle) and
 * does NOT thrash a layer up and down. A layer only sheds under a SUSTAINED drought:
 * with maxTier = 3 (song1) the tier step is 1/3 ≈ 0.333 of heat (D3), so from topped-
 * out heat it takes ~5 consecutive clear-less passes to shed one layer; for song2
 * (maxTier = 4, step 0.25) ~3-4 passes. There is NO `ADVANCE_HEAT` constant — the
 * advance is gated on the top tier being audible + held a loop, not a heat threshold
 * (design D4: a heat threshold below 1.0 could fire before the top tier is audible —
 * song2's top reveals only at heat ≥ 0.875 — and skip unheard vocals).
 */
const HEAT_DECAY_PER_EMPTY_PASS = 0.08;
/**
 * MINIMUM AUDIBLE LAYERS — the never-drop-below floor, in CUMULATIVE LAYERS (not a
 * tier index). The tiers are cumulative: tier0 = 1 layer (drums+perc), tier1 = 2
 * layers (+bass), tier2 = 3 (+synth/gtr/fx), … so N layers == tier index N-1. A bare
 * opening (≈1 layer) felt too thin in playtest, so we hold the audible minimum at
 * 2 LAYERS ALWAYS: at game start, on every segment entry, and as the floor the sticky
 * reveal never drops below. {@link tierFloorFor} converts this to a tier index per
 * segment (= MIN_AUDIBLE_LAYERS - 1), clamped down for any segment that has fewer
 * tiers than that (so a 1-tier segment still works).
 */
const MIN_AUDIBLE_LAYERS = 2;
/**
 * The minimum-audible entry FLOOR as a TIER INDEX (= MIN_AUDIBLE_LAYERS - 1): the
 * lowest tier a freshly-entered (or heat-shed) segment can sit at, so the opening
 * bars are never bare (and the very first segment of the song still has bed + bass to
 * hear). On a mid-song advance the carry-across tier (round(heat * maxTier)) is
 * honoured on top of this; this is the hard lower bound. 1 = "+bass" (2 cumulative
 * layers), clamped down for any segment with fewer tiers.
 */
const TIER_ENTRY_FLOOR = MIN_AUDIBLE_LAYERS - 1;

/** Clamp a value to the unit range [0, 1]; a non-finite value maps to 0. */
function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Segment role drives loop-vs-rideout behavior. */
export type SegmentType = "LOOPER" | "PROGRESSION" | "TERMINAL";

/**
 * A TRACK is one full soundtrack. In the manifest-driven model a track is
 * identified by its `id`; `base` is retained for back-compat with the skin/host
 * seam (skins build TrackBundles) but the segment data is resolved from the single
 * `/audio/manifest.json` by song id (with a `base`→song-dir fallback).
 */
export interface TrackBundle {
  id: string;
  base: string;
}

/** Song 1 — the default track. */
export const TRACK_SONG1: TrackBundle = { id: "song1", base: ASSET_BASE };

/** Build a TrackBundle for a per-song asset directory (e.g. "/audio/song2"). */
export function makeTrack(id: string, base: string): TrackBundle {
  return { id, base };
}

/**
 * A coarse "what just happened" describing one game action, fed to the engine.
 *
 * `lock.cause` (additive, audio-truth D1/D4): the settle cause carried from the
 * deriver's `lastLock.cause` so the universal lock thud scales by it (hard hits
 * hardest). Optional for back-compat — an absent cause routes a neutral lock.
 *
 * `lineClear.combo` now carries the REAL streak offset (`comboMultiplier - 1`,
 * 0 = no streak) from truthful pass telemetry, so the engine's existing
 * `1 + squares + combo` clear-weight needs no change (audio-truth D1/D2).
 */
export type AudioEvent =
  | { type: "move" }
  | { type: "rotate" }
  | { type: "softDrop" }
  | { type: "lock"; cause?: "hard" | "soft" | "gravity" }
  | { type: "lineClear"; squares: number; combo: number }
  | { type: "chain"; size: number }
  | { type: "match"; squares: number };

/**
 * SFX delivery mode (design D6). `"tone"` (default) plays synthesised in-key tones;
 * `"sample"` plays the existing recorded per-segment one-shots. Switchable at runtime.
 */
export type SfxMode = "tone" | "sample";

// ── manifest shape (data contract) ──────────────────────────────────────────

/**
 * Cumulative tier files, `tier0..tierN-1`. The tier COUNT is per-segment (song1 = 4,
 * song2 = 5), so this is an index map rather than a fixed-arity struct.
 */
type ManifestTiers = Record<string, string>;

interface ManifestSegment {
  id: string;
  type: SegmentType;
  bars: number;
  /** Full file duration (includes the play-through spill tail for non-LOOPER). */
  lengthSeconds: number;
  /**
   * Spill-free whole-bar loop length (= barSeconds * bars). Looping players set
   * loopEnd to this and the loop tick fires on it, so tick and audio wrap agree.
   * Optional for back-compat (fallback: barSeconds*bars, then lengthSeconds).
   */
  barWindowSeconds?: number;
  character?: string;
  tiers: ManifestTiers;
  /**
   * OPTIONAL per-segment SFX palette (audio-truth D5), same shape as the song-level
   * `sfx`. When present, the engine plays THESE samples while this segment is active
   * (action sounds belong to what's currently playing — an intro's ad-libs differ
   * from a beat-drop's). Resolution falls back to the song-level `sfx`, then silence
   * (see {@link segmentSfxUrlFor}). Absent on every current manifest → the song-level
   * set is used unchanged (no behaviour change without new assets).
   */
  sfx?: ManifestSfx;
}
interface ManifestSfx {
  move?: string;
  rotate?: string;
  softdrop?: string;
  drop?: string;
  stage?: string;
}
/** Scales the tone palette is built from (design D6). */
type ScaleName = "major" | "minor" | "pentatonicMinor" | "pentatonicMajor";
/** An optional per-song musical key for the in-key tone SFX (design D6). */
interface ManifestKey {
  root: string;
  scale: ScaleName;
}
interface ManifestSong {
  id: string;
  title?: string;
  tempo: number;
  barSeconds: number;
  segments: ManifestSegment[];
  sfx?: ManifestSfx;
  /**
   * OPTIONAL per-song musical key for the in-key tone SFX (design D6). When absent the
   * engine applies {@link DEFAULT_KEY}, so the committed manifest works unchanged.
   */
  key?: ManifestKey;
}
interface AudioManifest {
  version?: string;
  songs: ManifestSong[];
}

/** Tier index — a non-negative integer (0 = bed, up to the segment's top tier). */
type Tier = number;

/**
 * The ordered tier keys for a segment (`tier0`, `tier1`, …) sorted by index, however
 * many it has. Filters to strictly `tierN` keys so a stray manifest field is ignored.
 */
function tierKeys(meta: ManifestSegment): string[] {
  return Object.keys(meta.tiers)
    .filter((k) => /^tier\d+$/.test(k) && typeof meta.tiers[k] === "string")
    .sort((a, b) => Number(a.slice(4)) - Number(b.slice(4)));
}

/**
 * One LOADED segment: a tier player + gain per tier (only the active segment's are
 * loaded; the rest are lazy). The arrays are sized to THIS segment's tier count.
 */
interface LoadedSegment {
  meta: ManifestSegment;
  /** Ordered tier file keys (tier0..tierN-1) for this segment. */
  tierKeys: string[];
  /** One slot per tier key (length = tierKeys.length). */
  tierPlayers: (Tone.Player | undefined)[];
  tierGains: (Tone.Gain | undefined)[];
  loaded: boolean;
}

/** Number of tiers a (loaded) segment has. */
function tierCountOf(seg: LoadedSegment): number {
  return seg.tierKeys.length;
}

/**
 * Resolve the {move,rotate,softdrop,drop,stage} SfxName set from a manifest sfx
 * map. `SfxName` now matches the `ManifestSfx` keys ONE-TO-ONE (the prior
 * harddrop→drop quirk is gone), so this is a direct lookup.
 */
function sfxUrlFor(
  name: SfxName,
  sfx: ManifestSfx | undefined,
  base: string,
): string | undefined {
  if (!sfx) return undefined;
  const rel = sfx[name];
  return rel ? `${base}/${rel}` : undefined;
}

/**
 * Resolve one action SFX url for a SEGMENT (audio-truth D5): the segment's own
 * `sfx` entry if present, else the song-level `sfx`, else undefined (silence). An
 * old manifest (no `segments[].sfx`) resolves every action to the song-level set
 * exactly as before — byte-identical behaviour without new assets.
 */
function segmentSfxUrlFor(
  name: SfxName,
  seg: ManifestSegment | undefined,
  song: ManifestSong | undefined,
  base: string,
): string | undefined {
  return (
    sfxUrlFor(name, seg?.sfx, base) ?? sfxUrlFor(name, song?.sfx, base)
  );
}

/** A round-robin pool of identical one-shot voices for one SFX name. */
interface SfxVoicePool {
  voices: Tone.Player[];
  /** Next voice index to use (round-robin). */
  next: number;
  /** Last scheduled start time, for the monotonic-nudge. */
  lastStart: number;
}

/**
 * Owns all Tone nodes + the Transport. One instance per GameShell. All public
 * methods are no-ops before {@link unlock}.
 */
export class InteractiveAudioEngine {
  private started = false;
  private muted = false;
  private volume = 0.5;
  private bpm = FALLBACK_BPM;

  private master?: Tone.Gain;

  /** Teardown for the document-level first-interaction resume primer. */
  private removeResumePrimer?: () => void;

  constructor() {
    this.installResumePrimer();
  }

  /**
   * Belt-and-braces: a one-time document-level listener that resumes audio on the
   * FIRST user interaction anywhere on the page (pointerdown / keydown / touchstart),
   * then removes itself. This guarantees the AudioContext is constructed + resumed in
   * response to a genuine user gesture even if the Start handler's own resume didn't
   * take (e.g. the click was synthesized, or activation lapsed across an await). It
   * loads Tone lazily — the import (and the barrel's eager getContext singletons) thus
   * fire INSIDE this gesture, so strict-autoplay browsers allow the context. SSR-safe.
   */
  private installResumePrimer(): void {
    if (typeof window === "undefined" || typeof document === "undefined") return;
    let done = false;
    const events: Array<keyof DocumentEventMap> = [
      "pointerdown",
      "keydown",
      "touchstart",
    ];
    const prime = () => {
      if (done) return;
      done = true;
      this.removeResumePrimer?.();
      this.removeResumePrimer = undefined;
      // Fire-and-forget: resume the global Tone context (the same one unlock() plays
      // through) so any interaction unblocks audio. Created/resumed in-gesture here.
      void (async () => {
        try {
          const Tone = await loadTone();
          await Tone.getContext().resume();
          await Tone.start();
        } catch {
          /* degrade silently — unlock() is still the primary path */
        }
      })();
    };
    for (const ev of events) {
      document.addEventListener(ev, prime, { once: false, passive: true });
    }
    this.removeResumePrimer = () => {
      for (const ev of events) document.removeEventListener(ev, prime);
    };
  }

  private manifest?: AudioManifest;
  private song?: ManifestSong;
  /**
   * Load generation token. Bumped whenever the segment bank is being torn down + rebuilt
   * (a {@link resetForNewGame}, a switchTrack, or a dispose). A `loadSong`/`loadSegment`
   * call captures it and, after each await, bails (disposing any just-built node) if the
   * token has since moved — so an in-flight load from a PREVIOUS game/track can never
   * start orphan players, stomp `this.segments`/`bedReady`, or reschedule a loop tick
   * into the new bank. (The `currentTrack.id` guard alone misses a reload of the SAME
   * track, which is exactly what a new-game reset does.)
   */
  private loadGen = 0;
  private currentTrack: TrackBundle = TRACK_SONG1;
  private switching = false;
  private bedReady = false;

  /**
   * Banks RETIRED by a successful switchTrack but whose disposal is still scheduled in
   * an `afterSettle` (they keep playing through the crossfade). The cleanup closure is
   * cancellable (clearSettleEvents), so the OUTGOING bank is also tracked here — a
   * superseding resetForNewGame/dispose that cancels the settle callbacks drains this
   * list to dispose those banks rather than orphan them (their players/SFX are detached
   * from `this.segments`/`this.sfxPoolsBySegment` by the swap). Each entry is removed by
   * whichever path disposes it first (idempotent — no double-dispose).
   */
  private pendingRetire: Array<{
    segments: LoadedSegment[];
    sfx: Map<number, Partial<Record<SfxName, SfxVoicePool>>>;
  }> = [];

  /** All segments of the active song; only `loaded` ones have live players. */
  private segments: LoadedSegment[] = [];
  private segmentIndex = 0;
  private maxSegmentReached = 0;

  // ── VERTICAL (heat-driven tier) state for the ACTIVE segment ─────────────────
  /** The currently-audible cumulative tier of the active segment. */
  private tier: Tier = 0;
  /** The tier armed for the next boundary swap (one step toward the heat target). */
  private armedTier: Tier = 0;
  /**
   * The tier the active segment SHOULD be audible at (from the last enterSegment). Used
   * to reconcile gain when a segment's players finish loading AFTER it became active
   * (advance-into-unloaded), so the segment isn't silent for its window.
   */
  private targetTier: Tier = 0;
  /** A tier crossfade is mid-flight (between two tier files of the same segment). */
  private tierFading = false;

  // ── HEAT (the song-level progression quantity, design D1) ────────────────────
  /**
   * Continuous performance meter (0..1), the single carry-across progression state.
   * A clear raises it (scaled by squares + combo, design D1); a clear-less loop pass
   * sheds it (design D2). The audible tier follows heat UP and DOWN (design D3); the
   * carry-across sets the entry tier directly from heat (design D5). NOT reset per
   * segment — it is what carries vocals across a transition (the no-vocal-cut fix).
   */
  private heat = 0;
  /**
   * Whether ANY clear (or chain) arrived since the previous loop boundary. Set true in
   * {@link onClear}; read + reset at the boundary to decide decay (design D2).
   */
  private clearedSinceBoundary = false;

  // ── SFX selector + lazy tone synth (design D6) ───────────────────────────────
  /** Active SFX mode (default `"tone"`); switchable at runtime via setSfxMode. */
  private sfxMode: SfxMode = "tone";
  /**
   * The lazily-constructed tone synth (a Tone.PolySynth). Built INSIDE the unlock
   * gesture / on first tone use (never at module-eval — autoplay rule). Undefined until
   * first use; a build failure leaves it undefined and the tone path degrades to silence.
   */
  private toneSynth?: Tone.PolySynth;
  /** True once we have ATTEMPTED to build the tone synth (so a failure isn't retried hot). */
  private toneSynthTried = false;
  /** The in-key note set (MIDI) for the active song, rebuilt per song from its key. */
  private scaleMidis: number[] = buildScaleMidis(DEFAULT_KEY);
  /** Degrees-per-octave of the active scale (so callers index degrees, not raw notes). */
  private scaleDegreeCount = SCALE_DEGREES[DEFAULT_KEY.scale].length;

  // ── HORIZONTAL (heat-gated advance) state ────────────────────────────────────
  /**
   * Per-segment flag (reset on every {@link enterSegment}): the segment's TOP tier
   * has been AUDIBLE for at least one full loop. Set true on the boundary AFTER the
   * one that first makes `this.tier === top`, so the top mix (vocals) is heard for a
   * whole loop before the advance can fire — see {@link shouldAdvance}. Reset on
   * entry so the advance gate re-arms per segment (the new segment must reach AND hold
   * ITS top a loop before it can advance), which is correct: it gates the advance, not
   * the carry (design D4/D5).
   */
  private topHeldSinceBoundary = false;
  /** A segment hand-off crossfade is mid-flight (the in-flight advance lock). */
  private transitionInFlight = false;
  private transitionToken = 0;
  /** Transport event ids scheduled for the active loop quantize (cancelled on reset). */
  private scheduledEvents: number[] = [];
  /**
   * Transport event ids for in-flight settle callbacks (disposals / state resets).
   * SEPARATE from `scheduledEvents` so a loop-tick reschedule (`clearScheduled`) can't
   * cancel a pending disposal or reset (Blocker 3). Cleared only on full teardown.
   */
  private settleEvents: number[] = [];
  /**
   * The setTimeout fallback ids paired with {@link settleEvents}. The transport `clear`
   * can't cancel a `window.setTimeout`, so these are tracked separately and cancelled on
   * reset/dispose so a settle fallback can't mutate state after the bank it targeted is
   * gone.
   */
  private settleTimeouts: Array<ReturnType<typeof setTimeout>> = [];
  /** Generation token for the self-rescheduling loop tick (bumped on every reschedule). */
  private loopTickGen = 0;

  onSongComplete?: () => void;
  private songCompleted = false;

  // ── public config ───────────────────────────────────────────────────────────

  setInitialTrack(track: TrackBundle): boolean {
    if (this.started) return false;
    this.currentTrack = track;
    return true;
  }

  getCurrentTrackId(): string {
    return this.currentTrack.id;
  }

  /** The active loaded segment, or undefined. */
  private active(): LoadedSegment | undefined {
    return this.segments[this.segmentIndex];
  }

  /** The highest tier index a segment can reach (= tierCount - 1, ≥0). */
  private maxTier(seg: LoadedSegment | undefined): number {
    if (!seg) return 0;
    return Math.max(0, tierCountOf(seg) - 1);
  }

  /**
   * The hard minimum-audible tier index FOR THIS SEGMENT (the "always ≥2 layers"
   * floor): {@link TIER_ENTRY_FLOOR} (= MIN_AUDIBLE_LAYERS − 1), clamped DOWN to the
   * segment's own ceiling so a segment with fewer tiers than the floor still works
   * (a 1-tier segment floors at tier0). This is the single source of truth for the
   * never-drop-below floor, applied at entry, on every reveal, and on reconcile.
   */
  private tierFloorFor(seg: LoadedSegment | undefined): number {
    return Math.min(this.maxTier(seg), TIER_ENTRY_FLOOR);
  }

  /**
   * The DESIRED audible tier for a segment from the current heat (design D3/D5):
   * `round(heat * maxTier)`, bounded below by the min-audible floor and above by the
   * segment's ceiling. This is the single heat→tier mapping used by both the within-
   * segment reveal/shed ({@link evaluateTier}, capped to one step per boundary) and the
   * segment-entry carry ({@link enterSegment}, exempt from the one-step cap). A
   * non-finite heat maps to the floor (clamp01 in onClear/decay keeps heat finite, this
   * is belt-and-braces).
   */
  private heatTierFor(seg: LoadedSegment | undefined): number {
    const top = this.maxTier(seg);
    const floor = this.tierFloorFor(seg);
    const h = Number.isFinite(this.heat) ? this.heat : 0;
    const desired = Math.round(h * top);
    return Math.max(floor, Math.min(top, desired));
  }

  /**
   * The spill-free whole-bar LOOP length of a segment, in seconds — the length the
   * audio wraps at (and the loop tick fires at), NOT the file duration. Prefer the
   * manifest's `barWindowSeconds`; fall back to `barSeconds * bars`; last resort the
   * file length. Always a positive finite number.
   */
  private barWindowSeconds(seg: LoadedSegment): number {
    const meta = seg.meta;
    const bw = meta.barWindowSeconds;
    if (typeof bw === "number" && bw > 0) return bw;
    const barSeconds = this.song?.barSeconds;
    if (typeof barSeconds === "number" && barSeconds > 0 && meta.bars > 0) {
      return barSeconds * meta.bars;
    }
    return meta.lengthSeconds > 0 ? meta.lengthSeconds : 1;
  }

  /**
   * Live audio state for the test probe (mechanics are HEADLESS-VERIFIABLE).
   * `activeStems` = count of bed tier players at non-zero gain (proves the no-hiss
   * bound). Gains are READ (not targets) so a verification proves ramps moved.
   *
   * Heat model: `heat` = the continuous performance meter (0..1) that drives the
   * audible tier up/down + the carry-across; `tier` = the currently-audible
   * cumulative tier; `tierCount` = the active segment's N. The old numeric
   * `segmentScore` is REMOVED (design D7) — a numeric alias would silently back the
   * replaced contract's zombie assertions. `intensity` stays aliased to `heat` (it
   * always meant "how hot"). `sfxMode` reports the active SFX selector (design D6).
   */
  getAudioState(): {
    segmentIndex: number;
    maxSegmentReached: number;
    segmentCount: number;
    transitionInFlight: boolean;
    heat: number;
    tier: Tier;
    armedTier: Tier;
    tierCount: number;
    layerGains: number[];
    activeStems: number;
    trackId: string;
    bpm: number;
    sfxMode: SfxMode;
    /** @deprecated back-compat alias: = heat (the performance meter). */
    intensity: number;
    /** @deprecated back-compat with the old probe consumers. */
    activeRole: string | null;
    /** @deprecated back-compat. */
    recordedBedActive: boolean;
    /** @deprecated back-compat: top tier audible. */
    voxUnlocked: boolean;
    /** @deprecated back-compat: top tier armed. */
    voxArmed: boolean;
    /** @deprecated back-compat: {bed,vox}-shaped view of the active tier gains. */
    bedVox: { bed: number; vox: number };
  } {
    const read = (g: Tone.Gain | undefined): number => {
      try {
        return g ? g.gain.value : 0;
      } catch {
        return 0;
      }
    };
    const a = this.active();
    const count = a ? tierCountOf(a) : 0;
    const gains = a ? a.tierGains.map((g) => read(g)) : [];
    // count non-zero-gain bed players across ALL segments (proves the bound).
    let activeStems = 0;
    for (const seg of this.segments) {
      for (let t = 0; t < seg.tierPlayers.length; t++) {
        if (seg.tierPlayers[t] && read(seg.tierGains[t]) > 0.001) activeStems++;
      }
    }
    const top = count > 0 ? count - 1 : 0;
    const bedGain = gains.slice(0, Math.max(1, count - 1)).reduce((a2, g) => a2 + g, 0);
    const voxGain = count > 0 ? (gains[top] ?? 0) : 0;
    return {
      segmentIndex: this.segmentIndex,
      maxSegmentReached: this.maxSegmentReached,
      segmentCount: this.segments.length,
      transitionInFlight: this.transitionInFlight,
      heat: this.heat,
      tier: this.tier,
      armedTier: this.armedTier,
      tierCount: count,
      layerGains: gains,
      activeStems,
      trackId: this.currentTrack.id,
      bpm: this.bpm,
      sfxMode: this.sfxMode,
      intensity: this.heat,
      activeRole: a?.meta.type ?? null,
      recordedBedActive: this.bedReady,
      voxUnlocked: this.tier >= top && count > 0,
      voxArmed: this.armedTier >= top && count > 0,
      bedVox: { bed: Math.min(1, bedGain), vox: voxGain },
    };
  }

  // ── lifecycle ────────────────────────────────────────────────────────────────

  async unlock(): Promise<void> {
    if (this.started) return;
    if (typeof window === "undefined") return;
    try {
      // Load Tone INSIDE the gesture. The dynamic import defers the barrel's eager
      // `getContext()` singletons until now, so the AudioContext is first constructed
      // in response to this user gesture — strict-autoplay browsers then allow it.
      const Tone = await loadTone();
      // CREATE + RESUME the context. getContext() lazily constructs the Context here
      // (or returns the one the first-interaction primer already created in-gesture);
      // resume() then unblocks it.
      const ctx = Tone.getContext();
      const resumed = ctx.resume();
      await resumed;
      await Tone.start();
      this.master = new Tone.Gain(this.volume).toDestination();
      // Build the tone synth INSIDE this gesture (autoplay-safe). It is also lazily
      // built on first tone use (ensureToneSynth) as a belt-and-braces fallback.
      this.ensureToneSynth();
      const t = Tone.getTransport();
      t.bpm.value = this.bpm;
      t.swing = 0;
      t.start();
      this.started = true;
      this.applyVolume();
      void this.loadSong(this.currentTrack);
    } catch {
      this.started = false;
    }
  }

  // ── manifest + lazy segment load ───────────────────────────────────────────

  private async loadManifest(): Promise<AudioManifest | undefined> {
    try {
      // `no-cache` = always REVALIDATE with the server (ETag) before using a cached
      // copy. `force-cache` was the bug: a returning browser kept a STALE manifest
      // from a previous deploy, whose (now-deleted) opus paths 404'd → silent SFX.
      // The manifest is tiny; revalidating each load guarantees the served cut's
      // asset paths always exist.
      const res = await fetch(`${ASSET_BASE}/manifest.json`, {
        cache: "no-cache",
      });
      if (!res.ok) return undefined;
      const m = (await res.json()) as AudioManifest;
      if (!m || !Array.isArray(m.songs) || m.songs.length === 0)
        return undefined;
      return m;
    } catch {
      return undefined;
    }
  }

  /** Resolve a song from the manifest for a track (by id, then base dir). */
  private resolveSong(
    manifest: AudioManifest,
    track: TrackBundle,
  ): ManifestSong | undefined {
    const byId = manifest.songs.find((s) => s.id === track.id);
    if (byId) return byId;
    const dir = track.base.split("/").filter(Boolean).pop();
    const byDir = manifest.songs.find((s) => s.id === dir);
    return byDir ?? manifest.songs[0];
  }

  /** Build the empty (unloaded) segment list for a song, sized per-segment to N tiers. */
  private buildSegments(song: ManifestSong): LoadedSegment[] {
    return song.segments.map((meta) => {
      const keys = tierKeys(meta);
      return {
        meta,
        tierKeys: keys,
        tierPlayers: keys.map(() => undefined),
        tierGains: keys.map(() => undefined),
        loaded: false,
      };
    });
  }

  /**
   * Lazily load a segment's N tier players (idempotent). Each tier is a synced loop
   * at gain 0; the active tier is gained up by the caller. A failed fetch leaves that
   * tier silent (degrade, never throw).
   */
  private async loadSegment(index: number): Promise<void> {
    const master = this.master;
    const seg = this.segments[index];
    if (!master || !seg || seg.loaded) return;
    const gen = this.loadGen; // capture: a reset/switch/dispose bumps this
    seg.loaded = true; // claim early so concurrent prefetch doesn't double-load
    const tierUrls = seg.tierKeys.map(
      (k) => `${ASSET_BASE}/${seg.meta.tiers[k]}`,
    );
    await Promise.all(
      tierUrls.map(async (url, t) => {
        try {
          const gain = new ToneRT!.Gain(0).connect(master);
          const player = await this.loadPlayer(url);
          // If a reset/switch superseded this load while it was in flight, the segment
          // bank it targeted is gone — dispose what we just built so it can't orphan a
          // live player or stomp the new bank, and bail.
          if (gen !== this.loadGen || this.segments[index] !== seg) {
            try {
              player?.dispose();
            } catch {
              // ignore
            }
            gain.dispose();
            return;
          }
          if (player) {
            player.loop = true;
            // Loop the SPILL-FREE bar window, not the whole file.
            try {
              player.loopStart = 0;
              player.loopEnd = this.barWindowSeconds(seg);
            } catch {
              // older Tone or a degraded player — fall back to whole-file loop
            }
            player.connect(gain);
            this.startTierPlayer(player, seg);
            seg.tierPlayers[t] = player;
            seg.tierGains[t] = gain;
          } else {
            gain.dispose();
          }
        } catch {
          // tier missing — that tier just won't play
        }
      }),
    );
    // A reset/switch may have landed while the tier loads were in flight — don't
    // reconcile gain into a superseded bank.
    if (gen !== this.loadGen || this.segments[index] !== seg) return;
    // If this segment became active before its players finished loading (advance-into-
    // unloaded / loop-back onto a disposed seg), the entry ramp landed on undefined
    // gains. Now the players exist — re-apply the target tier so it isn't silent.
    this.reconcileActiveGain(index);
  }

  /**
   * Start a looping tier player so it BOTH triggers immediately AND stays phase-
   * aligned to the loop grid. Started UNSYNCED with a buffer offset equal to the
   * current transport phase into the loop window, so every tier of every segment
   * fires deterministically and phase-correct. player.loop + loopStart/loopEnd keep
   * it cycling on the spill-free bar window thereafter.
   */
  private startTierPlayer(player: Tone.Player, seg: LoadedSegment): void {
    try {
      const window = this.barWindowSeconds(seg);
      let phase = 0;
      try {
        const ts = ToneRT!.getTransport().seconds;
        if (Number.isFinite(ts) && window > 0) {
          phase = ((ts % window) + window) % window;
        }
      } catch {
        phase = 0;
      }
      player.start(undefined, phase);
    } catch {
      try {
        player.start();
      } catch {
        // ignore
      }
    }
  }

  private loadPlayer(url: string): Promise<Tone.Player | null> {
    return new Promise((resolve) => {
      try {
        const p = new ToneRT!.Player({
          url,
          onload: () => resolve(p),
          onerror: () => {
            try {
              p.dispose();
            } catch {
              // ignore
            }
            resolve(null);
          },
        });
      } catch {
        resolve(null);
      }
    });
  }

  /** Load the song bank: manifest → song → load intro segment → enter it. */
  private async loadSong(track: TrackBundle): Promise<void> {
    const master = this.master;
    if (!master) return;
    const gen = this.loadGen; // a reset/switch/dispose bumps this; bail if superseded
    const manifest = await this.loadManifest();
    if (gen !== this.loadGen) return; // a reset/switch landed during the fetch
    if (!manifest) return; // degrade to silence
    const song = this.resolveSong(manifest, track);
    if (!song || song.segments.length === 0) return;
    if (this.currentTrack.id !== track.id) return; // a switch superseded us

    this.manifest = manifest;
    this.song = song;
    const built = this.buildSegments(song);
    this.segments = built;
    this.segmentIndex = 0;
    this.maxSegmentReached = 0;
    this.heat = 0;
    this.clearedSinceBoundary = false;
    this.applyTempo(song);
    this.applyKey(song);

    // Initial load = intro tiers only (lazy per-segment).
    await this.loadSegment(0);
    if (gen !== this.loadGen || this.currentTrack.id !== track.id) {
      // Superseded mid-load. Dispose the bank THIS call built (the captured `built`),
      // never `this.segments` — a newer loadSong may already have installed a fresh bank
      // there, and disposing that would silence the live song.
      for (const seg of built) this.disposeLoaded(seg);
      return;
    }
    this.enterSegment(0, /*fresh*/ true);
    this.bedReady = true;
    void this.prefetch(1);
    this.scheduleLoopTick();
  }

  private applyTempo(song: ManifestSong): void {
    this.bpm = song.tempo > 0 ? song.tempo : this.bpm;
    try {
      ToneRT!.getTransport().bpm.value = this.bpm;
    } catch {
      // ignore
    }
  }

  /**
   * Resolve the song's tone key (design D6): its manifest `key` if present + valid,
   * else {@link DEFAULT_KEY}. Rebuilds the in-key note set + degree count so tones play
   * in the right key. Called when a song becomes active (loadSong / switchTrack).
   */
  private applyKey(song: ManifestSong): void {
    const k = song.key;
    const scale: ScaleName =
      k && k.scale in SCALE_DEGREES ? k.scale : DEFAULT_KEY.scale;
    const root = k && typeof k.root === "string" && k.root ? k.root : DEFAULT_KEY.root;
    this.scaleMidis = buildScaleMidis({ root, scale });
    this.scaleDegreeCount = SCALE_DEGREES[scale].length;
  }

  /** Prefetch (lazy-load) a segment's tiers + SFX ahead of reaching it. Best-effort. */
  private async prefetch(index: number): Promise<void> {
    if (index < 0 || index >= this.segments.length) return;
    this.prefetchSegmentSfx(index); // its action sounds are ready before entry
    await this.loadSegment(index);
  }

  // ── segment entry + tier state ──────────────────────────────────────────────

  /**
   * Enter segment `index`. CARRY-ACROSS (design D5): the start tier is set DIRECTLY
   * from the current `heat` — `round(heat * maxTier)`, clamped to the min-audible floor
   * and the segment's ceiling — NOT reset and NOT capped at `top - 1`. This is the
   * no-vocal-cut fix: a player at sustained high heat enters the next segment AT its top
   * tier (vocals continue seamlessly); a player whose heat has fallen enters thinner.
   * This entry instantiation is EXEMPT from the one-step-per-boundary cap (D3) — it MAY
   * be a multi-step jump (e.g. straight to the top tier when heat ≈ 1.0). Gains up
   * exactly the start tier; resets the per-segment top-held latch so the advance gate
   * re-arms (this segment must reach AND hold ITS own top a loop before it can advance).
   */
  private enterSegment(
    index: number,
    fresh: boolean,
    boundaryAt?: number,
  ): void {
    const seg = this.segments[index];
    if (!seg) return;

    const top = this.maxTier(seg);
    // CARRY: the heat-derived tier, clamped to the hard min-audible floor (tierFloorFor
    // → ≥2 layers, so EVERY entry has at least drums + bass, never a bare ≈1 layer) and
    // the segment's ceiling. No reset, no top-1 cap — sustained heat keeps vocals across
    // the hand-off; fallen heat enters thinner (the carry follows heat both ways). This
    // DESIRED tier is the carry target; the AUDIBLE tier is then demoted to whatever
    // loaded (a destination advanced-into before its players arrive starts lower and is
    // lifted to the desired tier by reconcileActiveGain when the load resolves).
    const desiredTier = Math.max(0, Math.min(top, this.heatTierFor(seg)));
    const startTier = this.nearestAvailableAtOrBelow(seg, desiredTier);

    this.tier = startTier;
    this.armedTier = startTier;
    this.tierFading = false;
    // Reset the top-held flag: the top must be re-reached + heard a full loop in THIS
    // segment before the advance can arm (gates the advance, not the carry — D5).
    this.topHeldSinceBoundary = false;
    // Record the (un-demoted) carry target so a tier whose player loads AFTER entry
    // (advance-into-unloaded) is reconciled UP to the full carried tier — NOT just to the
    // floored value that happened to be loaded at entry (the no-vocal-cut carry must
    // survive an async load).
    this.targetTier = desiredTier;

    // Gain up exactly the start tier; everything else hard-zero, anchored at the same
    // boundary the caller faded the old segment OUT (so the cross is symmetric).
    const at = fresh ? ToneRT!.now() : (boundaryAt ?? this.nextBar());
    for (let t = 0; t < seg.tierGains.length; t++) {
      const target = t === startTier ? 1 : 0;
      this.rampGain(seg.tierGains[t], target, fresh ? SNAP_S : XFADE_S, at);
    }

    // Hot-swap the SFX palette (D5): prefetch THIS segment's per-segment SFX pools so
    // the action sounds belong to what is now playing. Falls back to the song-level
    // set per name; a no-op if already loaded (idempotent).
    this.prefetchSegmentSfx(index);
  }

  /**
   * Post-load re-gain reconciliation (Blocker 2). If a segment is advanced into before
   * its players have finished loading, `enterSegment` ramps a tier gain that is still
   * `undefined` (a no-op) and `startTierPlayer` later starts the player at gain 0 — the
   * segment would then play SILENT for its whole window. When a segment's load resolves,
   * if it is still the active segment, re-apply its target tier gain so it becomes
   * audible (clamped to whatever tiers actually loaded). Never falls back to silence.
   */
  private reconcileActiveGain(index: number): void {
    if (this.switching) return; // switchTrack handles its own intro entry explicitly
    if (index !== this.segmentIndex) return; // a later advance superseded this segment
    const seg = this.segments[index];
    if (!seg) return;
    const top = this.maxTier(seg);
    // Honour the min-audible floor here too (a target set before load still ≥2 layers).
    let want = Math.max(this.tierFloorFor(seg), this.targetTier);
    want = Math.max(0, Math.min(top, want));
    want = this.nearestAvailableAtOrBelow(seg, want);
    // If the audible tier is already gained up, nothing to do.
    if (this.tier === want && this.readGain(seg.tierGains[want]) > 0.5) return;
    // Ramp the wanted tier up and any stray non-target tier down (in case an earlier
    // partial entry left a different tier gained).
    const at = this.toneNow();
    for (let t = 0; t < seg.tierGains.length; t++) {
      const target = t === want ? 1 : 0;
      this.rampGain(seg.tierGains[t], target, SNAP_S, at);
    }
    this.tier = want;
    this.armedTier = want;
  }

  /** Read a gain's current value, defensively (0 if missing/throwing). */
  private readGain(g: Tone.Gain | undefined): number {
    try {
      return g ? g.gain.value : 0;
    } catch {
      return 0;
    }
  }

  /** The highest loaded tier ≤ desired (so a missing tier file never silences). */
  private nearestAvailableAtOrBelow(seg: LoadedSegment, desired: Tier): Tier {
    const n = seg.tierPlayers.length;
    const d = Math.max(0, Math.min(n - 1, desired));
    // walk DOWN from desired, then (if all below are missing) UP to any loaded tier.
    for (let t = d; t >= 0; t--) {
      if (seg.tierPlayers[t]) return t;
    }
    for (let t = 0; t < n; t++) {
      if (seg.tierPlayers[t]) return t;
    }
    return 0;
  }

  // ── the loop tick: the ONLY place tiers change / segments advance ───────────

  /**
   * Schedule a recurring callback on the ACTIVE segment's loop boundary, aligned to
   * the segment's whole-bar loop length. Re-scheduled when the active segment (and
   * thus loop length) changes.
   */
  private scheduleLoopTick(): void {
    this.clearScheduled();
    const seg = this.active();
    if (!seg) return;
    // SELF-RESCHEDULING scheduleOnce (NOT scheduleRepeat — a large-interval repeat
    // re-registered mid-transport silently never fires). A single scheduleOnce at the
    // next absolute boundary re-arms the next one in its own callback.
    const interval = this.barWindowSeconds(seg);
    if (!(interval > 0)) return;
    const gen = ++this.loopTickGen;
    this.armNextBoundary(interval, gen);
  }

  /** Schedule the single next loop boundary; its callback re-arms the following one. */
  private armNextBoundary(interval: number, gen: number): void {
    const at = this.nextWrapBoundary(interval);
    try {
      const id = ToneRT!.getTransport().scheduleOnce((time) => {
        if (gen !== this.loopTickGen) return; // a reschedule superseded this tick
        this.onLoopBoundary(time);
        if (gen !== this.loopTickGen) return; // advance/swap may have rescheduled
        const cur = this.active();
        const nextInterval = cur ? this.barWindowSeconds(cur) : interval;
        this.armNextBoundary(nextInterval, gen);
      }, at);
      this.scheduledEvents.push(id);
    } catch {
      // no transport — quantize disabled; engine still plays the bed silently
    }
  }

  /**
   * The next loop-wrap boundary on the transport-0 / player-wrap grid: the smallest
   * multiple of `interval` strictly after now. Safe fallback to `now + interval`.
   */
  private nextWrapBoundary(interval: number): number {
    try {
      const now = ToneRT!.getTransport().seconds;
      const k = Math.floor(now / interval + 1e-9) + 1;
      return k * interval;
    } catch {
      return this.toneNow() + interval;
    }
  }

  private clearScheduled(): void {
    this.loopTickGen++;
    for (const id of this.scheduledEvents) {
      try {
        ToneRT!.getTransport().clear(id);
      } catch {
        // ignore
      }
    }
    this.scheduledEvents = [];
  }

  /**
   * Fired at the active segment's loop boundary — the ONLY place a tier swaps or a
   * segment advances. HEAT model (heat, built by clears, drives everything):
   *  0) DECAY: a clear-less pass sheds heat (design D2); a pass that saw a clear does
   *     not. Evaluated only here (loop-boundary cadence, never a wall clock).
   *  1) VERTICAL: move the audible tier ONE step toward the heat-derived target
   *     ({@link evaluateTier}: `round(heat * maxTier)`), UP or DOWN, and crossfade to it
   *     on this boundary. Runs BEFORE the advance check so the top tier, once reached, is
   *     heard a full loop before the segment moves on.
   *  2) HORIZONTAL: if the advance gate is met ({@link shouldAdvance}: top tier audible
   *     AND held one loop AND no transition in flight), advance ONE segment forward now;
   *     the next segment carries the tier across from heat (design D5). Otherwise the
   *     segment LOOPS in place at the tier set in step 1.
   * `time` is the boundary's audio-clock time.
   */
  private onLoopBoundary(time: number): void {
    const seg = this.active();
    if (!seg) return;

    // 0) DECAY FIRST (design D2): a clear-less loop pass sheds heat; a pass that saw at
    // least one clear does not. Reset the flag for the next pass. The heat-derived tier
    // (step 1) then reflects the post-decay heat, so a sustained drought thins the mix.
    if (!this.clearedSinceBoundary) {
      this.heat = clamp01(this.heat - HEAT_DECAY_PER_EMPTY_PASS);
    }
    this.clearedSinceBoundary = false;

    // The audible tier AS WE ENTER this boundary, BEFORE step 1's move. The advance gate
    // keys off THIS (not the post-move tier) so the top tier is never revealed and
    // advanced-away on the SAME boundary — vocals always sound for at least one full loop
    // before the segment moves on (and the reveal ramp isn't cancelled by the fade-out).
    const tierBefore = this.tier;

    // TOP-HELD latch (design D4): if the top tier was ALREADY audible coming INTO this
    // boundary (it was reached on a PRIOR boundary and has now played a full loop), mark
    // it held. Set on the boundary AFTER the one that first put `this.tier === top` — so
    // the top mix is heard for one whole loop before the advance can arm. Reset to false
    // on every enterSegment (the advance gate re-arms per segment).
    if (tierBefore >= this.maxTier(seg)) {
      this.topHeldSinceBoundary = true;
    }

    // 1) VERTICAL: move the audible tier one step toward the heat target (UP or DOWN)
    //    and crossfade to it on this boundary.
    this.evaluateTier(seg);
    if (this.armedTier !== this.tier) {
      this.swapTier(seg, this.armedTier, time);
    }

    // 2) HORIZONTAL: if the top tier is audible + held, step forward ONE segment
    //    (advancing re-enters the next segment + reschedules its loop tick, carrying the
    //    tier across from heat). Otherwise the segment loops in place.
    if (this.shouldAdvance(seg, tierBefore)) {
      this.advanceSegment(time);
    }
  }

  // ── vertical: heat-driven tier move (one step per boundary, up and down) ─────

  /**
   * Arm the cumulative tier for the upcoming boundary swap from the current `heat`
   * (design D3): the desired tier is `round(heat * maxTier)` ({@link heatTierFor},
   * floored at the min-audible ≥2-layer floor, ceilinged at the segment's top). The
   * armed tier moves AT MOST ONE STEP toward the desired tier — UP when heat rose, DOWN
   * when heat fell (the heat model sheds layers, unlike the old sticky-up-only reveal).
   * One step per boundary keeps the build/shed musical (no multi-tier jumps mid-segment;
   * the carry-across multi-step jump is at ENTRY only, exempt). Never arms a tier whose
   * file failed to load (demoted to the nearest loaded tier at or below).
   */
  private evaluateTier(seg: LoadedSegment): void {
    if (this.tierFading) return; // don't re-arm mid-fade
    const desired = this.heatTierFor(seg);
    // one step toward the desired tier in EITHER direction (the floor is already baked
    // into `desired`, so a down-step can never breach the min-audible floor).
    let want = this.tier;
    if (desired > this.tier) want = this.tier + 1;
    else if (desired < this.tier) want = this.tier - 1;
    want = Math.max(0, Math.min(this.maxTier(seg), want));
    // demote to the highest LOADED tier at or below `want` (a missing file never silences).
    want = this.nearestAvailableAtOrBelow(seg, want);
    this.armedTier = want;
  }

  /** Constant-sum (linear) crossfade from the current tier file to `to` on `at`. */
  private swapTier(seg: LoadedSegment, to: Tier, at: number): void {
    if (to === this.tier) return;
    const from = this.tier;
    this.tierFading = true;
    // linear gain ramps on the layered cumulative renders read as a smooth blend (the
    // shared bed stays at full through the swap — no dip).
    this.rampGain(seg.tierGains[from], 0, XFADE_S, at);
    this.rampGain(seg.tierGains[to], 1, XFADE_S, at);
    this.tier = to;
    this.targetTier = to; // keep the reconcile target in step with the audible tier
    this.afterSettle(at + XFADE_S + 0.02, () => {
      this.tierFading = false;
    });
  }

  // ── horizontal: clear-gated forward-only advance ─────────────────────────────

  /**
   * Advance gate, evaluated in {@link onLoopBoundary} AFTER this boundary's tier move.
   * The HEAT model has a SINGLE advance rule (design D4 — there is NO bare-heat path,
   * no `ADVANCE_HEAT` threshold): a segment advances forward by exactly one IF AND ONLY
   * IF all of:
   *   - no transition is in flight (`!transitionInFlight`);
   *   - this boundary is NOT the one that just revealed the top tier
   *     (`!(tierBefore < top && this.tier >= top)`) — step 1 of onLoopBoundary started
   *     the top tier's gain ramp at `time`; advancing now would fade it back out at the
   *     same `time` and cancel the ramp, so the vocals would never sound. The freshly-
   *     revealed top is heard for a full loop first, then the segment moves on;
   *   - the audible tier has REACHED the segment's top tier (`this.tier >= maxTier` —
   *     ALL layers built); and
   *   - that top tier has been audible for a full loop (`topHeldSinceBoundary`, set on
   *     the boundary AFTER the one that first put `this.tier === top`).
   *
   * Why NO bare-heat path (design D4): a `heat >= ADVANCE_HEAT` clause below 1.0 could
   * fire BEFORE the top tier is audible — song2 has maxTier 4, so its top reveals only
   * at `round(heat*4) = 4`, i.e. heat ≥ 0.875; at heat 0.85 the audible tier is still 3
   * (no vocals) and a bare-heat advance would SKIP unheard vocal material. Gating on the
   * top tier being AUDIBLE + HELD guarantees the song can never advance past a tier the
   * player has not heard. Below this gate the segment LOOPS in place.
   *
   * Returns true even on the TERMINAL/last segment: an earned advance there means "past
   * the end of the song", which {@link advanceSegment} turns into the end-of-song song
   * switch instead of a step.
   *
   * @param seg the active segment at this boundary.
   * @param tierBefore the audible tier as the boundary was entered (pre-move).
   */
  private shouldAdvance(seg: LoadedSegment, tierBefore: Tier): boolean {
    if (this.transitionInFlight) return false;
    if (this.segments.length === 0) return false;
    const top = this.maxTier(seg);
    // never advance on the SAME boundary the top tier was just revealed (don't cut the
    // vocals off the bar they appear — they play a full loop first).
    if (tierBefore < top && this.tier >= top) return false;
    // the top tier (ALL layers) must be AUDIBLE...
    if (this.tier < top) return false;
    // ...AND must have been held one full loop.
    if (!this.topHeldSinceBoundary) return false;
    return true;
  }

  /**
   * CLEAR-GATED FORWARD-ONLY single-step advance, committed on the loop boundary `at`.
   * Carries the sticky tier floor (the tier reached here) into the next segment.
   * Crossfades the current segment's active tier out and the next segment's start tier
   * in, then disposes the segment left behind after the fade settles (no-hiss). On an
   * earned advance PAST the last (TERMINAL) segment it does NOT step the index — it
   * fires {@link complete} (→ the host swaps to the other song via switchTrack).
   * Token-guarded so a switchTrack/dispose can't land a stale commit.
   */
  private advanceSegment(at: number): void {
    const count = this.segments.length;
    if (count === 0) return;
    const fromIndex = this.segmentIndex;
    const from = this.active();

    // End of song: an earned advance off the last segment → switch to the other song
    // (skin switch via onSongComplete). Lock the in-flight gate + clear the top-held
    // latch so the terminal segment keeps looping (it must re-hold its top to re-fire,
    // and complete() is idempotent anyway) until the host swaps.
    if (this.segmentIndex >= count - 1) {
      this.transitionInFlight = true;
      this.topHeldSinceBoundary = false;
      this.complete();
      // release the lock shortly after; if the host swapped tracks, switchTrack already
      // rebuilt + invalidated this transition, so the token guard makes this a no-op.
      const token = ++this.transitionToken;
      this.afterSettle(at + XFADE_S + 0.05, () => {
        if (token !== this.transitionToken) return;
        this.transitionInFlight = false;
      });
      return;
    }

    const index = this.segmentIndex + 1;
    const to = this.segments[index];
    if (!to) return;

    this.transitionInFlight = true;
    const token = ++this.transitionToken;
    // The carry-across is via HEAT (design D5): enterSegment(index) sets the next
    // segment's start tier directly from the current heat — no entryFloor hand-off.

    // If the next segment hasn't finished loading, advance still happens (silent until
    // its players arrive); kick a load just in case.
    void this.loadSegment(index);

    // Fade the current active tier out.
    this.rampGain(from?.tierGains[this.tier], 0, XFADE_S, at);

    // Enter the destination phase-correct (sets tier/armedTier from the heat carry +
    // gains the start tier up over the crossfade). Pass the boundary time `at` so the
    // in-fade starts where the out-fade did (symmetric).
    this.segmentIndex = index;
    this.maxSegmentReached = Math.max(this.maxSegmentReached, index);
    this.enterSegment(index, /*fresh*/ false, at);

    // Reschedule the loop tick for the NEW segment's loop length.
    this.scheduleLoopTick();

    this.afterSettle(at + XFADE_S + 0.05, () => {
      if (token !== this.transitionToken) return;
      this.transitionInFlight = false;
      // dispose the segment we left (forward-only — never re-entered).
      if (fromIndex !== this.segmentIndex) this.disposeSegment(fromIndex);
      // prefetch the one after the new active segment.
      void this.prefetch(index + 1);
    });
  }

  private complete(): void {
    if (this.songCompleted) return;
    this.songCompleted = true;
    try {
      this.onSongComplete?.();
    } catch {
      // host handler must never crash the engine
    }
  }

  // ── event handling: clears raise intensity; actions fire SFX ────────────────

  fire(ev: AudioEvent): void {
    if (!this.started || this.muted) return;
    try {
      ToneRT!.getTransport().scheduleOnce((time) => {
        this.play(ev, time);
      }, "@16n");
    } catch {
      // best-effort
    }
  }

  /**
   * Route an event (design D6). Clears (lineClear/chain) feed HEAT (the progression —
   * tier up/down + segment advance) but make NO sound in tone mode (the sweep clear AND
   * chain are silent; only forming a MATCH dings); sample mode keeps the recorded
   * clear-stage one-shot. `match` (a 2x2 square newly formed) is the audible reward: an
   * in-key ding (tone mode) or the recorded `stage` (sample mode). rotate / softDrop /
   * lock route to subtle in-key tones (tone mode) or their recorded one-shots (sample
   * mode). `move` is always silent.
   */
  private play(ev: AudioEvent, time: number): void {
    // Clears + chains feed HEAT and (in tone mode) make NO sound.
    if (ev.type === "lineClear") {
      this.onClear(ev.squares, ev.combo);
      if (this.sfxMode === "sample") {
        const route = routeEvent(ev, "sample");
        if (route.sfx) {
          this.playSfx(route.sfx, time, stageVelocityForSquares(ev.squares));
        }
      }
      return;
    }
    if (ev.type === "chain") {
      this.onChain(ev.size);
      if (this.sfxMode === "sample") {
        const route = routeEvent(ev, "sample");
        if (route.sfx) this.playSfx(route.sfx, time, SFX_CHAIN_VELOCITY);
        if (route.layer) this.playSfx(route.layer, time, SFX_CHAIN_VELOCITY);
      }
      return;
    }
    // match: the audible reward for forming a square. Heat is NOT fed here (the
    // lineClear/chain that erases the square feeds heat); match only dings.
    if (ev.type === "match") {
      if (this.sfxMode === "tone") {
        this.playToneMatch(ev.squares, time);
      } else {
        const route = routeEvent(ev, "sample");
        if (route.sfx) {
          this.playSfx(route.sfx, time, stageVelocityForSquares(ev.squares));
        }
      }
      return;
    }
    // rotate / softDrop / lock (move is silent).
    if (this.sfxMode === "tone") {
      this.playToneAction(ev, time);
      return;
    }
    const route = routeEvent(ev, "sample");
    if (!route.sfx) return; // move (and any unmapped action) is silent
    // A lock thuds on EVERY settle, scaled by cause (hard hardest); other actions use
    // the default action velocity.
    const velocity =
      ev.type === "lock"
        ? dropVelocityForCause(ev.cause)
        : SFX_ACTION_VELOCITY;
    this.playSfx(route.sfx, time, velocity);
  }

  // ── tone SFX (design D6) ──────────────────────────────────────────────────────

  /** Switch the SFX delivery mode at runtime (design D6). */
  setSfxMode(mode: SfxMode): void {
    this.sfxMode = mode;
    if (mode === "tone") this.ensureToneSynth();
  }

  /**
   * Lazily construct the tone synth (a Tone.PolySynth) INSIDE a gesture / on first tone
   * use — NEVER at module-eval (autoplay rule, design D6). Routed through `this.master`.
   * A real build attempt (master + Tone present) is made at most once: a failure leaves
   * the synth undefined and the tone path degrades to silence (never throws). If called
   * BEFORE unlock (no master/Tone yet — e.g. `setSfxMode("tone")` pre-gesture) it is a
   * no-op that does NOT mark "tried", so unlock()'s later call still builds it.
   */
  private ensureToneSynth(): void {
    if (this.toneSynth || this.toneSynthTried) return;
    const master = this.master;
    const T = ToneRT;
    if (!master || !T) return; // pre-unlock: retry later (don't burn the one attempt)
    this.toneSynthTried = true;
    try {
      const synth = new T.PolySynth(T.Synth);
      // a short subtle envelope + a soft triangle wave for an unobtrusive ding.
      try {
        synth.set({
          envelope: TONE_ENVELOPE,
          oscillator: { type: "triangle" },
        });
      } catch {
        // older Tone / degraded synth — defaults are fine, keep the synth
      }
      synth.connect(master);
      this.toneSynth = synth;
    } catch {
      this.toneSynth = undefined; // degrade to silence
    }
  }

  /**
   * The MIDI note for scale degree `degree` (0-based) at octave shift `octave` (in
   * octaves, may be negative), clamped to the built scale set. Degree wraps within the
   * scale; octave shift moves whole octaves. Returns a finite MIDI or undefined if the
   * scale set is empty.
   */
  private scaleNote(degree: number, octave = 0): number | undefined {
    const set = this.scaleMidis;
    if (set.length === 0) return undefined;
    const n = this.scaleDegreeCount > 0 ? this.scaleDegreeCount : set.length;
    const d = ((degree % n) + n) % n;
    const base = set[d] ?? set[0]!;
    return base + 12 * octave;
  }

  /** Play a single in-key tone (design D6). Degrades to silence on any failure. */
  private playTone(
    midi: number | undefined,
    velocity: number,
    duration: string,
    time: number,
  ): void {
    if (midi == null || !Number.isFinite(midi)) return;
    this.ensureToneSynth();
    const synth = this.toneSynth;
    if (!synth) return;
    try {
      const freq = midiToFreq(midi);
      const v = Math.max(0.0001, Math.min(1, velocity));
      const at = Math.max(time, this.toneNow() + SFX_RETRIGGER_EPSILON);
      synth.triggerAttackRelease(freq, duration, at, v);
    } catch {
      // dropped tone never surfaces to the game
    }
  }

  /**
   * The match ding (design D6): scale degree 5 (or the 3rd for a pentatonic scale) —
   * a clear consonant high note — pitched up slightly per square (more squares =
   * brighter), velocity 0.5..0.7 by squares. `squares` is the positive count delta.
   */
  private playToneMatch(squares: number, time: number): void {
    const s = Number.isFinite(squares) ? Math.max(1, squares) : 1;
    // degree 5 for a 7-note scale; the 3rd (index 2) for a 5-note pentatonic.
    const degree = this.scaleDegreeCount <= 5 ? 2 : 4;
    // brighter for a bigger square: nudge UP one octave once 2+ squares form at once.
    const octave = s >= 2 ? 2 : 1;
    const velocity = Math.max(0.5, Math.min(0.7, 0.5 + 0.1 * (s - 1)));
    this.playTone(this.scaleNote(degree, octave), velocity, "16n", time);
  }

  /**
   * A subtle in-key tone for rotate / soft-drop / lock (design D6). move is silent.
   *  - rotate   → root (degree 1), mid register, vel 0.30, 32n
   *  - softDrop → degree 2, low-mid, vel 0.25, 32n
   *  - lock     → root one octave DOWN, vel by settle cause, 16n
   */
  private playToneAction(ev: AudioEvent, time: number): void {
    switch (ev.type) {
      case "rotate":
        this.playTone(this.scaleNote(0, 1), TONE_VEL_ROTATE, "32n", time);
        return;
      case "softDrop":
        this.playTone(this.scaleNote(1, 0), TONE_VEL_SOFTDROP, "32n", time);
        return;
      case "lock":
        this.playTone(
          this.scaleNote(0, 0),
          dropVelocityForCause(ev.cause),
          "16n",
          time,
        );
        return;
      default:
        return; // move (and anything unmapped) is silent
    }
  }

  /**
   * Feed the continuous `heat` meter on a CLEAR, scaled by the real squares + combo
   * (design D1): `gain = HEAT_GAIN_BASE + HEAT_GAIN_SQUARE*squares + HEAT_GAIN_COMBO*
   * comboStep`, clamped to 0..1. Also marks `clearedSinceBoundary` so the next loop
   * boundary does NOT decay (design D2). Clearing makes the song hotter (more layers,
   * eventually an advance); heat never moves backward on a clear.
   *
   * Defends against a non-finite contribution (an upstream bug feeding NaN/Infinity
   * squares or combo): a non-finite gain is ignored and `heat` is left unchanged (and
   * re-clamped to a finite 0..1 defensively). The clear STILL counts toward the
   * no-decay flag — a clear happened even if its telemetry was malformed.
   */
  private onClear(squares: number, comboStep: number): void {
    if (this.segments.length === 0) return;
    // A non-finite squares OR combo (an upstream bug) means the WHOLE contribution is
    // untrustworthy — ignore it ENTIRELY: heat unchanged AND the no-decay flag is NOT
    // set (a poisoned event is treated as "no real clear", so it must not suppress the
    // next clear-less pass's decay). Don't sanitise to 0 and bank the base gain.
    if (!Number.isFinite(squares) || !Number.isFinite(comboStep)) {
      this.heat = clamp01(this.heat); // re-clamp defensively, no change
      return;
    }
    this.clearedSinceBoundary = true;
    const s = Math.max(0, squares);
    const c = Math.max(0, comboStep);
    const gain = HEAT_GAIN_BASE + HEAT_GAIN_SQUARE * s + HEAT_GAIN_COMBO * c;
    if (!Number.isFinite(gain)) {
      this.heat = clamp01(this.heat); // re-clamp defensively, no change
      return;
    }
    this.heat = clamp01(this.heat + gain);
  }

  /**
   * Feed heat on a CHAIN (a gem flood — a hot clear), bounded so a big flood is
   * rewarding but not runaway (design D1): `gain = HEAT_GAIN_BASE + HEAT_GAIN_SQUARE *
   * min(8, size)`. Marks `clearedSinceBoundary` (a chain is a clear — no decay this
   * pass). Non-finite size ignored.
   */
  private onChain(size: number): void {
    if (this.segments.length === 0) return;
    if (!Number.isFinite(size)) {
      // ignore a poisoned size ENTIRELY (heat unchanged, no-decay flag NOT set).
      this.heat = clamp01(this.heat);
      return;
    }
    this.clearedSinceBoundary = true;
    const sz = Math.max(0, Math.min(8, size));
    const gain = HEAT_GAIN_BASE + HEAT_GAIN_SQUARE * sz;
    if (!Number.isFinite(gain)) {
      this.heat = clamp01(this.heat);
      return;
    }
    this.heat = clamp01(this.heat + gain);
  }

  // ── test-only dev hooks (behind ?audiodev=1) ────────────────────────────────

  /**
   * TEST-ONLY (UP path): synchronously bank `count` typical clears' worth of HEAT (each
   * = a 2-square / combo-0 clear, gain 0.11 — design D1), bypassing the `@16n` transport
   * schedule of {@link fire} so a headless e2e can drive the heat model deterministically
   * (no real-time waits). Each injected clear also marks `clearedSinceBoundary` so the
   * next `__stepBoundary` does NOT decay (an injected clear IS a clear this pass).
   * Exposed only via the `?audiodev=1` engine handle.
   */
  __injectClears(count = 1): void {
    for (let i = 0; i < Math.max(0, count); i++) this.onClear(2, 0);
  }

  /**
   * TEST-ONLY: run the active segment's NEXT loop boundary RIGHT NOW (exactly what the
   * loop tick does on a real bar wrap) — apply decay if no clear was injected since the
   * prior boundary, move the audible tier one step toward the heat target, and, if the
   * top tier has been built + held, advance ONE segment forward. Lets the headless e2e
   * step the heat timeline bar-by-bar without waiting the real bar window OR the async
   * fade-settle.
   *
   * The previous advance's audio crossfade settles asynchronously (releasing the
   * in-flight lock after the fade). When a test steps boundaries back-to-back with no
   * real time elapsing, that settle hasn't run yet, so this first force-releases a stale
   * in-flight lock — the no-fast-forward guarantee still holds because the new segment
   * must independently build AND hold ITS top tier before it can advance (design D4).
   * Exercises the REAL boundary path (NOT a clock). Exposed only via `?audiodev=1`.
   */
  __stepBoundary(): void {
    if (!this.started || this.segments.length === 0) return;
    this.transitionInFlight = false; // release any not-yet-settled prior advance lock
    // release a not-yet-settled prior tier crossfade too: a crossfade clears
    // `tierFading` in an afterSettle on the REAL transport, which doesn't fire when a
    // test steps boundaries synchronously (no wall-clock time elapses). Without this,
    // evaluateTier would early-return on the second synchronous step and the tier would
    // freeze. (Production is unaffected — real boundaries are seconds apart.)
    this.tierFading = false;
    this.onLoopBoundary(this.nextBar());
  }

  /**
   * TEST-ONLY (DOWN path, DISTINCT from {@link __stepBoundary}): step `n` loop
   * boundaries each of which is GUARANTEED to be a clear-less pass — it forces
   * `clearedSinceBoundary = false` before each boundary so EVERY one of the `n` steps
   * decays heat (design D2/D7). This is the deterministic heat-shed driver for the e2e
   * (build heat with `__injectClears` + `__stepBoundary`, then shed it with
   * `__decayPasses`), kept SEPARATE from the UP path so the two can never be conflated.
   * Exposed only via the `?audiodev=1` engine handle.
   */
  __decayPasses(n = 1): void {
    if (!this.started || this.segments.length === 0) return;
    for (let i = 0; i < Math.max(0, n); i++) {
      this.transitionInFlight = false;
      this.tierFading = false; // release a not-yet-settled fade (see __stepBoundary)
      this.clearedSinceBoundary = false; // force a guaranteed clear-less pass
      this.onLoopBoundary(this.nextBar());
    }
  }

  // ── Layer-4 SFX — PER-SEGMENT voice pools, hot-swapped on segment entry (D5) ──
  //
  // SFX are SEGMENT-scoped: each segment has its own per-name pool, resolved from
  // its `segments[].sfx` (falling back to the song-level set). Prefetched on segment
  // entry, disposed with the left-behind segment, and `playSfx` reads the ACTIVE
  // segment's pool — so action sounds always belong to what is currently playing. An
  // old manifest (no per-segment sfx) resolves every segment to the song-level urls,
  // so this is byte-identical to the song-scoped behaviour without new assets.

  /** Per-segment SFX pools, keyed by segment index → {name → voice pool}. */
  private sfxPoolsBySegment = new Map<number, Partial<Record<SfxName, SfxVoicePool>>>();

  /** The active segment's pool set (created lazily). */
  private activeSfxPools(): Partial<Record<SfxName, SfxVoicePool>> {
    return this.sfxPoolsForSegment(this.segmentIndex);
  }

  /** The pool set for `index`, created (empty) on first access. */
  private sfxPoolsForSegment(
    index: number,
  ): Partial<Record<SfxName, SfxVoicePool>> {
    let pools = this.sfxPoolsBySegment.get(index);
    if (!pools) {
      pools = {};
      this.sfxPoolsBySegment.set(index, pools);
    }
    return pools;
  }

  private playSfx(name: SfxName, time: number, velocity = 1): void {
    const pools = this.activeSfxPools();
    const pool = pools[name];
    if (!pool || pool.voices.length === 0) {
      void this.ensureSfx(this.segmentIndex, name);
      return;
    }
    try {
      const voice = pool.voices[pool.next % pool.voices.length];
      pool.next = (pool.next + 1) % pool.voices.length;
      if (!voice) return;
      const floor = this.toneNow() + SFX_RETRIGGER_EPSILON;
      const at = Math.max(time, floor, pool.lastStart + SFX_RETRIGGER_EPSILON);
      pool.lastStart = at;
      voice.volume.value = ToneRT!.gainToDb(Math.max(0.0001, Math.min(1, velocity)));
      voice.start(at);
    } catch {
      // dropped one-shot never surfaces to the game
    }
  }

  /**
   * Lazily load one SFX name's voice pool FOR a specific segment, resolving the url
   * segment → song-level → silence ({@link segmentSfxUrlFor}). Idempotent per
   * (segment, name); load-gen guarded so a teardown can't leave orphan voices.
   */
  private async ensureSfx(index: number, name: SfxName): Promise<void> {
    const master = this.master;
    const song = this.song;
    if (!master || !song) return;
    const pools = this.sfxPoolsForSegment(index);
    if (pools[name]) return;
    const url = segmentSfxUrlFor(name, this.segments[index]?.meta, song, ASSET_BASE);
    if (!url) return;
    const gen = this.loadGen;
    const pool: SfxVoicePool = { voices: [], next: 0, lastStart: -Infinity };
    pools[name] = pool;
    const loaded = await Promise.all(
      Array.from({ length: SFX_VOICES }, () => this.loadPlayer(url)),
    );
    // a teardown/switch (loadGen bump) or a fresh pool replaced this one mid-load →
    // dispose what we built rather than leaking orphan voices into a dead bank.
    if (gen !== this.loadGen || this.sfxPoolsBySegment.get(index)?.[name] !== pool) {
      for (const p of loaded) p?.dispose();
      return;
    }
    for (const p of loaded) {
      if (p) {
        p.connect(master);
        pool.voices.push(p);
      }
    }
    if (pool.voices.length === 0) delete pools[name];
  }

  /**
   * Prefetch the ENTERING segment's SFX pools (D5) alongside its tier prefetch, so
   * its action sounds are ready the moment it becomes audible. Best-effort: each name
   * resolves segment → song-level → silence; a name with no url is simply skipped.
   */
  private prefetchSegmentSfx(index: number): void {
    const song = this.song;
    if (!song || index < 0 || index >= this.segments.length) return;
    const names: SfxName[] = ["move", "rotate", "softdrop", "drop", "stage"];
    for (const name of names) {
      const url = segmentSfxUrlFor(
        name,
        this.segments[index]?.meta,
        song,
        ASSET_BASE,
      );
      if (url) void this.ensureSfx(index, name);
    }
  }

  /** Dispose + drop a segment's entire SFX pool set (best-effort). */
  private disposeSegmentSfx(index: number): void {
    const pools = this.sfxPoolsBySegment.get(index);
    if (!pools) return;
    for (const pool of Object.values(pools)) this.disposeSfxPool(pool);
    this.sfxPoolsBySegment.delete(index);
  }

  // ── timing + gain helpers ────────────────────────────────────────────────────

  /** Next bar-boundary transport time (safe fallback to now). */
  private nextBar(): number {
    try {
      return ToneRT!.getTransport().nextSubdivision("1m");
    } catch {
      return this.toneNow();
    }
  }

  private toneNow(): number {
    try {
      return ToneRT!.now();
    } catch {
      return 0;
    }
  }

  /**
   * Ramp a gain to `target` over `dur` starting at transport time `at`, using
   * cancel→setValueAtTime(current,at)→linearRampToValueAtTime so the START time is
   * real (assertable as a bar multiple), not an immediate jump.
   */
  private rampGain(
    g: Tone.Gain | undefined,
    target: number,
    dur: number,
    at?: number,
  ): void {
    if (!g) return;
    try {
      const now = this.toneNow();
      const start = at != null ? Math.max(at, now) : now;
      const cur = g.gain.value;
      g.gain.cancelScheduledValues(start);
      g.gain.setValueAtTime(cur, start);
      g.gain.linearRampToValueAtTime(target, start + dur);
    } catch {
      try {
        g.gain.rampTo(target, dur);
      } catch {
        // ignore
      }
    }
  }

  /** Run `fn` after audio-clock time `at` (transport callback + setTimeout fallback). */
  private afterSettle(at: number, fn: () => void): void {
    let ran = false;
    let settleId: number | undefined;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const once = () => {
      if (ran) return;
      ran = true;
      if (settleId != null) {
        const i = this.settleEvents.indexOf(settleId);
        if (i >= 0) this.settleEvents.splice(i, 1);
      }
      if (timeoutId != null) {
        const j = this.settleTimeouts.indexOf(timeoutId);
        if (j >= 0) this.settleTimeouts.splice(j, 1);
      }
      fn();
    };
    try {
      settleId = ToneRT!.getTransport().scheduleOnce(() => once(), at);
      // settle ids live in their OWN array so a loop-tick reschedule (clearScheduled)
      // can't cancel a pending disposal / state reset.
      this.settleEvents.push(settleId);
    } catch {
      // fall through to setTimeout
    }
    let ms = (XFADE_S + 0.2) * 1000;
    try {
      ms = Math.max(0, at - this.toneNow()) * 1000 + 60;
    } catch {
      // keep default
    }
    try {
      if (typeof window !== "undefined") {
        // track the timeout id so a reset/dispose can cancel this fallback before it
        // mutates post-reset state (the transport `clear` can't reach a setTimeout).
        timeoutId = setTimeout(once, ms);
        this.settleTimeouts.push(timeoutId);
      } else {
        once();
      }
    } catch {
      once();
    }
  }

  // ── live track switch (skin swap) ────────────────────────────────────────────

  /**
   * Live-swap the soundtrack: load the new song's intro, bar-aligned constant-sum
   * (linear) bed crossfade — correct for the cumulative renders (the shared bed stays
   * at full; true equal-power would +3dB-bump it) — dispose the old bank. Invalidates
   * any in-flight transition. Self-guarded so a failed switch keeps the old song
   * running (never silence).
   */
  async switchTrack(track: TrackBundle, seconds = 1.5): Promise<void> {
    if (typeof window === "undefined") return;
    if (!this.started || !this.bedReady) {
      this.currentTrack = track;
      return;
    }
    if (track.id === this.currentTrack.id) return;
    if (this.switching) return;
    const master = this.master;
    const manifest = this.manifest;
    if (!master || !manifest) return;
    this.switching = true;

    // invalidate any pending transition + in-flight loads + cancel the loop tick.
    const gen = ++this.loadGen;
    this.transitionToken++;
    this.transitionInFlight = false;
    this.clearScheduled();

    // The old (outgoing) per-segment SFX pools. The switch OWNS retiring this bank: it
    // disposes oldSfx on success (after the crossfade settles) AND on every bail/throw,
    // so the old voices never leak. `newSfx` is the switch's OWN fresh map; the switch
    // only ever installs/disposes it under an IDENTITY check, so a concurrent
    // resetForNewGame/dispose that installs its own map is never stomped.
    const oldSfx = this.sfxPoolsBySegment;
    let newSfx: Map<number, Partial<Record<SfxName, SfxVoicePool>>> | undefined;
    // Retire the old bank's SFX (dispose every pool); idempotent (clear() empties it).
    const disposeOldSfx = () => {
      for (const pools of oldSfx.values()) {
        for (const pool of Object.values(pools)) this.disposeSfxPool(pool);
      }
      oldSfx.clear();
    };

    try {
      const song = this.resolveSong(manifest, track);
      if (!song || song.segments.length === 0) {
        this.switching = false;
        return;
      }
      const oldSegments = this.segments;
      const from = oldSegments[this.segmentIndex];

      // Build + load the new song's intro before crossfading.
      const newSegments = this.buildSegments(song);
      this.segments = newSegments;
      this.song = song;
      this.currentTrack = track;
      newSfx = new Map();
      this.sfxPoolsBySegment = newSfx;
      this.songCompleted = false;
      this.segmentIndex = 0;
      this.maxSegmentReached = 0;
      this.heat = 0;
      this.clearedSinceBoundary = false;
      this.applyTempo(song);
      this.applyKey(song);
      await this.loadSegment(0);
      // Superseded during the intro load (a reset/dispose/another switch bumped loadGen,
      // or a later switch changed the track). Dispose the nodes THIS switch built and the
      // OLD bank it was retiring, then bail. We do NOT re-attach oldSfx: the superseding
      // op now owns `this.sfxPoolsBySegment` and is responsible for it; we only touch our
      // OWN map (newSfx), and only if it is still the attached one (an identity check so
      // we never dispose/replace a reset-owned map). The bail path never reached
      // enterSegment/prefetch, so newSfx holds no pools — but dispose it defensively.
      if (gen !== this.loadGen || this.currentTrack.id !== track.id) {
        for (const seg of newSegments) this.disposeLoaded(seg);
        // Retire the OLD TIER bank too: a superseding reset/dispose only sees + disposes
        // the new `this.segments` (= newSegments); the original oldSegments are held only
        // in this suspended call, so if we don't free them here their tier players/gains
        // leak (and could keep playing). Symmetric with disposeOldSfx below.
        for (const seg of oldSegments) this.disposeLoaded(seg);
        if (this.sfxPoolsBySegment === newSfx) {
          this.disposeAllSfx(); // our own (empty) map is still attached — free + clear it
        } else {
          // a superseding op replaced our map: dispose only our own pools, leave theirs.
          for (const pools of newSfx.values()) {
            for (const pool of Object.values(pools)) this.disposeSfxPool(pool);
          }
          newSfx.clear();
        }
        disposeOldSfx(); // the old bank is being retired by this switch — free its voices
        this.switching = false;
        return;
      }

      const at = this.nextBar();
      // fade the OLD active tier out, enter the new song's intro in — both anchored
      // at the SAME boundary `at` so the cross is symmetric (no dip).
      this.rampGain(from?.tierGains[this.tier], 0, seconds, at);
      this.enterSegment(0, /*fresh*/ false, at);
      // override enterSegment's XFADE_S in-ramp with the longer skin crossfade.
      this.rampGain(newSegments[0]?.tierGains[this.tier], 1, seconds, at);
      this.scheduleLoopTick();
      void this.prefetch(1);

      // Dispose the old bank after the crossfade settles. The OUTGOING bank is also
      // tracked in `pendingRetire` so a superseding reset/dispose that CANCELS this
      // settle callback (clearSettleEvents) still frees it (the closure's locals are
      // detached from this.segments/this.sfxPoolsBySegment by the swap). The retire entry
      // is removed by whichever path disposes it first (idempotent — no double-dispose).
      const retire = { segments: oldSegments, sfx: oldSfx };
      this.pendingRetire.push(retire);
      const disposeAt = at + seconds + 0.1;
      this.afterSettle(disposeAt, () => this.disposeRetiredBank(retire));
    } catch {
      // keep the old track running. If we'd already detached the old SFX map (the throw
      // landed after the top-of-swap install), the old pools were never scheduled for
      // disposal — free them now so they can't leak. Only re-attach our own new map's
      // slot if it is still the attached one (don't stomp a superseding op's map).
      if (newSfx !== undefined && this.sfxPoolsBySegment === newSfx) {
        // our partial new map is still attached: drop it, restore the old bank's map so a
        // later teardown frees those voices (the old track keeps playing on the catch).
        this.disposeAllSfx();
        this.sfxPoolsBySegment = oldSfx;
      } else if (newSfx === undefined) {
        // threw before we ever detached the old map — nothing to restore.
      } else {
        // a superseding op owns the current map: don't touch it; just retire the old bank.
        disposeOldSfx();
      }
    } finally {
      this.switching = false;
    }
  }

  // ── new-game reset (GAME OVER → fresh start) ─────────────────────────────────

  /**
   * Reset the audio/music progression COMPLETELY back to a fresh start, so a NEW game
   * begins at the CURRENT song's OPENING (segment 0, floor tiers) rather than wherever
   * the previous game left the song. Wired from the GameShell game-over transition.
   *
   * Resets every progression field — `segmentIndex → 0`, `heat → 0`,
   * `tier`/`armedTier` → 0 (re-seeded to the floor by loadSong's enterSegment),
   * `transitionInFlight → false`, `maxSegmentReached → 0` — invalidates any in-flight
   * transition (token bump), cancels the scheduled loop tick + pending settle callbacks,
   * silences + disposes the old segment players, then RELOADS the current track from its
   * first segment (re-seating playback at the opening). Idempotent + self-guarded: a
   * no-op before {@link unlock} (nothing to reset), never throws into the game.
   *
   * Keeps the CURRENT track (the active skin's song) — a new game restarts the song the
   * player is on, it does NOT force back to song1. The skin/track is owned by GameShell.
   */
  resetForNewGame(): void {
    if (!this.started) return;
    const track = this.currentTrack;
    try {
      // Invalidate any in-flight advance/switch + in-flight segment loads + stop the loop
      // tick from firing into the old (about-to-be-disposed) segments.
      this.loadGen++;
      this.transitionToken++;
      this.transitionInFlight = false;
      this.switching = false;
      this.songCompleted = false;
      this.clearScheduled();
      this.clearSettleEvents();
      // clearSettleEvents just cancelled any in-flight switch's old-bank disposal — drain
      // the pending retires NOW so those detached banks are freed, not orphaned.
      this.drainPendingRetire();

      // Silence + tear down the old segment bank (no lingering audio from the last game).
      this.disposeAll();
      // Install a FRESH SFX map so the reloaded game's pools never share the map object
      // an in-flight (now-superseded) switchTrack may still hold a reference to — that
      // switch, on resume, only re-attaches/disposes ITS OWN map (identity-checked), so a
      // distinct object here keeps reset-owned pools out of its reach.
      this.sfxPoolsBySegment = new Map();

      // Reset all progression state to the song's opening.
      this.segments = [];
      this.segmentIndex = 0;
      this.maxSegmentReached = 0;
      this.heat = 0;
      this.clearedSinceBoundary = false;
      this.tier = 0;
      this.armedTier = 0;
      this.targetTier = 0;
      this.tierFading = false;
      this.topHeldSinceBoundary = false;
      this.bedReady = false;

      // Rebuild + re-enter the current track from segment 0 (fresh opening, floor tiers).
      void this.loadSong(track);
    } catch {
      // degrade silently — a failed reset must never crash the game-over transition.
    }
  }

  /** Cancel + drop any pending settle callbacks (disposals / state resets). */
  private clearSettleEvents(): void {
    for (const id of this.settleEvents) {
      try {
        ToneRT!.getTransport().clear(id);
      } catch {
        // ignore
      }
    }
    this.settleEvents = [];
    for (const t of this.settleTimeouts) {
      try {
        clearTimeout(t);
      } catch {
        // ignore
      }
    }
    this.settleTimeouts = [];
  }

  // ── disposal ─────────────────────────────────────────────────────────────────

  /** Dispose every voice in an SFX pool (best-effort, never throws). */
  private disposeSfxPool(pool: SfxVoicePool | undefined): void {
    if (!pool) return;
    for (const v of pool.voices) {
      try {
        v.dispose();
      } catch {
        // ignore
      }
    }
    pool.voices = [];
  }

  private disposeLoaded(seg: LoadedSegment | undefined): void {
    if (!seg) return;
    for (let t = 0; t < seg.tierPlayers.length; t++) {
      try {
        seg.tierPlayers[t]?.dispose();
      } catch {
        // ignore
      }
      try {
        seg.tierGains[t]?.dispose();
      } catch {
        // ignore
      }
      seg.tierPlayers[t] = undefined;
      seg.tierGains[t] = undefined;
    }
    seg.loaded = false;
  }

  private disposeSegment(index: number): void {
    this.disposeLoaded(this.segments[index]);
    // The left-behind segment's SFX voices go with its tier players (D5 lifecycle).
    this.disposeSegmentSfx(index);
  }

  private disposeAll(): void {
    for (const seg of this.segments) this.disposeLoaded(seg);
    this.disposeAllSfx();
  }

  /**
   * Dispose one retired (outgoing-switch) bank — its tier players + SFX voices — and
   * remove it from {@link pendingRetire}. Idempotent: if it was already drained (the
   * settle callback fired, or a prior reset/dispose drained it) it is a no-op, so the
   * normal settle path and the reset/dispose path can't double-dispose the same bank.
   */
  private disposeRetiredBank(retire: {
    segments: LoadedSegment[];
    sfx: Map<number, Partial<Record<SfxName, SfxVoicePool>>>;
  }): void {
    const i = this.pendingRetire.indexOf(retire);
    if (i < 0) return; // already disposed
    this.pendingRetire.splice(i, 1);
    for (const seg of retire.segments) this.disposeLoaded(seg);
    for (const pools of retire.sfx.values()) {
      for (const pool of Object.values(pools)) this.disposeSfxPool(pool);
    }
    retire.sfx.clear();
  }

  /** Drain every still-pending retired bank (a teardown that cancels its settle). */
  private drainPendingRetire(): void {
    for (const retire of this.pendingRetire.slice()) this.disposeRetiredBank(retire);
  }

  /** Dispose + clear EVERY segment's SFX pool set (teardown / switch / reset). */
  private disposeAllSfx(): void {
    for (const pools of this.sfxPoolsBySegment.values()) {
      for (const pool of Object.values(pools)) this.disposeSfxPool(pool);
    }
    this.sfxPoolsBySegment.clear();
  }

  // ── volume / mute ─────────────────────────────────────────────────────────────

  setVolume(v: number, rampSeconds = 0.1): void {
    this.volume = Math.max(0, Math.min(1, v));
    this.applyVolume(rampSeconds);
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.applyVolume();
  }

  isMuted(): boolean {
    return this.muted;
  }

  private applyVolume(rampSeconds = 0.1): void {
    if (!this.master) return;
    try {
      this.master.gain.rampTo(this.muted ? 0 : this.volume, rampSeconds);
    } catch {
      // ignore
    }
  }

  dispose(): void {
    this.loadGen++;
    this.transitionToken++;
    this.transitionInFlight = false;
    this.clearScheduled();
    this.clearSettleEvents();
    // free any retired-but-not-yet-disposed switch bank whose settle we just cancelled.
    this.drainPendingRetire();
    this.removeResumePrimer?.();
    this.removeResumePrimer = undefined;
    try {
      const t = tone()?.getTransport();
      t?.stop();
      t?.cancel();
    } catch {
      // ignore
    }
    this.disposeAll(); // disposes tier players AND every segment's SFX pools
    try {
      this.toneSynth?.dispose();
    } catch {
      // ignore
    }
    this.toneSynth = undefined;
    this.toneSynthTried = false;
    try {
      this.master?.dispose();
    } catch {
      // ignore
    }
    this.segments = [];
    this.sfxPoolsBySegment.clear();
    this.song = undefined;
    this.manifest = undefined;
    this.master = undefined;
    this.bedReady = false;
    this.segmentIndex = 0;
    this.maxSegmentReached = 0;
    this.tier = 0;
    this.armedTier = 0;
    this.targetTier = 0;
    this.tierFading = false;
    this.topHeldSinceBoundary = false;
    this.heat = 0;
    this.clearedSinceBoundary = false;
    this.settleEvents = [];
    this.settleTimeouts = [];
    this.pendingRetire = [];
    this.songCompleted = false;
    this.started = false;
  }
}

/** @deprecated old spike name — kept as an alias during the rename. */
export { InteractiveAudioEngine as ProceduralAudioEngine };
