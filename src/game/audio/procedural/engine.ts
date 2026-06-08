/**
 * Interactive-audio engine for LLMines — v2.6 bar-aligned segment-advance model.
 *
 * Goal: make playing the game FEEL like the soundtrack is responding to you and
 * PROGRESSING through the real song as you clear. The bed is the REAL recorded
 * song split into bar-aligned segment loops that TILE the whole track; the vocal
 * of each segment unlocks as you make progress. Action SFX are the REAL ad-lib
 * one-shots. A synthesised fallback bed + blips cover the case where the recorded
 * assets fail to load, so the engine always makes sound and never throws.
 *
 * ── Why v2.6 (the v2.5 bug) ──────────────────────────────────────────────────
 * v2.5 cut SIX fixed windows from one hand-picked anchor (not tiling the whole
 * song), and its vocal reveal DECAYED to zero between LLMines' sparse clears, so
 * the song never appeared to progress. v2.6 fixes both:
 *  - Segments are read from a per-song `manifest.json` (bar-aligned, whole-bar,
 *    covering the song start→end). The engine's bank size is data-driven.
 *  - The vocal reveal is STICKY per segment (latches when you make in-segment
 *    progress and stays for that section), not a decaying scalar.
 *
 * ── Clearing advances the song ───────────────────────────────────────────────
 *  - HORIZONTAL (forward-only, single-step, in-flight-locked): a clear-accumulator
 *    crosses a per-preset threshold and schedules ONE i→i+1 segment crossfade on
 *    the next bar boundary. Clears during an in-flight transition only accumulate
 *    (capped) — you cannot fast-forward / skip / queue. Monotonic: never rewinds.
 *  - VERTICAL (sticky): the active segment's vox layer unlocks when you make
 *    progress IN that segment, ramps in at a bar boundary, and stays for the rest
 *    of the section. A new segment starts at a floor (if the previous was
 *    unlocked) so momentum carries, then an in-segment clear lifts it to full.
 *  - END OF SONG: exhausting the last segment fires `onSongComplete` once, which
 *    the host uses to switch skin/track (the next song).
 *
 * SSR-safe: nothing touches Tone until {@link InteractiveAudioEngine.unlock}
 * runs on a real user gesture (Start). Every Tone call is guarded so a failure
 * degrades to silence — it must NEVER throw into the game (the production-start
 * e2e guard asserts 0 console errors).
 */

import * as Tone from "tone";
import {
  type AudioMix,
  type AudioPreset,
  DEFAULT_MIX,
  PRESETS,
  routeEvent,
  type SfxName,
} from "./presets";
import { energyToDegree, scaleNote } from "./scale";

const BPM = 112;
/** C#4 — action blips ring ~2 octaves above the bed root (C#2) so they cut through. */
const BLIP_BASE = 61;
/** Seconds for a layer-gain ramp (vox reveal + segment crossfade). */
const LAYER_RAMP_S = 0.4;
/**
 * Energy floor carried into a NEW segment when the PREVIOUS segment's vox was
 * already unlocked: instead of the vocal hard-vanishing every section, the new
 * segment starts at this floor and an in-segment clear lifts it to full. Keeps
 * the run's momentum musically (review refinement #3).
 */
const VOX_FLOOR = 0.25;
/** Default base path for the recorded audio assets (song 1, flat under /audio). */
const ASSET_BASE = "/audio";
/** Cap on segments to probe if a manifest can't be read (graceful fallback). */
const MAX_SEGMENTS_FALLBACK = 16;

/**
 * A TRACK is one full recorded soundtrack: an ordered set of bar-aligned segment
 * loops (bed + vox) plus the ad-lib SFX, all under a single asset directory, with
 * a `manifest.json` describing the bank. Song 1 lives flat under `/audio`; song 2
 * ("Verde el Pipeline", phonk) under `/audio/song2`. A skin owns a TrackBundle,
 * so switching skin crossfades to that skin's song via {@link switchTrack}.
 */
export interface TrackBundle {
  /** Stable id (matches the owning skin's id). */
  id: string;
  /** Asset directory under public/ (no trailing slash). e.g. "/audio", "/audio/song2". */
  base: string;
}

/** Song 1 — the default flat-`/audio` track. */
export const TRACK_SONG1: TrackBundle = { id: "song1", base: ASSET_BASE };

/** Build a TrackBundle for a per-song asset directory (e.g. "/audio/song2"). */
export function makeTrack(id: string, base: string): TrackBundle {
  return { id, base };
}

/** One segment's metadata from the per-song manifest.json. */
interface ManifestSegment {
  index: number;
  bars: number;
  bed: string;
  vox: string;
  character?: string;
  hasVox?: boolean;
}
interface TrackManifest {
  id: string;
  tempo: number;
  barSeconds: number;
  segmentCount: number;
  segments: ManifestSegment[];
}

const segBed = (base: string, i: number) => `${base}/seg${i}-bed.mp3`;
const segVox = (base: string, i: number) => `${base}/seg${i}-vox.mp3`;

