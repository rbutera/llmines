/**
 * Interactive-audio ENGINE for LLMines — manifest-driven, N-tier, loop-quantized,
 * CLEAR-GATED model (FINE5). The player's CLEARS drive the song forward; the song
 * does NOT advance on its own.
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
 * Two ORTHOGONAL progressions, both quantized to loop boundaries, BOTH driven by
 * clears (never an autonomous clock):
 *  - HORIZONTAL (segment advance) is CLEAR-GATED, FORWARD-ONLY, ONE-STEP,
 *    IN-FLIGHT-LOCKED. The current segment LOOPS in place (re-plays its bar window)
 *    while the player hasn't earned an advance. Clears accumulate a monotonic
 *    `segmentScore`; when `segmentScore ≥ advanceThreshold` AND no transition is in
 *    flight, the song advances to the NEXT segment on the next bar boundary. One
 *    advance per threshold crossing — a burst can NOT fast-forward multiple segments
 *    (the in-flight lock + per-segment reset enforce this). Never backward. Advancing
 *    PAST the last (TERMINAL) segment fires {@link onSongComplete} (the host swaps to
 *    the other song via switchTrack — a skin switch).
 *  - VERTICAL (cumulative tier reveal) is CLEAR-GATED and STICKY WITHIN A SEGMENT.
 *    As the same monotonic `segmentScore` crosses the per-tier reveal thresholds, the
 *    audible cumulative tier rises (tier0 → tier1 → … , bar-aligned). Once a tier is
 *    revealed it STAYS for that segment — no decay, never sheds (sticky reveal). A
 *    FLOOR is carried into the next segment (entry tier = the tier reached in the
 *    previous segment, clamped to the new segment's tiers) so a section never resets
 *    to bare. Crossfades use a constant-sum (linear) ramp — correct for these
 *    CUMULATIVE renders (the shared bed stays at full through the fade; true
 *    equal-power would +3dB-bump the shared bed).
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

// ── clear-gated tuning (the named knobs — sized for the FINE cut) ─────────────
//
// The OLD failure was a threshold sized for 5 huge coarse blobs, which stranded the
// player in one section. There are now MANY small fine segments (song1 = 12,
// song2 = 10), so these are sized so a competent player walks the WHOLE song at a
// musical pace: a clear feeds weight = 1 + squares + combo (≈3–5 for a typical
// clear), so ~3–4 clears reveal one tier and ~6–8 clears earn an advance — roughly
// one segment every couple of bar windows of steady clearing, never stuck, never
// skipping.
//
/**
 * Monotonic per-segment clear-progress (`segmentScore`) needed to advance to the
 * NEXT segment via the CLEAR-PROGRESS path. Reached on the next bar boundary,
 * in-flight-locked, one step per crossing. Reset to 0 on every segment entry, so the
 * burst that earned this advance can't also pre-pay the next one (no fast-forward).
 *
 * Sized ABOVE the top-tier reveal for the fattest song: song2 has 5 tiers, so its top
 * tier (tier4) reveals at 4 × TIER_REVEAL_STEP = 24; 30 sits above that.
 *
 * NB on pacing: with the MANDATORY full-reveal advance ({@link shouldAdvance}), a
 * section in practice advances ONE LOOP AFTER its top tier is revealed (at score
 * = (tierCount−1)·TIER_REVEAL_STEP = 18 for the 4-tier songs, 24 for the 5-tier),
 * which is BELOW this 30. So for the current content the mandatory full-reveal path is
 * the usual trigger and this clear-gate is the higher fallback (it still governs any
 * segment that has no tier above its min-audible floor, where the mandatory path is
 * intentionally disabled — see shouldAdvance gate (a)). A clear feeds weight =
 * `1 + squares + combo` where `combo` is the REAL streak offset (`comboMultiplier - 1`,
 * 0 = no streak) from truthful pass telemetry (audio-truth D2): a typical 2-square
 * no-streak clear = 1+2+0 = 3, a 4-square single-sweep harvest = 1+4+0 = 5 (rewarded,
 * still ≪ 30 = no fast-forward), a 4-square pass on a ×3 streak = 1+4+2 = 7.
 */
