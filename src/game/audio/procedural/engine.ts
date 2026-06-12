/**
 * Interactive-audio ENGINE for LLMines — manifest-driven, N-tier, loop-quantized,
 * AUTONOMOUS-TIMELINE model (FINE5 Wave 1). Ports the approved soundboard model
 * (public/soundboard/progression.html) into the live engine.
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
 * Two ORTHOGONAL progressions, both quantized to loop boundaries:
 *  - HORIZONTAL (segment timeline) is AUTONOMOUS. The song advances through its
 *    segments IN ORDER on its own musical clock — each segment plays for its bar
 *    window, then advances to the next on the bar boundary, regardless of clears.
 *    Forward-only. At the last segment it loops back to segment 0. Clears NEVER move
 *    the position.
 *  - VERTICAL (cumulative intensity) is GAMEPLAY-DRIVEN. A continuous `intensity`
 *    (0..maxTier) is RAISED by clear events and DECAYS slowly on a dry spell. Each
 *    segment is ENTERED at the tier = round(intensity) clamped to its available tiers,
 *    crossfaded in from the previous segment's tier with a constant-sum (linear)
 *    crossfade — correct for these CUMULATIVE renders (the shared bed stays at full
 *    through the fade; true equal-power would +3dB-bump the shared bed). Clearing makes
 *    the song FULLER on the next segment entry, never changes the segment.
 *
 * SSR-safe: nothing touches Tone until {@link InteractiveAudioEngine.unlock} runs on
 * a real user gesture (Start). Every Tone call is guarded so a failure degrades to
 * SILENCE — it must NEVER throw into the game. A missing/malformed manifest or
 * missing tier asset → silence.
 */

import * as Tone from "tone";
import { routeEvent, type SfxName } from "./sfxRouting";

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

// ── intensity (VERTICAL) tuning ──────────────────────────────────────────────
/**
 * How much one unit of score weight raises `intensity` (continuous tier units).
 * A lineClear feeds weight = 1 + squares + combo, so a couple of clears in a bar
 * window pushes the song up roughly one tier. Tuned for "a sustained clearing run
 * fills the song out within a few bars" — Wave 3 may retune against the real cut.
 */
const INTENSITY_PER_SCORE = 0.18;
/**
 * How much `intensity` decays per bar boundary on a dry spell (no qualifying score
 * that pass). Slow, so a brief lull holds the arrangement; a long dry spell thins it
 * back toward the bed over ~several bars (≈1 tier per 5 bars at this rate).
 */
const INTENSITY_DECAY_PER_BAR = 0.2;
/**
 * The energy floor applied on a FRESH segment entry: intensity never drops below
 * this when a new segment begins (so the first heard bars are never bare silence and
 * a section re-earns the rest of its arrangement). Generalized from the old
 * "enter at tier1" rule.
 */
const INTENSITY_ENTRY_FLOOR = 1;

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

/** A coarse "what just happened" describing one game action, fed to the engine. */
export type AudioEvent =
  | { type: "move" }
  | { type: "rotate" }
  | { type: "softDrop" }
  | { type: "lock" }
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