/** One loaded segment: its bed + vox players + gain nodes + unlock state. */
interface Segment {
  bedPlayer?: Tone.Player;
  voxPlayer?: Tone.Player;
  bedGain?: Tone.Gain; // 1 when this is the active segment, 0 otherwise
  voxGain?: Tone.Gain; // 0..1 sticky vocal reveal (meaningful for the active seg)
}

/** Build the eight ad-lib SFX file paths for a track's asset directory. */
function sfxFilesFor(base: string): Record<SfxName, string> {
  return {
    move: `${base}/sfx-move.mp3`,
    rotate: `${base}/sfx-rotate.mp3`,
    lock: `${base}/sfx-lock.mp3`,
    match: `${base}/sfx-match.mp3`,
    softdrop: `${base}/sfx-softdrop.mp3`,
    harddrop: `${base}/sfx-harddrop.mp3`,
    gem: `${base}/sfx-gem.mp3`,
    chain: `${base}/sfx-chain.mp3`,
  };
}

/** A coarse "what just happened" describing one game action, fed to the engine. */
export type AudioEvent =
  | { type: "move" }
  | { type: "rotate" }
  | { type: "softDrop" }
  | { type: "lock" }
  | { type: "lineClear"; squares: number; combo: number }
  | { type: "chain"; size: number };

/**
 * Owns all Tone nodes + the Transport. One instance per GameShell. All public
 * methods are no-ops before {@link unlock} (so subscriptions can fire freely
 * before the player has clicked Start).
 */
export class InteractiveAudioEngine {
  private started = false;
  private muted = false;
  private volume = 0.5;
  private preset: AudioPreset = PRESETS[DEFAULT_MIX];

  // Master chain: everything -> filter -> master gain -> destination.
  private master?: Tone.Gain;
  private filter?: Tone.Filter;

  // Recorded bed: ordered segments, each with a bed + vox player/gain. All start
  // synced to the transport at time 0 so every segment loop stays in phase; only
  // the ACTIVE segment's bed gain is non-zero.
  private segments: Segment[] = [];
  /** Index of the currently-playing segment (horizontal song advance). */
  private segmentIndex = 0;
  /** Highest segment index reached (so an idle dip never rewinds the song). */
  private maxSegmentReached = 0;
  /** True once the recorded bed loaded + started (else the synth bed runs). */
  private recordedBedActive = false;

  /** The track (song) whose segments are currently loaded. */
  private currentTrack: TrackBundle = TRACK_SONG1;
  /** Manifest for the current track (segment count + metadata). */
  private manifest?: TrackManifest;
  /** Guards against overlapping switchTrack calls (rapid skin toggles). */
  private switching = false;

  // Recorded ad-lib SFX one-shots.
  private sfxPlayers: Partial<Record<SfxName, Tone.Player>> = {};

  // Procedural fallback bed voices (used only if the recorded base fails).
  private kick?: Tone.MembraneSynth;
  private snare?: Tone.NoiseSynth;
  private hat?: Tone.NoiseSynth;
  private bass?: Tone.MonoSynth;
  private arp?: Tone.PolySynth;
  private pad?: Tone.PolySynth;
  private padGain?: Tone.Gain;

  // Procedural action voices (blips, always available as a layer/fallback).
  private blip?: Tone.PolySynth; // move / rotate / soft-drop blips
  private thud?: Tone.MembraneSynth; // lock thud
  private lead?: Tone.PolySynth; // clear chords / chain runs

  /** Monotonic "next safe trigger time" guard (avoids Tone same-sample throws). */
  private lastTriggerTime = 0;

  // Bed loops (procedural fallback) + the bass sequence — kept so dispose stops them.
  private loops: Tone.Loop[] = [];
  private seq?: Tone.Sequence<number | null>;

  // Adaptive intensity: 0 (calm) .. 1 (hot). Decays each beat; bumped on clears.
  private intensity = 0;

  // ── Horizontal advance state ───────────────────────────────────────────────
  /**
   * Monotonic weighted count of clearing activity. Crossing the per-preset
   * threshold `(segmentIndex+1)*clearsPerSegment` schedules ONE forward step.
   */
  private clearProgress = 0;
  /** True while a segment crossfade is scheduled but not yet committed. */
  private transitionInFlight = false;
  /** Monotonic token; a deferred transition commit applies only if it matches. */
  private transitionToken = 0;
  /** Fired once when the player exhausts the last segment (host switches track). */
  onSongComplete?: () => void;
  private songCompleted = false;

  // ── Vertical (sticky) reveal state ─────────────────────────────────────────
  /** `clearProgress` at the moment the active segment became active. */
  private segmentEnteredAtProgress = 0;
  /** Whether the active segment's vox layer has unlocked (sticky for the section). */
  private activeVoxUnlocked = false;
  /** Whether the PREVIOUS segment's vox was unlocked (drives the carry-over floor). */
  private prevVoxUnlocked = false;

  /** Pick the active mix (instant — no teardown). */
  setPreset(mix: AudioMix): void {
    this.preset = PRESETS[mix];
    try {
      this.applyVoxReveal();
      this.applyIntensity();
    } catch {
      // ignore — best-effort
    }
  }

  getPreset(): AudioMix {
    return this.preset.mix;
  }