const ADVANCE_THRESHOLD = 30;
/**
 * Per-tier reveal step: every `TIER_REVEAL_STEP` of monotonic `segmentScore` reveals
 * the next cumulative tier within the current segment (sticky — never sheds). So
 * tier1 at `segmentScore ≥ 6`, tier2 at `≥ 12`, tier3 at `≥ 18`, tier4 at `≥ 24`
 * (clamped to the segment's tier ceiling). A section fills out over its first several
 * bars of clearing and is FULLY revealed before the advance at 30 is earned.
 */
const TIER_REVEAL_STEP = 6;
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
 * The sticky-unlock entry FLOOR as a TIER INDEX (= MIN_AUDIBLE_LAYERS - 1): the
 * minimum tier a freshly-entered segment starts at, so the opening bars are never
 * bare (and the very first segment of the song still has bed + bass to hear). On a
 * mid-song advance the carried-forward floor (the tier reached in the previous
 * segment) is honoured on top of this; this is the hard lower bound. 1 = "+bass"
 * (2 cumulative layers), clamped down for any segment with fewer tiers.
 */
const TIER_ENTRY_FLOOR = MIN_AUDIBLE_LAYERS - 1;

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
  | { type: "chain"; size: number };

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
interface ManifestSong {
  id: string;
  title?: string;
  tempo: number;
  barSeconds: number;
  segments: ManifestSegment[];
  sfx?: ManifestSfx;
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

  /** All segments of the active song; only `loaded` ones have live players. */
  private segments: LoadedSegment[] = [];
  private segmentIndex = 0;
  private maxSegmentReached = 0;

  // ── VERTICAL (clear-gated, sticky tier reveal) state for the ACTIVE segment ──
  /** The currently-audible cumulative tier of the active segment. */
  private tier: Tier = 0;
  /** The tier armed for the next boundary swap (sticky: never below `tier`). */
  private armedTier: Tier = 0;
  /**
   * The tier the active segment SHOULD be audible at (from the last enterSegment). Used
   * to reconcile gain when a segment's players finish loading AFTER it became active
   * (advance-into-unloaded), so the segment isn't silent for its window.
   */
  private targetTier: Tier = 0;
  /** A tier crossfade is mid-flight (between two tier files of the same segment). */
  private tierFading = false;
  /**
   * The sticky floor carried INTO the active segment from the previous one (= the tier
   * reached before advancing). The reveal never drops below this within the segment, so
   * a section never resets to bare. Clamped to the segment's tier ceiling on entry.
   */
  private entryFloor: Tier = 0;