/** Resolve the {move,rotate,softdrop,harddrop,stage} SfxName set from manifest sfx. */
function sfxUrlFor(
  name: SfxName,
  sfx: ManifestSfx | undefined,
  base: string,
): string | undefined {
  if (!sfx) return undefined;
  // The SFX routing calls hard-drop "harddrop"; the manifest names it "drop". Every
  // other SfxName is also a ManifestSfx key, so this maps the one mismatch.
  const key: keyof ManifestSfx = name === "harddrop" ? "drop" : name;
  const rel = sfx[key];
  return rel ? `${base}/${rel}` : undefined;
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

  private manifest?: AudioManifest;
  private song?: ManifestSong;
  private currentTrack: TrackBundle = TRACK_SONG1;
  private switching = false;
  private bedReady = false;

  /** All segments of the active song; only `loaded` ones have live players. */
  private segments: LoadedSegment[] = [];
  private segmentIndex = 0;
  private maxSegmentReached = 0;

  // ── VERTICAL (intensity → tier) state for the ACTIVE segment ─────────────────
  /** The currently-audible cumulative tier of the active segment. */
  private tier: Tier = 0;
  /** The tier armed for the next boundary swap. */
  private armedTier: Tier = 0;
  /**
   * The tier the active segment SHOULD be audible at (from the last enterSegment). Used
   * to reconcile gain when a segment's players finish loading AFTER it became active
   * (advance-into-unloaded), so the segment isn't silent for its window.
   */
  private targetTier: Tier = 0;
  /**
   * Continuous gameplay intensity, range [0, maxTier]. RAISED by onScore, DECAYS per
   * bar on a dry spell. The armed tier = round(intensity) clamped to availability.
   */
  private intensity = 0;
  /** Score banked since the last bar boundary (drives the decay-vs-hold decision). */
  private scoreSinceLastPass = 0;

  // ── HORIZONTAL (autonomous timeline) state ───────────────────────────────────
  /** A segment hand-off crossfade is mid-flight. */
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
   * New (Wave 1): `intensity` (continuous gameplay energy) + `tierCount` (the active
   * segment's N). Old probe fields are retained where meaningful so the existing e2e
   * keeps reading (Wave 3 rewrites it for the autonomous model).
   */
  getAudioState(): {
    segmentIndex: number;
    maxSegmentReached: number;
    segmentCount: number;
    transitionInFlight: boolean;
    intensity: number;
    tier: Tier;
    armedTier: Tier;
    tierCount: number;
    layerGains: number[];
    activeStems: number;
    trackId: string;
    bpm: number;
    /** @deprecated back-compat: monotonic-ish per-segment energy proxy (= intensity). */
    segmentScore: number;
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
      intensity: this.intensity,
      tier: this.tier,
      armedTier: this.armedTier,
      tierCount: count,
      layerGains: gains,
      activeStems,
      trackId: this.currentTrack.id,
      bpm: this.bpm,
      segmentScore: this.intensity,
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
      // CRITICAL — the AudioContext must be both CREATED and RESUMED inside the
      // user-gesture stack, or strict-autoplay browsers block it. Two synchronous
      // calls, BEFORE any await, both riding the click:
      //  1. Tone.getContext() — lazily constructs the real Context NOW, in the gesture.
      //  2. ctx.resume() — resume it synchronously in the same gesture tick.
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
    seg.loaded = true; // claim early so concurrent prefetch doesn't double-load
    const tierUrls = seg.tierKeys.map(
      (k) => `${ASSET_BASE}/${seg.meta.tiers[k]}`,
    );
    await Promise.all(
      tierUrls.map(async (url, t) => {
        try {
          const gain = new Tone.Gain(0).connect(master);
          const player = await this.loadPlayer(url);
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
        const ts = Tone.getTransport().seconds;
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
        const p = new Tone.Player({
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
    const manifest = await this.loadManifest();
    if (!manifest) return; // degrade to silence
    const song = this.resolveSong(manifest, track);
    if (!song || song.segments.length === 0) return;
    if (this.currentTrack.id !== track.id) return; // a switch superseded us

    this.manifest = manifest;
    this.song = song;
    this.segments = this.buildSegments(song);
    this.segmentIndex = 0;
    this.maxSegmentReached = 0;
    this.intensity = 0;
    this.applyTempo(song);

    // Initial load = intro tiers only (lazy per-segment).
    await this.loadSegment(0);
    if (this.currentTrack.id !== track.id) {
      this.disposeAll();
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
      Tone.getTransport().bpm.value = this.bpm;
    } catch {
      // ignore
    }
  }

  /** Prefetch (lazy-load) a segment ahead of reaching it. Best-effort. */
  private async prefetch(index: number): Promise<void> {
    if (index < 0 || index >= this.segments.length) return;
    await this.loadSegment(index);
  }

  // ── segment entry + tier state ──────────────────────────────────────────────

  /**
   * Enter segment `index`. Applies the intensity ENERGY FLOOR (a fresh/first segment
   * never starts below {@link INTENSITY_ENTRY_FLOOR}, so the opening bars are never
   * bare), clamps the floor + current intensity to the new segment's available tiers,
   * and gains up exactly the start tier.
   */
  private enterSegment(
    index: number,
    fresh: boolean,
    boundaryAt?: number,
  ): void {
    const seg = this.segments[index];
    if (!seg) return;

    const top = this.maxTier(seg);
    // Energy floor: a fresh entry floors intensity so the first heard bars sound.
    if (fresh) {
      this.intensity = Math.max(this.intensity, INTENSITY_ENTRY_FLOOR);
    }
    // Clamp intensity to this segment's tier ceiling (a 4-tier seg can't show tier4).
    this.intensity = Math.max(0, Math.min(top, this.intensity));

    // Start tier = round(intensity), clamped + demoted to a tier that actually loaded.
    let startTier = Math.round(this.intensity);
    startTier = Math.max(0, Math.min(top, startTier));
    startTier = this.nearestAvailableAtOrBelow(seg, startTier);

    this.tier = startTier;
    this.armedTier = startTier;
    this.scoreSinceLastPass = 0;
    // Record what this segment SHOULD sound at, so a tier whose player loads AFTER
    // entry (advance-into-unloaded) can be reconciled up to target when it arrives.
    this.targetTier = startTier;

    // Gain up exactly the start tier; everything else hard-zero, anchored at the same
    // boundary the caller faded the old segment OUT (so the cross is symmetric).
    const at = fresh ? Tone.now() : (boundaryAt ?? this.nextBar());
    for (let t = 0; t < seg.tierGains.length; t++) {
      const target = t === startTier ? 1 : 0;
      this.rampGain(seg.tierGains[t], target, fresh ? SNAP_S : XFADE_S, at);
    }
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
    let want = Math.max(0, Math.min(top, this.targetTier));
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
      const id = Tone.getTransport().scheduleOnce((time) => {
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
      const now = Tone.getTransport().seconds;
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
        Tone.getTransport().clear(id);
      } catch {
        // ignore
      }
    }
    this.scheduledEvents = [];
  }

  /**
   * Fired at the active segment's loop boundary — the ONLY place a tier swaps or a
   * segment advances. AUTONOMOUS model:
   *  1) VERTICAL: decay/hold intensity for this pass. The audible tier is NOT swapped
   *     in place on the active segment — that segment is about to be faded out and
   *     disposed by advanceSegment, so an in-place swap would ramp gains on a dying
   *     node (never heard) and double-ramp what advanceSegment then fades to 0. The
   *     intensity carries forward and `enterSegment` sets the NEXT segment's audible
   *     tier from round(intensity) on entry.
   *  2) HORIZONTAL: advance to the next segment IN ORDER (forward-only, looping at
   *     the end), unconditionally — the timeline runs on the musical clock, not clears.
   * `time` is the boundary's audio-clock time.
   */
  private onLoopBoundary(time: number): void {
    const seg = this.active();
    if (!seg) return;

    // 1) VERTICAL: update continuous intensity for this pass. intensity → tier is
    // applied by enterSegment on the segment we're about to advance into; no in-place
    // swap on the outgoing segment (see method doc).
    if (this.scoreSinceLastPass <= 0) {
      // dry spell — decay slowly toward the bed.
      this.intensity = Math.max(0, this.intensity - INTENSITY_DECAY_PER_BAR);
    }
    this.scoreSinceLastPass = 0;

    // 2) HORIZONTAL: advance the timeline on its own clock (autonomous, forward-only).
    this.advanceSegment(time);
  }

  // ── horizontal autonomous advance ────────────────────────────────────────────

  /**
   * Autonomous FORWARD-ONLY advance, committed on the loop boundary `at`. Moves to the
   * next segment in order; at the last segment it LOOPS back to segment 0. Crossfades
   * the current segment's active tier out and the next segment's start tier in, then
   * disposes the segment left behind after the fade settles (no-hiss). Token-guarded.
   */
  private advanceSegment(at: number): void {
    const count = this.segments.length;
    if (count === 0) return;
    const fromIndex = this.segmentIndex;
    const from = this.active();
    // TERMINAL on the last segment rides out, then loops back to 0 (default). Any
    // non-last segment steps forward by one.
    const isLast = this.segmentIndex >= count - 1;
    const index = isLast ? 0 : this.segmentIndex + 1;
    const to = this.segments[index];
    if (!to) return;

    this.transitionInFlight = true;
    const token = ++this.transitionToken;

    // If the next segment hasn't finished loading, advance still happens (silent until
    // its players arrive); kick a load just in case.
    void this.loadSegment(index);

    // Fade the current active tier out.
    this.rampGain(from?.tierGains[this.tier], 0, XFADE_S, at);

    // Enter the destination phase-correct (sets tier/armedTier + gains the start tier
    // up over the crossfade), carrying the intensity (energy) across. Pass the
    // boundary time `at` so the in-fade starts where the out-fade did (symmetric).
    this.segmentIndex = index;
    const reachedNewMax = index > this.maxSegmentReached;
    this.maxSegmentReached = Math.max(this.maxSegmentReached, index);
    this.enterSegment(index, /*fresh*/ false, at);

    // Reschedule the loop tick for the NEW segment's loop length.
    this.scheduleLoopTick();

    // onSongComplete fires once when we LAND on the final segment for the first time.
    if (index === count - 1 && reachedNewMax) {
      this.complete();
    }

    this.afterSettle(at + XFADE_S + 0.05, () => {
      if (token !== this.transitionToken) return;
      this.transitionInFlight = false;
      // dispose the segment we left — UNLESS it's the same slot we just entered
      // (a single-segment song loops onto itself; never dispose the live one).
      if (fromIndex !== this.segmentIndex) this.disposeSegment(fromIndex);
      // prefetch the one after the new active segment (looping back to 0 at the end).
      const nextIndex = index >= count - 1 ? 0 : index + 1;
      void this.prefetch(nextIndex);
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
      Tone.getTransport().scheduleOnce((time) => {
        this.play(ev, time);
      }, "@16n");
    } catch {
      // best-effort
    }
  }

  /**
   * Route an event. Clears (lineClear/chain) are SILENT — they only RAISE the
   * gameplay intensity (VERTICAL), never the position. Actions fire their mapped
   * Layer-4 ad-lib one-shot.
   */
  private play(ev: AudioEvent, time: number): void {
    if (ev.type === "lineClear") {
      this.onScore(1 + ev.squares + ev.combo);
      return;
    }
    if (ev.type === "chain") {
      this.onScore(2 + Math.min(8, ev.size));
      return;
    }
    const route = routeEvent(ev);
    if (route.sfx) this.playSfx(route.sfx, time, 0.85);
  }

  /**
   * Raise the continuous intensity (VERTICAL). Clamped to the active segment's tier
   * ceiling. Banks the per-pass score so the boundary tick knows it wasn't a dry pass
   * (no decay this bar). Clearing makes the song FULLER; it NEVER moves the segment.
   *
   * Defends against a non-finite weight (an upstream bug feeding NaN/Infinity squares,
   * combo, or size): NaN would poison `intensity` and `round(NaN)` would permanently
   * corrupt the armed tier. A non-finite weight is ignored; intensity is re-clamped to
   * a finite value defensively.
   */
  private onScore(weight: number): void {
    if (this.segments.length === 0) return;
    if (!Number.isFinite(weight)) return; // ignore a poisoned weight
    this.scoreSinceLastPass += weight;
    const top = this.maxTier(this.active());
    const next = this.intensity + weight * INTENSITY_PER_SCORE;
    this.intensity = Number.isFinite(next)
      ? Math.max(0, Math.min(top, next))
      : Math.max(0, Math.min(top, this.intensity));
  }

  // ── Layer-4 SFX (lazy voice POOL per name, loaded per active song) ──────────

  private sfxPools: Partial<Record<SfxName, SfxVoicePool>> = {};

  private playSfx(name: SfxName, time: number, velocity = 1): void {
    const pool = this.sfxPools[name];
    if (!pool || pool.voices.length === 0) {
      void this.ensureSfx(name);
      return;
    }
    try {
      const voice = pool.voices[pool.next % pool.voices.length];
      pool.next = (pool.next + 1) % pool.voices.length;
      if (!voice) return;
      const floor = this.toneNow() + SFX_RETRIGGER_EPSILON;
      const at = Math.max(time, floor, pool.lastStart + SFX_RETRIGGER_EPSILON);
      pool.lastStart = at;
      voice.volume.value = Tone.gainToDb(Math.max(0.0001, Math.min(1, velocity)));
      voice.start(at);
    } catch {
      // dropped one-shot never surfaces to the game
    }
  }

  private async ensureSfx(name: SfxName): Promise<void> {
    const master = this.master;
    const song = this.song;
    if (!master || !song || this.sfxPools[name]) return;
    const url = sfxUrlFor(name, song.sfx, ASSET_BASE);
    if (!url) return;
    const pool: SfxVoicePool = { voices: [], next: 0, lastStart: -Infinity };
    this.sfxPools[name] = pool;
    const loaded = await Promise.all(
      Array.from({ length: SFX_VOICES }, () => this.loadPlayer(url)),
    );
    if (this.sfxPools[name] !== pool) {
      for (const p of loaded) p?.dispose();
      return;
    }
    for (const p of loaded) {
      if (p) {
        p.connect(master);
        pool.voices.push(p);
      }
    }
    if (pool.voices.length === 0) delete this.sfxPools[name];
  }

  // ── timing + gain helpers ────────────────────────────────────────────────────

  /** Next bar-boundary transport time (safe fallback to now). */
  private nextBar(): number {
    try {
      return Tone.getTransport().nextSubdivision("1m");
    } catch {
      return this.toneNow();
    }
  }

  private toneNow(): number {
    try {
      return Tone.now();
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
    const once = () => {
      if (ran) return;
      ran = true;
      if (settleId != null) {
        const i = this.settleEvents.indexOf(settleId);
        if (i >= 0) this.settleEvents.splice(i, 1);
      }
      fn();
    };
    try {
      settleId = Tone.getTransport().scheduleOnce(() => once(), at);
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
      if (typeof window !== "undefined") window.setTimeout(once, ms);
      else once();
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

    // invalidate any pending transition + cancel the loop tick.
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
      const oldSfx = this.sfxPools;
      const from = oldSegments[this.segmentIndex];

      // Build + load the new song's intro before crossfading.
      const newSegments = this.buildSegments(song);
      this.segments = newSegments;
      this.song = song;
      this.currentTrack = track;
      this.sfxPools = {};
      this.songCompleted = false;
      this.segmentIndex = 0;
      this.maxSegmentReached = 0;
      this.intensity = 0;
      this.applyTempo(song);
      await this.loadSegment(0);
      if (this.currentTrack.id !== track.id) {
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
        for (const pool of Object.values(oldSfx)) {
          this.disposeSfxPool(pool);
        }
      });
    } catch {
      // keep the old track running
    } finally {
      this.switching = false;
    }
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
  }

  private disposeAll(): void {
    for (const seg of this.segments) this.disposeLoaded(seg);
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
    this.transitionToken++;
    this.transitionInFlight = false;
    this.clearScheduled();
    try {
      const t = Tone.getTransport();
      t.stop();
      t.cancel();
    } catch {
      // ignore
    }
    this.disposeAll();
    for (const pool of Object.values(this.sfxPools)) {
      this.disposeSfxPool(pool);
    }
    try {
      this.master?.dispose();
    } catch {
      // ignore
    }
    this.segments = [];
    this.sfxPools = {};
    this.song = undefined;
    this.manifest = undefined;
    this.master = undefined;
    this.bedReady = false;
    this.segmentIndex = 0;
    this.maxSegmentReached = 0;
    this.tier = 0;
    this.armedTier = 0;
    this.targetTier = 0;
    this.intensity = 0;
    this.scoreSinceLastPass = 0;
    this.settleEvents = [];
    this.songCompleted = false;
    this.started = false;
  }
}

/** @deprecated old spike name — kept as an alias during the rename. */
export { InteractiveAudioEngine as ProceduralAudioEngine };