  /**
   * Choose the track BEFORE the engine starts (called from the Start gesture for
   * the currently-selected skin). No-op once started — a live change must use
   * {@link switchTrack} so it crossfades. Returns true if it set the track.
   */
  setInitialTrack(track: TrackBundle): boolean {
    if (this.started) return false;
    this.currentTrack = track;
    return true;
  }

  /** The id of the track whose segments are currently loaded. */
  getCurrentTrackId(): string {
    return this.currentTrack.id;
  }

  /**
   * Live-swap the soundtrack with a beat-aligned crossfade. Loads the new track's
   * full segment bank + SFX (synced to transport 0), then crossfades the OLD
   * active segment's bed out and the NEW active segment's bed in over `seconds`,
   * starting on the next bar so the change lands musically.
   *
   * The structural position carries over, MAPPED to the new bank: a song with
   * fewer segments clamps the index, and `clearProgress` is clamped so a switch
   * onto a shorter song can never instantly fire `onSongComplete`.
   *
   * No-op before unlock. Guarded + reentrancy-locked so a rapid double-toggle can
   * never leave two banks fighting or crash the game. Any pending segment
   * transition is invalidated (its token is bumped) so a stale callback can't
   * mutate the new bank.
   */
  async switchTrack(track: TrackBundle, seconds = 1.5): Promise<void> {
    if (typeof window === "undefined") return;
    if (!this.started || !this.recordedBedActive) {
      this.currentTrack = track;
      return;
    }
    if (track.id === this.currentTrack.id) return;
    if (this.switching) return;
    const master = this.master;
    if (!master) return;
    this.switching = true;
    // Invalidate any pending segment transition (stale-callback guard).
    this.transitionToken++;
    this.transitionInFlight = false;
    try {
      const newManifest = await this.loadManifest(track);
      // Provisional index from the manifest count; load the bank, then re-clamp
      // against the ACTUAL loaded length (a manifest-less probe may return fewer).
      const provisionalCount = newManifest?.segments.length ?? this.segments.length;
      const provisionalIdx = Math.min(this.segmentIndex, Math.max(0, provisionalCount - 1));

      const newBank = await this.loadSegmentBank(track, provisionalIdx, master, newManifest);
      const newSfx = await this.loadSfxSet(track, master);
      // Re-clamp against the bank we actually got (never point past the new bank).
      const idx = Math.min(provisionalIdx, Math.max(0, newBank.length - 1));

      const oldBank = this.segments;
      const oldSfx = this.sfxPlayers;
      const fromBed = oldBank[this.segmentIndex]?.bedGain;
      const fromVox = oldBank[this.segmentIndex]?.voxGain;
      // If the re-clamp moved off provisionalIdx, make sure that segment's bed is up.
      const toBed = newBank[idx]?.bedGain;
      if (idx !== provisionalIdx) {
        try {
          toBed?.gain.setValueAtTime(0, Tone.now());
        } catch {
          // ignore
        }
      }

      try {
        toBed?.gain.cancelScheduledValues(Tone.now());
        toBed?.gain.setValueAtTime(0, Tone.now());
      } catch {
        // ignore
      }

      const at = this.nextBar();
      this.rampGain(fromBed, 0, seconds, at);
      this.rampGain(fromVox, 0, seconds, at);
      this.rampGain(toBed, 1, seconds, at);

      // Swap live references NOW so SFX + getAudioState read the new track.
      this.segments = newBank;
      this.sfxPlayers = newSfx;
      this.currentTrack = track;
      this.manifest = newManifest; // no stale manifest from the previous track
      this.segmentIndex = idx;
      this.maxSegmentReached = Math.max(this.maxSegmentReached, idx);
      // Clamp progress so a switch to a shorter song can't instantly complete it.
      this.clearProgress = Math.min(this.clearProgress, idx * this.clearsPerSegment());
      this.segmentEnteredAtProgress = this.clearProgress;
      this.songCompleted = false;
      // The new active segment's vox tracks the current reveal (sticky).
      this.applyVoxReveal(at);

      // Dispose AFTER the crossfade actually finishes: the fade starts at the next
      // bar (`at`), which can be up to a bar away, so account for that (not just
      // `seconds`) or the outgoing audio gets cut mid-transition.
      let disposeDelayMs: number;
      try {
        disposeDelayMs = Math.max(0, at - Tone.now() + seconds) * 1000 + 500;
      } catch {
        disposeDelayMs = Math.ceil((seconds + 0.6) * 1000) + 400;
      }
      window.setTimeout(() => {
        const nodes: (Tone.ToneAudioNode | undefined)[] = [];
        for (const seg of oldBank) {
          nodes.push(seg.bedPlayer, seg.voxPlayer, seg.bedGain, seg.voxGain);
        }
        nodes.push(...Object.values(oldSfx));
        for (const n of nodes) {
          try {
            n?.dispose();
          } catch {
            // ignore
          }
        }
      }, disposeDelayMs);
    } catch {
      // Switch failed: keep the old track running (never crash / never go silent).
    } finally {
      this.switching = false;
    }
  }