  // ── HORIZONTAL (clear-gated advance) state ───────────────────────────────────
  /**
   * Monotonic clear-progress within the ACTIVE segment (reset to 0 on every entry).
   * Drives BOTH the sticky tier reveal (crosses TIER_REVEAL_STEP multiples) and the
   * advance gate (≥ ADVANCE_THRESHOLD). Reset-on-entry is what blocks fast-forward: a
   * burst that earns one advance leaves the next segment back at 0.
   */
  private segmentScore = 0;
  /**
   * Per-segment flag (reset on every {@link enterSegment}): the segment's TOP tier
   * has been AUDIBLE for at least one full loop. Set true on the boundary AFTER the
   * one that first makes `this.tier === top`, so the top mix (vocals) is heard for a
   * whole loop before the mandatory full-reveal advance can arm — see {@link
   * shouldAdvance} gate (b). This is the B2 fix: it replaces the old
   * "top reveal earned in-segment (segmentScore ≥ top·STEP)" gate so a segment that
   * reached the top by ANY path advances after one loop instead of looping vocals
   * forever. The carried entry floor is capped at `top - 1` (see enterSegment), so
   * the top is always RE-EARNED in-segment, then held one loop — the rule fires
   * uniformly with no special case for carries.
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
   * Clear-gated model: `segmentScore` = monotonic per-segment clear-progress (the
   * quantity gated against ADVANCE_THRESHOLD and the per-tier reveal steps); `tier`
   * = the currently-audible cumulative tier; `tierCount` = the active segment's N.
   * `intensity` is retained as a DEPRECATED alias (= segmentScore) for any stray
   * back-compat consumer.
   */
  getAudioState(): {
    segmentIndex: number;
    maxSegmentReached: number;
    segmentCount: number;
    transitionInFlight: boolean;
    segmentScore: number;
    tier: Tier;
    armedTier: Tier;
    tierCount: number;
    layerGains: number[];
    activeStems: number;
    trackId: string;
    bpm: number;
    /** @deprecated back-compat alias: = segmentScore (clear-progress). */
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
      segmentScore: this.segmentScore,
      tier: this.tier,
      armedTier: this.armedTier,
      tierCount: count,
      layerGains: gains,
      activeStems,
      trackId: this.currentTrack.id,
      bpm: this.bpm,
      intensity: this.segmentScore,
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
      const res = await fetch(`${ASSET_BASE}/manifest.json`, {
        cache: "force-cache",
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
    this.segmentScore = 0;
    this.entryFloor = 0;
    this.applyTempo(song);

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

  /** Prefetch (lazy-load) a segment's tiers + SFX ahead of reaching it. Best-effort. */
  private async prefetch(index: number): Promise<void> {
    if (index < 0 || index >= this.segments.length) return;
    this.prefetchSegmentSfx(index); // its action sounds are ready before entry
    await this.loadSegment(index);
  }

  // ── segment entry + tier state ──────────────────────────────────────────────

  /**
   * Enter segment `index`. Resets the per-segment clear-progress (`segmentScore = 0`,
   * so the new segment re-earns its reveals + advance from scratch — the no-fast-forward
   * guarantee) and seeds the STICKY entry FLOOR: the start tier is the carried-forward
   * `entryFloor` (the tier reached in the previous segment) raised to at least
   * {@link TIER_ENTRY_FLOOR}, clamped to this segment's available tiers, so a section is
   * never bare on entry but never resets all the way to the bed either. Gains up exactly
   * the start tier.
   */
  private enterSegment(
    index: number,
    fresh: boolean,
    boundaryAt?: number,
  ): void {
    const seg = this.segments[index];
    if (!seg) return;

    const top = this.maxTier(seg);
    // The sticky floor carried in from the previous segment (0 on a fresh first entry),
    // raised to the hard min-audible floor (tierFloorFor → ≥2 layers) so EVERY entry —
    // the opening included — always has at least drums + bass, never a bare ≈1 layer.
    let startTier = Math.max(this.entryFloor, this.tierFloorFor(seg));
    // B2 FIX (D3): CAP the carried floor below this segment's TOP so vocals are
    // RE-EARNED per segment. A fully-revealed previous segment would otherwise carry
    // its top tier in and the section would enter AT vocals with segmentScore 0 —
    // either looping vocals forever (old gate (b)) or, if gate (b) accepted carries,
    // auto-advancing every post-climax segment with zero clears (autonomous timeline
    // by the back door). Capping at `max(tierFloorFor, top - 1)` forces the player's
    // clears to re-reveal the top in THIS segment, keeping clears in the loop while
    // still guaranteeing the top never loops forever. The ≥2-layer min-audible floor
    // still wins for a low-tier segment (tierFloorFor ≥ top - 1 there).
    startTier = Math.min(startTier, Math.max(this.tierFloorFor(seg), top - 1));
    // Clamp to this segment's ceiling (a 4-tier seg can't show tier4) + a loaded tier.
    startTier = Math.max(0, Math.min(top, startTier));
    startTier = this.nearestAvailableAtOrBelow(seg, startTier);

    this.tier = startTier;
    this.armedTier = startTier;
    this.tierFading = false;
    this.segmentScore = 0;
    // Reset the full-reveal-held flag: the top must be re-earned + heard a full loop
    // in THIS segment before the mandatory advance can arm (no cascade across entries).
    this.topHeldSinceBoundary = false;
    // The floor THIS segment will hold to (sticky reveal never drops below it).
    this.entryFloor = startTier;
    // Record what this segment SHOULD sound at, so a tier whose player loads AFTER
    // entry (advance-into-unloaded) can be reconciled up to target when it arrives.
    this.targetTier = startTier;

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
   * segment advances. CLEAR-GATED model (clears, never a clock, drive everything):
   *  1) VERTICAL FIRST: evaluate the sticky cumulative tier from the accumulated
   *     clear-progress and crossfade UP to it on this boundary (forward-only — never
   *     sheds within the segment). This runs BEFORE the advance check so a single hot
   *     bar that banks both the top-tier reveal AND the advance gate is FULLY REVEALED
   *     before it moves on — and the freshly-revealed tier is the one carried forward
   *     as the next segment's sticky floor (the "fully revealed before it advances"
   *     invariant; otherwise the section's upper tiers would never be heard).
   *  2) HORIZONTAL: if the player has earned an advance ({@link shouldAdvance}: enough
   *     clear-progress AND no transition in flight), advance ONE segment forward now.
   *     Otherwise the segment LOOPS in place (the players keep re-playing their bar
   *     window) at the tier revealed in step 1.
   * `time` is the boundary's audio-clock time.
   */
  private onLoopBoundary(time: number): void {
    const seg = this.active();
    if (!seg) return;

    // The audible tier AS WE ENTER this boundary, BEFORE step 1's reveal. The mandatory
    // full-reveal advance keys off THIS (not the post-reveal tier) so the top tier is
    // never revealed and advanced-away on the SAME boundary — vocals always sound for at
    // least one full loop before the section moves on (and the reveal ramp isn't
    // immediately cancelled by the advance's fade-out).
    const tierBefore = this.tier;

    // TOP-HELD latch (D3 gate (b)): if the top tier was ALREADY audible coming INTO
    // this boundary (it was revealed on a PRIOR boundary and has now played a full
    // loop), mark it held. This is set on the boundary AFTER the one that first put
    // `this.tier === top` — so the top mix is heard for one whole loop before the
    // mandatory advance can arm. Reset to false on every enterSegment (no cascade).
    if (tierBefore >= this.maxTier(seg)) {
      this.topHeldSinceBoundary = true;
    }

    // 1) VERTICAL FIRST: reveal the sticky cumulative tier earned so far and crossfade
    //    up to it on this boundary. Updating `this.tier` here means an advance committed
    //    in step 2 carries the JUST-REVEALED tier forward as the next segment's floor.
    this.evaluateTier(seg);
    if (this.armedTier !== this.tier) {
      this.swapTier(seg, this.armedTier, time);
    }

    // 2) HORIZONTAL: clears earned an advance → step forward ONE segment (advancing
    //    re-enters the next segment + reschedules its loop tick, carrying the floor).
    if (this.shouldAdvance(seg, tierBefore)) {
      this.advanceSegment(time);
    }
  }

  // ── vertical: sticky clear-gated tier reveal (in place, forward-only) ────────

  /**
   * Arm the cumulative tier for the upcoming boundary swap from the monotonic
   * `segmentScore`: every {@link TIER_REVEAL_STEP} of clear-progress reveals the next
   * tier. STICKY — the armed tier never drops below the currently-audible tier (no
   * shed within a segment), is bounded below by the sticky `entryFloor`, and bounded
   * above by the segment's tier ceiling. Never arms a tier whose file failed to load.
   */
  private evaluateTier(seg: LoadedSegment): void {
    if (this.tierFading) return; // don't re-arm mid-fade
    const top = this.maxTier(seg);
    const revealed = Math.floor(this.segmentScore / TIER_REVEAL_STEP);
    // sticky: at least the hard min-audible floor (≥2 layers), at least the carried
    // entry floor, at least the current tier, never above the ceiling.
    let want = Math.max(this.tierFloorFor(seg), this.entryFloor, this.tier, revealed);
    want = Math.max(0, Math.min(top, want));
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
   * Advance gate, evaluated in {@link onLoopBoundary} AFTER this boundary's tier reveal.
   * The section advances when EITHER:
   *  - CLEAR-PROGRESS: `segmentScore ≥ ADVANCE_THRESHOLD` (the normal earned advance), OR
   *  - FULL REVEAL (MANDATORY): the section has been BUILT UP to its TOP tier (vocals)
   *    by EARNED reveal and has ALREADY been heard at full mix for a loop. A
   *    fully-revealed section MUST move on — it can't keep looping at full mix. This is
   *    INDEPENDENT of ADVANCE_THRESHOLD, so it can fire below the clear-gate; it just
   *    guarantees a section advances no LATER than one loop after full reveal.
   *
   * The mandatory path is gated by THREE conditions so it neither cascades nor cuts the
   * vocals off the bar they appear:
   *   (a) the segment has HEADROOM above the min-audible floor (`maxTier > tierFloorFor`)
   *       — a segment whose top IS the entry floor (e.g. a 1/2-tier segment that the
   *       ≥2-layer floor parks at its ceiling) has nothing to "earn", so it never
   *       mandatorily advances (it can still advance via the clear-gate). This is what
   *       prevents a low-tier segment from auto-advancing every bar with zero clears.
   *   (b) the top tier has been AUDIBLE for a full loop (`topHeldSinceBoundary`) — set
   *       on the boundary AFTER the one that first revealed the top (B2/D3). The carried
   *       entry floor is capped at `top - 1` (see enterSegment), so the top is always
   *       RE-EARNED in THIS segment by clears and then held one loop; the rule fires
   *       uniformly whether the top was earned from the floor or from bare, with no
   *       special case for carries. A carried-in top is impossible (the cap), so this
   *       never fires on a zero-clear segment that merely inherited a high floor.
   *   (c) the top tier was ALREADY audible coming INTO this boundary (`tierBefore ≥ top`)
   *       — so a boundary that JUST revealed the top tier does not also advance off it on
   *       the same boundary (which would cancel the reveal ramp and the vocals would
   *       never sound). Vocals play for a full loop, then the section moves on.
   *
   * Both paths respect the in-flight lock. Returns true even on the TERMINAL/last
   * segment: an earned advance there means "past the end of the song", which
   * {@link advanceSegment} turns into the end-of-song song switch instead of a step.
   *
   * @param seg the active segment at this boundary.
   * @param tierBefore the audible tier as the boundary was entered (pre-reveal).
   */
  private shouldAdvance(seg: LoadedSegment, tierBefore: Tier): boolean {
    if (this.transitionInFlight) return false;
    if (this.segments.length === 0) return false;
    const top = this.maxTier(seg);
    // NEVER advance on the SAME boundary the top tier was just revealed — on ANY path
    // (clear-gate OR mandatory). step 1 of onLoopBoundary started the top tier's gain
    // ramp at `time`; advancing now would fade that exact gain back out at the same
    // `time` and cancel the ramp, so the vocals would never sound. A hot bar that banks
    // BOTH the top reveal AND the clear-gate must therefore wait one loop (the top is
    // heard, then the section moves on next boundary). Only blocks the freshly-revealed
    // top; a section already at top coming in is unaffected.
    if (tierBefore < top && this.tier >= top) return false;
    // CLEAR-PROGRESS path: enough banked clears to advance.
    if (this.segmentScore >= ADVANCE_THRESHOLD) return true;
    // MANDATORY full-reveal advance — see the three gates (a)/(b)/(c) above.
    if (top <= this.tierFloorFor(seg)) return false; // (a) no headroom above the floor
    if (!this.topHeldSinceBoundary) return false; // (b) top not yet audible a full loop
    if (tierBefore < top) return false; // (c) top wasn't audible yet (don't cut vocals)
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
    // (skin switch via onSongComplete). Lock the in-flight gate + reset the per-segment
    // progress so the terminal segment keeps looping (no re-fire) until the host swaps.
    if (this.segmentIndex >= count - 1) {
      this.transitionInFlight = true;
      this.segmentScore = 0;
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
    // The tier reached in THIS segment becomes the next segment's sticky floor.
    this.entryFloor = this.tier;

    // If the next segment hasn't finished loading, advance still happens (silent until
    // its players arrive); kick a load just in case.
    void this.loadSegment(index);

    // Fade the current active tier out.
    this.rampGain(from?.tierGains[this.tier], 0, XFADE_S, at);

    // Enter the destination phase-correct (sets tier/armedTier from the carried floor +
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
   * Route an event. Clears (lineClear/chain) BOTH feed the monotonic `segmentScore`
   * (the progression — sticky tier reveal + segment advance) AND fire the clear-stage
   * one-shot (B3 — clears are no longer silent). Every other action fires its mapped
   * one-shot at a cause-/size-scaled velocity. `move` is silent (no routing entry).
   */
  private play(ev: AudioEvent, time: number): void {
    // Clears drive progression first (unchanged weight: 1 + squares + combo, where
    // combo is the real streak offset; chain: 2 + min(8, size)). The early `return`
    // that suppressed their SFX is gone — they now ALSO route the clear-stage sound.
    if (ev.type === "lineClear") {
      this.onScore(1 + ev.squares + ev.combo);
      const route = routeEvent(ev);
      if (route.sfx) {
        this.playSfx(route.sfx, time, stageVelocityForSquares(ev.squares));
      }
      return;
    }
    if (ev.type === "chain") {
      this.onScore(2 + Math.min(8, ev.size));
      const route = routeEvent(ev);
      // A chain is audibly DISTINCT: a hot `stage` plus a layered `drop` impact (D4a).
      if (route.sfx) this.playSfx(route.sfx, time, SFX_CHAIN_VELOCITY);
      if (route.layer) this.playSfx(route.layer, time, SFX_CHAIN_VELOCITY);
      return;
    }
    const route = routeEvent(ev);
    if (!route.sfx) return; // move (and any unmapped action) is silent
    // A lock thuds on EVERY settle, scaled by cause (hard hardest); other actions use
    // the default action velocity.
    const velocity =
      ev.type === "lock"
        ? dropVelocityForCause(ev.cause)
        : SFX_ACTION_VELOCITY;
    this.playSfx(route.sfx, time, velocity);
  }

  /**
   * Feed the monotonic per-segment clear-progress (`segmentScore`). The next loop
   * boundary reads it to reveal the sticky tier (every TIER_REVEAL_STEP) and to gate
   * the advance (≥ ADVANCE_THRESHOLD). Clearing makes the song FULLER then moves it
   * FORWARD; it never moves backward.
   *
   * Backlog cap: one huge chain banks at most one extra advance's worth of progress
   * beyond the gate, so a burst can't pre-load multiple advances (no fast-forward —
   * the in-flight lock + per-segment reset are the other half of that guarantee).
   *
   * Defends against a non-finite weight (an upstream bug feeding NaN/Infinity squares,
   * combo, or size): NaN would poison `segmentScore` and corrupt every downstream
   * threshold compare. A non-finite weight is ignored; `segmentScore` is re-clamped to
   * a finite value defensively.
   */
  private onScore(weight: number): void {
    if (this.segments.length === 0) return;
    if (!Number.isFinite(weight)) return; // ignore a poisoned weight
    const cap = ADVANCE_THRESHOLD * 2;
    const next = this.segmentScore + weight;
    this.segmentScore = Number.isFinite(next)
      ? Math.max(0, Math.min(cap, next))
      : Math.max(0, Math.min(cap, this.segmentScore));
  }

  // ── test-only dev hooks (behind ?audiodev=1) ────────────────────────────────

  /**
   * TEST-ONLY: synchronously bank `count` typical clears' worth of clear-progress (each
   * weight 4 = a 2-square / combo-1 clear), bypassing the `@16n` transport schedule of
   * {@link fire} so a headless e2e can drive the CLEAR-GATED model deterministically
   * (no real-time waits). Exposed only via the `?audiodev=1` engine handle.
   */
  __injectClears(count = 1): void {
    for (let i = 0; i < Math.max(0, count); i++) this.onScore(4);
  }

  /**
   * TEST-ONLY: run the active segment's NEXT loop boundary RIGHT NOW (exactly what the
   * loop tick does on a real bar wrap) — reveal the sticky tier and, if enough clears
   * are banked, advance ONE segment forward. Lets the headless e2e step the clear-gated
   * timeline bar-by-bar without waiting the real bar window OR the async fade-settle.
   *
   * The previous advance's audio crossfade settles asynchronously (releasing the
   * in-flight lock after the fade). When a test steps boundaries back-to-back with no
   * real time elapsing, that settle hasn't run yet, so this first force-releases a
   * stale in-flight lock — the no-fast-forward guarantee still holds because the
   * per-segment `segmentScore` was reset to 0 on the prior advance (a fresh advance must
   * be RE-EARNED). Exercises the REAL boundary path (NOT a clock). Exposed only via the
   * `?audiodev=1` engine handle.
   */
  __stepBoundary(): void {
    if (!this.started || this.segments.length === 0) return;
    this.transitionInFlight = false; // release any not-yet-settled prior advance lock
    this.onLoopBoundary(this.nextBar());
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

    try {
      const song = this.resolveSong(manifest, track);
      if (!song || song.segments.length === 0) {
        this.switching = false;
        return;
      }
      const oldSegments = this.segments;
      // Snapshot the old per-segment SFX pools, then hand the engine a fresh map so the
      // new song's pools never collide with the outgoing song's by segment index.
      const oldSfx = this.sfxPoolsBySegment;
      const from = oldSegments[this.segmentIndex];

      // Build + load the new song's intro before crossfading.
      const newSegments = this.buildSegments(song);
      this.segments = newSegments;
      this.song = song;
      this.currentTrack = track;
      this.sfxPoolsBySegment = new Map();
      this.songCompleted = false;
      this.segmentIndex = 0;
      this.maxSegmentReached = 0;
      this.segmentScore = 0;
      this.entryFloor = 0;
      this.applyTempo(song);
      await this.loadSegment(0);
      // Superseded during the intro load (a reset/dispose/another switch bumped loadGen,
      // or a later switch changed the track) → don't enter/schedule into this now-stale
      // bank. Dispose the nodes this switch built and bail.
      if (gen !== this.loadGen || this.currentTrack.id !== track.id) {
        for (const seg of newSegments) this.disposeLoaded(seg);
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

      // dispose the old bank after the crossfade settles.
      const disposeAt = at + seconds + 0.1;
      this.afterSettle(disposeAt, () => {
        for (const seg of oldSegments) this.disposeLoaded(seg);
        for (const pools of oldSfx.values()) {
          for (const pool of Object.values(pools)) this.disposeSfxPool(pool);
        }
        oldSfx.clear();
      });
    } catch {
      // keep the old track running
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
   * Resets every progression field — `segmentIndex → 0`, `segmentScore → 0`,
   * `tier`/`armedTier` → the segment's entry floor, `entryFloor → 0` (default),
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

      // Silence + tear down the old segment bank (no lingering audio from the last game).
      this.disposeAll();

      // Reset all progression state to the song's opening.
      this.segments = [];
      this.segmentIndex = 0;
      this.maxSegmentReached = 0;
      this.segmentScore = 0;
      this.tier = 0;
      this.armedTier = 0;
      this.targetTier = 0;
      this.tierFading = false;
      this.entryFloor = 0;
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

  /** Dispose + clear EVERY segment's SFX pool set (teardown / switch / reset). */
  private disposeAllSfx(): void {
    for (const pools of this.sfxPoolsBySegment.values()) {
      for (const pool of Object.values(pools)) this.disposeSfxPool(pool);
    }
    this.sfxPoolsBySegment.clear();
  }

  // ── volume / mute ─────────────────────────────────────────────────────────────

  setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v));
    this.applyVolume();
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.applyVolume();
  }

  isMuted(): boolean {
    return this.muted;
  }

  private applyVolume(): void {
    if (!this.master) return;
    try {
      this.master.gain.rampTo(this.muted ? 0 : this.volume, 0.1);
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
    this.entryFloor = 0;
    this.topHeldSinceBoundary = false;
    this.segmentScore = 0;
    this.settleEvents = [];
    this.settleTimeouts = [];
    this.songCompleted = false;
    this.started = false;
  }
}

/** @deprecated old spike name — kept as an alias during the rename. */
export { InteractiveAudioEngine as ProceduralAudioEngine };