  /**
   * Live audio state for the test probe (so the MECHANICS are HEADLESS-VERIFIABLE).
   * Reports the horizontal advance (`segmentIndex` / `maxSegmentReached` /
   * `segmentCount` / `transitionInFlight` / `clearProgress`) and the vertical
   * reveal (`layerGains.{bed,vox}`). The ACTUAL audio-param gain values are read
   * (not computed targets) so a verification proves the ramps really moved.
   */
  getAudioState(): {
    segmentIndex: number;
    maxSegmentReached: number;
    segmentCount: number;
    transitionInFlight: boolean;
    clearProgress: number;
    voxUnlocked: boolean;
    recordedBedActive: boolean;
    layerGains: { bed: number; vox: number };
    intensity: number;
    trackId: string;
    /** @deprecated kept for back-compat with the old probe: vox gain target. */
    progression: number;
  } {
    const read = (g: Tone.Gain | undefined): number => {
      try {
        return g ? g.gain.value : 0;
      } catch {
        return 0;
      }
    };
    const active = this.segments[this.segmentIndex];
    const voxGain = read(active?.voxGain);
    return {
      segmentIndex: this.segmentIndex,
      maxSegmentReached: this.maxSegmentReached,
      segmentCount: this.segments.length,
      transitionInFlight: this.transitionInFlight,
      clearProgress: this.clearProgress,
      voxUnlocked: this.activeVoxUnlocked,
      recordedBedActive: this.recordedBedActive,
      intensity: this.intensity,
      layerGains: { bed: read(active?.bedGain), vox: voxGain },
      trackId: this.currentTrack.id,
      progression: voxGain,
    };
  }

  /**
   * Lazily start the AudioContext (must be called from a user gesture) and build
   * the whole graph + bed the first time. Idempotent. Guarded so any failure is
   * swallowed (the game must keep working with no audio rather than crash).
   */
  async unlock(): Promise<void> {
    if (this.started) return;
    if (typeof window === "undefined") return;
    try {
      await Tone.start();
      this.build();
      const t = Tone.getTransport();
      t.bpm.value = BPM;
      t.swing = 0.04;
      t.swingSubdivision = "16n";
      t.start();
      this.started = true;
      this.applyVolume();
      void this.loadRecorded();
    } catch {
      this.started = false;
    }
  }

  /** Build the synth graph + start the procedural fallback bed (always safe). */
  private build(): void {
    this.master = new Tone.Gain(this.volume).toDestination();
    this.filter = new Tone.Filter({ type: "lowpass", frequency: 1200, Q: 0.7 }).connect(
      this.master,
    );

    this.buildProceduralBed();
    this.buildActionVoices();
    this.buildProceduralBedLoops();

    // Per-beat intensity decay only (the vocal reveal is STICKY now — no decay).
    const decay = new Tone.Loop((time) => {
      this.intensity = Math.max(0, this.intensity - 0.06);
      this.applyIntensity(time);
    }, "4n").start(0);
    this.loops.push(decay);
  }

  /** The active preset's segment-advance threshold (clears per segment step). */
  private clearsPerSegment(): number {
    return Math.max(1, this.preset.curve.clearsPerSegment);
  }

  /** In-segment clears needed to unlock the vocal layer (sticky). */
  private voxUnlockClears(): number {
    return Math.max(1, this.preset.curve.voxUnlockClears);
  }

  /** Next bar-boundary transport time (safe fallback to now). */
  private nextBar(): number {
    try {
      return Tone.getTransport().nextSubdivision("1m");
    } catch {
      return Tone.now();
    }
  }

  /**
   * Schedule a gain ramp to `target` over `dur`, starting at transport time `at`,
   * using cancel→setValueAtTime(current,at)→linearRampToValueAtTime so the START
   * TIME is real (and assertable as a bar multiple), not an immediate jump.
   */
  private rampGain(g: Tone.Gain | undefined, target: number, dur: number, at?: number): void {
    if (!g) return;
    try {
      const now = Tone.now();
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

  /**
   * Load the per-track manifest (segment count + metadata). Returns undefined on
   * any failure (caller falls back to probing files up to MAX_SEGMENTS_FALLBACK).
   */
  private async loadManifest(track: TrackBundle): Promise<TrackManifest | undefined> {
    try {
      const res = await fetch(`${track.base}/manifest.json`, { cache: "force-cache" });
      if (!res.ok) return undefined;
      const m = (await res.json()) as TrackManifest;
      if (!m || !Array.isArray(m.segments) || m.segments.length === 0) return undefined;
      return m;
    } catch {
      return undefined;
    }
  }

  /**
   * Load the ordered song segments (bed + vox each) + ad-lib SFX for the CURRENT
   * track. On success the recorded bed takes over from the procedural fallback.
   */
  private async loadRecorded(): Promise<void> {
    const master = this.master;
    if (!master) return;

    // Snapshot the track we're loading. If switchTrack changes it mid-load we must
    // NOT pair this (now stale) bank/manifest with the live track — bail and let
    // switchTrack own the new bank.
    const track = this.currentTrack;
    const manifest = await this.loadManifest(track);
    const bank = await this.loadSegmentBank(track, this.segmentIndex, master, manifest);
    if (this.currentTrack.id !== track.id) {
      // A switch happened while loading: discard this bank to avoid a mismatch.
      for (const seg of bank) {
        for (const n of [seg.bedPlayer, seg.voxPlayer, seg.bedGain, seg.voxGain]) {
          try {
            n?.dispose();
          } catch {
            // ignore
          }
        }
      }
      return;
    }
    this.manifest = manifest;
    if (bank[this.segmentIndex]?.bedPlayer && !this.recordedBedActive) {
      this.recordedBedActive = true;
      this.fadeProceduralBed(0);
    }
    this.segments = bank;
    this.segmentEnteredAtProgress = this.clearProgress;

    if (this.currentTrack.id === track.id) {
      this.sfxPlayers = await this.loadSfxSet(track, master);
    }
  }

  /**
   * Load a full segment bank (bed + vox per segment) for a track, all synced to
   * transport time 0 so every loop stays in phase. The segment at `activeIndex`
   * gets bed gain 1; every other bed gain 0; all vox gains 0 (revealed later).
   * Bank size comes from the manifest, else probes up to the fallback cap.
   */
  private async loadSegmentBank(
    track: TrackBundle,
    activeIndex: number,
    master: Tone.Gain,
    manifest?: TrackManifest,
  ): Promise<Segment[]> {
    const count = manifest?.segments.length ?? MAX_SEGMENTS_FALLBACK;
    const bank: Segment[] = [];
    for (let i = 0; i < count; i++) {
      const seg: Segment = {};
      const bedUrl = manifest?.segments[i]?.bed
        ? `${track.base}/${manifest.segments[i]!.bed}`
        : segBed(track.base, i);
      const voxUrl = manifest?.segments[i]?.vox
        ? `${track.base}/${manifest.segments[i]!.vox}`
        : segVox(track.base, i);
      try {
        const bedGain = new Tone.Gain(i === activeIndex ? 1 : 0).connect(master);
        const bed = await this.loadPlayer(bedUrl);
        if (bed) {
          bed.loop = true;
          bed.connect(bedGain);
          bed.sync().start(0);
          seg.bedPlayer = bed;
          seg.bedGain = bedGain;
        } else {
          bedGain.dispose();
          // No manifest + a missing file means we've run off the end: stop probing.
          if (!manifest) {
            break;
          }
        }
      } catch {
        // segment bed missing — that index just won't play
      }
      try {
        const voxGain = new Tone.Gain(0).connect(master);
        const vox = await this.loadPlayer(voxUrl);
        if (vox) {
          vox.loop = true;
          vox.connect(voxGain);
          vox.sync().start(0);
          seg.voxPlayer = vox;
          seg.voxGain = voxGain;
        } else {
          voxGain.dispose();
        }
      } catch {
        // segment vox missing — vertical reveal just won't fire for it
      }
      bank[i] = seg;
    }
    return bank;
  }

  /** Load a track's ad-lib SFX one-shots. Returns the player map. Guarded. */
  private async loadSfxSet(
    track: TrackBundle,
    master: Tone.Gain,
  ): Promise<Partial<Record<SfxName, Tone.Player>>> {
    const out: Partial<Record<SfxName, Tone.Player>> = {};
    const files = sfxFilesFor(track.base);
    for (const name of Object.keys(files) as SfxName[]) {
      try {
        const p = await this.loadPlayer(files[name]);
        if (p) {
          p.connect(master);
          out[name] = p;
        }
      } catch {
        // missing SFX falls back to a procedural blip at play time
      }
    }
    return out;
  }

  /** Load a Tone.Player and resolve only once its buffer is ready (or null). */
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

  // ---- procedural fallback bed (only audible until/if the recording loads) --

  private buildProceduralBed(): void {
    const filter = this.filter!;

    this.kick = new Tone.MembraneSynth({
      pitchDecay: 0.03,
      octaves: 5,
      envelope: { attack: 0.001, decay: 0.4, sustain: 0.0, release: 0.2 },
      volume: -6,
    }).connect(filter);

    this.snare = new Tone.NoiseSynth({
      noise: { type: "white" },
      envelope: { attack: 0.001, decay: 0.18, sustain: 0 },
      volume: -16,
    }).connect(filter);

    this.hat = new Tone.NoiseSynth({
      noise: { type: "white" },
      envelope: { attack: 0.001, decay: 0.04, sustain: 0 },
      volume: -26,
    }).connect(filter);

    this.bass = new Tone.MonoSynth({
      oscillator: { type: "sawtooth" },
      filter: { Q: 2, type: "lowpass", rolloff: -24 },
      filterEnvelope: {
        attack: 0.01,
        decay: 0.2,
        sustain: 0.3,
        release: 0.4,
        baseFrequency: 120,
        octaves: 2.4,
      },
      envelope: { attack: 0.01, decay: 0.2, sustain: 0.4, release: 0.3 },
      volume: -12,
    }).connect(filter);

    this.arp = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: "triangle" },
      envelope: { attack: 0.005, decay: 0.12, sustain: 0.05, release: 0.18 },
      volume: -22,
    }).connect(filter);

    this.padGain = new Tone.Gain(0).connect(filter);
    this.pad = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: "fatsawtooth", count: 3, spread: 28 },
      envelope: { attack: 0.8, decay: 0.4, sustain: 0.7, release: 1.6 },
      volume: -20,
    }).connect(this.padGain);
  }

  private buildActionVoices(): void {
    const filter = this.filter!;

    this.blip = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: "square" },
      envelope: { attack: 0.002, decay: 0.08, sustain: 0, release: 0.06 },
      volume: -9,
    }).connect(this.master!);

    this.thud = new Tone.MembraneSynth({
      pitchDecay: 0.05,
      octaves: 3,
      envelope: { attack: 0.001, decay: 0.3, sustain: 0, release: 0.2 },
      volume: -8,
    }).connect(filter);

    this.lead = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: "sawtooth" },
      envelope: { attack: 0.005, decay: 0.2, sustain: 0.1, release: 0.3 },
      volume: -14,
    }).connect(filter);
  }

  /** Master gain of the procedural bed voices (ducked to 0 once the recording loads). */
  private fadeProceduralBed(level: number): void {
    const targets: (Tone.MembraneSynth | Tone.NoiseSynth | Tone.MonoSynth | Tone.PolySynth)[] = [];
    if (this.kick) targets.push(this.kick);
    if (this.snare) targets.push(this.snare);
    if (this.hat) targets.push(this.hat);
    if (this.bass) targets.push(this.bass);
    if (this.arp) targets.push(this.arp);
    for (const t of targets) {
      try {
        t.volume.rampTo(level <= 0 ? -60 : t.volume.value, 0.5);
      } catch {
        // ignore
      }
    }
    if (level <= 0) {
      try {
        this.padGain?.gain.rampTo(0, 0.5);
      } catch {
        // ignore
      }
    }
  }

  private buildProceduralBedLoops(): void {
    this.loops.push(
      new Tone.Loop((time) => {
        this.trig(() => this.kick?.triggerAttackRelease("C#1", "8n", time));
      }, "4n").start(0),
    );

    this.loops.push(
      new Tone.Loop((time) => {
        this.trig(() => this.snare?.triggerAttackRelease("16n", time));
      }, "2n").start("4n"),
    );

    this.loops.push(
      new Tone.Loop((time) => {
        this.trig(() => this.hat?.triggerAttackRelease("32n", time, 0.6));
      }, "8n").start("8n"),
    );

    const bassPhrase: (number | null)[] = [
      0, null, 0, 0, null, 5, null, 3, 0, null, 0, null, 6, null, 4, null,
    ];
    this.seq = new Tone.Sequence(
      (time, deg) => {
        if (deg === null) return;
        this.trig(() => this.bass?.triggerAttackRelease(scaleNote(deg), "16n", time));
      },
      bassPhrase,
      "16n",
    ).start(0);

    const arpDegrees = [7, 9, 11, 14];
    let arpStep = 0;
    this.loops.push(
      new Tone.Loop((time) => {
        const deg = arpDegrees[arpStep % arpDegrees.length]!;
        arpStep++;
        this.trig(() => this.arp?.triggerAttackRelease(scaleNote(deg), "16n", time, 0.4));
      }, "4n").start("8n"),
    );

    this.loops.push(
      new Tone.Loop((time) => {
        this.trig(() =>
          this.pad?.triggerAttackRelease(
            [scaleNote(0, 49), scaleNote(2, 49), scaleNote(4, 49)],
            "1m",
            time,
          ),
        );
      }, "2m").start(0),
    );
  }

  /**
   * Fire an action note, QUANTISED to the next 1/16 so it always lands on the
   * Transport grid. No-op before unlock. Guarded.
   */
  fire(ev: AudioEvent): void {
    if (!this.started || this.muted) return;
    try {
      Tone.getTransport().scheduleOnce((time) => {
        this.play(ev, time);
      }, "@16n");
    } catch {
      // ignore — audio is best-effort
    }
  }

  /** Return a trigger time strictly greater than any previously used. */
  private safeTime(time: number, span = 0): number {
    const base = Math.max(time, this.lastTriggerTime + 0.001);
    this.lastTriggerTime = base + span;
    return base;
  }

  /** Trigger a voice, swallowing any Tone error (a dropped note must never throw). */
  private trig(fn: () => void): void {
    try {
      fn();
    } catch {
      // dropped note — never surfaces to the game
    }
  }

  /** Play a recorded ad-lib one-shot at `time`. Returns false if unavailable. */
  private playSfx(name: SfxName, time: number, velocity = 1): boolean {
    const p = this.sfxPlayers[name];
    if (!p) return false;
    this.trig(() => {
      p.volume.value = Tone.gainToDb(Math.max(0.0001, Math.min(1, velocity)));
      p.start(time);
    });
    return true;
  }

  /**
   * The actual sound for an event at a grid-quantised `time`, routed through the
   * active preset: fire the recorded ad-lib (if mapped + loaded), the procedural
   * blip (if the preset asks, or as a fallback), or both. Also advances the song
   * (horizontal) + unlocks the vocal (vertical sticky) on clears.
   */
  private play(ev: AudioEvent, rawTime: number): void {
    const time = this.safeTime(rawTime);
    const route = routeEvent(this.preset, ev);

    let sfxFired = false;
    if (route.sfx) {
      const vel = ev.type === "lineClear" || ev.type === "chain" ? 1 : 0.85;
      sfxFired = this.playSfx(route.sfx, time, vel);
      if (ev.type === "chain") this.playSfx("gem", time + 0.08, 0.9);
    }

    const wantBlip = route.blip === true || (route.sfx != null && !sfxFired);
    if (wantBlip) this.playBlip(ev, time);

    if (ev.type === "lineClear") {
      const weight = 1 + ev.squares + ev.combo;
      this.bumpIntensity(0.25 + ev.squares * 0.05 + ev.combo * 0.08);
      this.advanceSong(weight, time);
    } else if (ev.type === "chain") {
      const weight = 2 + Math.min(8, ev.size);
      this.bumpIntensity(0.6);
      if (route.riser) this.riser(time);
      this.advanceSong(weight, time);
    }
  }

  /**
   * On a clear: accumulate weight, unlock the active vocal (sticky) once enough
   * IN-SEGMENT clearing has happened, and — if no transition is in flight —
   * schedule exactly ONE forward segment step when the threshold is crossed.
   */
  private advanceSong(weight: number, time: number): void {
    // No bank yet (the recorded segments load async after unlock): accumulate but
    // do NOT run horizontal advance / song-complete — otherwise an empty bank
    // (length 0 -> last = -1) would spuriously fire onSongComplete on the first
    // clears and auto-switch the track before the song has even started.
    if (this.segments.length === 0) {
      this.clearProgress += weight;
      return;
    }
    this.clearProgress += weight;

    // Sticky vertical reveal: unlock once enough clearing happened WITHIN this
    // segment (not pre-existing global progress).
    if (
      !this.activeVoxUnlocked &&
      this.clearProgress - this.segmentEnteredAtProgress >= this.voxUnlockClears()
    ) {
      this.activeVoxUnlocked = true;
      this.applyVoxReveal(this.nextBar());
    }

    if (this.transitionInFlight) return; // one step at a time; clears only accumulate

    const per = this.clearsPerSegment();
    const threshold = (this.segmentIndex + 1) * per;
    if (this.clearProgress < threshold) return;

    const last = this.segments.length - 1;
    if (this.segmentIndex >= last) {
      // Already on the final segment + threshold crossed -> the song is complete.
      if (!this.songCompleted) {
        this.songCompleted = true;
        try {
          this.onSongComplete?.();
        } catch {
          // host handler must never crash the engine
        }
      }
      return;
    }

    // Cap backlog so one huge chain advances at most this step + banks ONE more.
    this.clearProgress = Math.min(this.clearProgress, (this.segmentIndex + 2) * per);
    this.stepSegment(this.segmentIndex + 1, time);
  }

  /**
   * FORWARD-ONLY single segment step: crossfade active bed out / next bed in on
   * the next bar boundary, then COMMIT the index after the crossfade settles
   * (guarded by a token so a switchTrack/reset/dispose can't let a stale callback
   * land). The vocal reveal resets per section (with a carry-over floor).
   */
  private stepSegment(index: number, time: number): void {
    void time;
    const from = this.segments[this.segmentIndex];
    const to = this.segments[index];
    if (!to) return;

    this.transitionInFlight = true;
    const token = ++this.transitionToken;

    const at = this.nextBar();
    const xf = LAYER_RAMP_S;
    this.rampGain(from?.bedGain, 0, xf, at);
    this.rampGain(from?.voxGain, 0, xf, at);
    this.rampGain(to?.bedGain, 1, xf, at);

    // Carry-over floor for the new segment's vox if the previous was unlocked.
    this.prevVoxUnlocked = this.activeVoxUnlocked;
    const floor = this.prevVoxUnlocked ? VOX_FLOOR : 0;
    this.rampGain(to?.voxGain, floor, xf, at);

    // Commit AFTER the crossfade actually settles: nextBar can be up to a bar
    // away, so wait (at - now + xf), never just xf (review refinement #5).
    let settleMs = 200;
    try {
      settleMs = Math.max(0, at - Tone.now() + xf) * 1000 + 120;
    } catch {
      settleMs = (xf + 0.2) * 1000;
    }
    const commit = () => {
      if (token !== this.transitionToken) return; // invalidated by switch/reset/dispose
      this.segmentIndex = index;
      this.maxSegmentReached = Math.max(this.maxSegmentReached, index);
      this.segmentEnteredAtProgress = this.clearProgress;
      this.activeVoxUnlocked = false; // each section re-earns its full vocal
      this.transitionInFlight = false;
      // Reflect the carry-over floor on the (now active) segment's vox.
      this.applyVoxReveal();
    };
    try {
      if (typeof window !== "undefined") {
        window.setTimeout(commit, settleMs);
      } else {
        commit();
      }
    } catch {
      commit();
    }
  }

  /** The procedural synth voice for an action (blip / thud / lead run). */
  private playBlip(ev: AudioEvent, time: number): void {
    switch (ev.type) {
      case "move": {
        const d = scaleNote(2 + (Math.random() < 0.5 ? 0 : 1), BLIP_BASE);
        this.trig(() => this.blip?.triggerAttackRelease(d, "32n", time, 0.4));
        break;
      }
      case "rotate": {
        const d = 4 + Math.floor(Math.random() * 3);
        this.trig(() => this.blip?.triggerAttackRelease(scaleNote(d, BLIP_BASE), "32n", time, 0.6));
        this.trig(() =>
          this.blip?.triggerAttackRelease(scaleNote(d + 2, BLIP_BASE), "32n", time + 0.04, 0.5),
        );
        break;
      }
      case "softDrop": {
        this.trig(() => this.blip?.triggerAttackRelease(scaleNote(1, BLIP_BASE), "64n", time, 0.35));
        break;
      }
      case "lock": {
        this.trig(() => this.thud?.triggerAttackRelease("C#1", "8n", time, 0.7));
        break;
      }
      case "lineClear": {
        const top = energyToDegree(2 + ev.squares + ev.combo);
        const run = [0, 2, 4, top].map((d) => scaleNote(d, 49));
        run.forEach((n, i) => {
          this.trig(() => this.lead?.triggerAttackRelease(n, "16n", time + i * 0.06, 0.5));
        });
        break;
      }
      case "chain": {
        const steps = Math.min(8, 3 + ev.size);
        for (let i = 0; i < steps; i++) {
          this.trig(() =>
            this.lead?.triggerAttackRelease(scaleNote(i * 2, 49), "16n", time + i * 0.05, 0.5),
          );
        }
        break;
      }
    }
  }

  /** Brief upward filter sweep — a "riser" climax for big chain cascades. */
  private riser(time: number): void {
    const f = this.filter;
    if (!f) return;
    try {
      f.frequency.cancelScheduledValues(time);
      f.frequency.setValueAtTime(1200, time);
      f.frequency.linearRampToValueAtTime(6000, time + 0.5);
    } catch {
      // ignore
    }
  }

  private bumpIntensity(by: number): void {
    this.intensity = Math.max(0, Math.min(1, this.intensity + by));
  }

  /**
   * STICKY vertical reveal: the ACTIVE segment's vox gain targets full when
   * unlocked, the carry-over floor when not-yet-unlocked-but-previous-was, else
   * silent. Smooth ramp. Non-active segments' vox stay 0. No idle decay.
   */
  private applyVoxReveal(at?: number): void {
    const active = this.segments[this.segmentIndex];
    const g = active?.voxGain;
    if (!g) return;
    const target = this.activeVoxUnlocked ? 1 : this.prevVoxUnlocked ? VOX_FLOOR : 0;
    this.rampGain(g, target, LAYER_RAMP_S, at); // at undefined -> rampGain uses now (guarded)
  }

  /** Map intensity -> filter brightness + (procedural) pad presence. */
  private applyIntensity(time?: number): void {
    const i = this.intensity;
    try {
      const reactive = this.preset.intensityReactive;
      const baseHz = reactive ? 900 : 1600;
      const span = reactive ? 4300 : 1200;
      if (time != null) this.filter?.frequency.rampTo(baseHz + i * span, 0.4, time);
      else this.filter?.frequency.rampTo(baseHz + i * span, 0.4);
      if (!this.recordedBedActive) {
        const padLevel = Math.max(0, (i - 0.4) / 0.6) * 0.5;
        if (time != null) this.padGain?.gain.rampTo(padLevel, 0.6, time);
        else this.padGain?.gain.rampTo(padLevel, 0.6);
      }
    } catch {
      // ignore
    }
  }

  // ---- volume / mute -------------------------------------------------------

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

  /** Tear down all Tone nodes + the Transport schedule. Safe to call anytime. */
  dispose(): void {
    // Invalidate any pending segment-transition commit.
    this.transitionToken++;
    this.transitionInFlight = false;
    try {
      const t = Tone.getTransport();
      t.stop();
      t.cancel();
    } catch {
      // ignore
    }
    for (const l of this.loops) {
      try {
        l.dispose();
      } catch {
        // ignore
      }
    }
    this.loops = [];
    try {
      this.seq?.dispose();
    } catch {
      // ignore
    }
    const segmentNodes: (Tone.ToneAudioNode | undefined)[] = [];
    for (const seg of this.segments) {
      segmentNodes.push(seg.bedPlayer, seg.voxPlayer, seg.bedGain, seg.voxGain);
    }
    const nodes: (Tone.ToneAudioNode | undefined)[] = [
      ...segmentNodes,
      ...Object.values(this.sfxPlayers),
      this.kick,
      this.snare,
      this.hat,
      this.bass,
      this.arp,
      this.pad,
      this.padGain,
      this.blip,
      this.thud,
      this.lead,
      this.filter,
      this.master,
    ];
    for (const n of nodes) {
      try {
        n?.dispose();
      } catch {
        // ignore
      }
    }
    this.segments = [];
    this.sfxPlayers = {};
    this.recordedBedActive = false;
    this.segmentIndex = 0;
    this.maxSegmentReached = 0;
    this.clearProgress = 0;
    this.segmentEnteredAtProgress = 0;
    this.activeVoxUnlocked = false;
    this.prevVoxUnlocked = false;
    this.songCompleted = false;
    this.intensity = 0;
    this.started = false;
  }
}

/** @deprecated old spike name — kept as an alias during the rename. */
export { InteractiveAudioEngine as ProceduralAudioEngine };
