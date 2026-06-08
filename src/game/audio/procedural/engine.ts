/**
 * Interactive-audio engine for LLMines — v2.7 STRUCTURE-AWARE loop-vs-play model.
 *
 * Goal: make playing the game FEEL like the soundtrack RESPONDS to you and moves
 * through the real song MUSICALLY. The recorded song is cut on its ACTUAL
 * structure (scripts/cut-v27-segments.py): each section is a bar-aligned chunk
 * tagged with a role + playback modes the engine reads from the manifest.
 *
 * ── Why v2.7 (the v2.6 bug) ──────────────────────────────────────────────────
 * v2.6 tiled the song into UNIFORM 8-bar windows with no structural awareness and
 * advanced linearly, so sections reassembled in the wrong order and vocals started
 * mid-phrase. It also hardcoded BPM, lost the back half, and played a "match" SFX
 * on every clear. v2.7 fixes all of these:
 *
 *  - PER-SECTION ROLE: `looper` (intro/break/outro/chorus-backing) repeats
 *    indefinitely as the background bed; `progression` (verses/builds) plays
 *    through and advances on clears; `terminal` is the final ride-out.
 *  - PHASE-CORRECT ENTRY (the core fix): a `loopRunning` bed is prestarted and
 *    gain-gated (loopers — genuinely loopable); a `startOnEnter` bed is (re)started
 *    at OFFSET 0 on the transition bar (progressions — so they never fade in at an
 *    arbitrary loop phase, which was v2.6's mid-phrase bug).
 *  - ARMED-PHRASE VOCALS: for a progression, a clear ARMS the next vocal phrase
 *    and the engine triggers it at the next bar boundary (its phrase start), not
 *    mid-word. For a looper backing vocal (`loopLayer`) the vox is gain-revealed.
 *  - CLEAR IS SILENT: a clear has NO sound of its own — it only arms/reveals the
 *    vocal and feeds the forward-advance accumulator. (A subtle non-match bed duck
 *    acknowledges the clear; never a match SFX.)
 *  - LOCAL SECTION PROGRESS gates the forward-only, single-step, in-flight-locked
 *    advance (no fast-forward). End of song fires `onSongComplete` once.
 *  - BPM is read from the manifest, not hardcoded.
 *
 * SSR-safe: nothing touches Tone until {@link InteractiveAudioEngine.unlock} runs
 * on a real user gesture (Start). Every Tone call is guarded so a failure degrades
 * to silence — it must NEVER throw into the game (the production-start e2e asserts
 * 0 console errors).
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
import { scaleNote } from "./scale";

/** Fallback BPM if a manifest can't be read (procedural bed only). */
const FALLBACK_BPM = 110;
/** C#4 — action blips ring above the bed root so they cut through. */
const BLIP_BASE = 61;
/** Seconds for a layer-gain ramp (vox reveal + segment crossfade). */
const LAYER_RAMP_S = 0.4;
/** Carry-over vox floor into a new section when the previous vox was unlocked. */
const VOX_FLOOR = 0.25;
/** Default base path for the recorded audio assets (song 1, flat under /audio). */
const ASSET_BASE = "/audio";

/** Section role drives loop-vs-advance behavior. */
export type SectionRole = "looper" | "progression" | "terminal";
/** How a section's bed is played. */
export type BedMode = "loopRunning" | "startOnEnter";
/** How a section's vocal is revealed. */
export type VoxMode = "none" | "loopLayer" | "armedPhrase";
/** How excess clear-progress beyond a section's gate is handled. */
export type ExcessCarry = "carry" | "cap" | "discard";

/**
 * A TRACK is one full recorded soundtrack under a single asset directory, with a
 * structure `manifest.json` describing the bank. Song 1 lives flat under `/audio`;
 * song 2 ("Verde el Pipeline", phonk) under `/audio/song2`.
 */
export interface TrackBundle {
  id: string;
  base: string;
}

/** Song 1 — the default flat-`/audio` track. */
export const TRACK_SONG1: TrackBundle = { id: "song1", base: ASSET_BASE };

/** Build a TrackBundle for a per-song asset directory (e.g. "/audio/song2"). */
export function makeTrack(id: string, base: string): TrackBundle {
  return { id, base };
}

/** One section's metadata from the per-song structure manifest. */
interface ManifestSegment {
  index: number;
  name: string;
  role: SectionRole;
  bars: number;
  lengthSeconds: number;
  bedMode: BedMode;
  voxMode: VoxMode;
  voxEntryBars: number[];
  voxLoopable: boolean;
  gate: number;
  excessCarry: ExcessCarry;
  isTerminalRideout: boolean;
  completionGate: number;
  hasVox: boolean;
  bed: string;
  vox: string | null;
}
interface TrackManifest {
  id: string;
  name: string;
  tempo: number;
  barSeconds: number;
  sfxMode: "adlib" | "procedural";
  segmentCount: number;
  segments: ManifestSegment[];
}

/** One loaded section: bed + vox players + gain nodes + the manifest metadata. */
interface Segment {
  meta: ManifestSegment;
  bedPlayer?: Tone.Player;
  voxPlayer?: Tone.Player;
  bedGain?: Tone.Gain;
  voxGain?: Tone.Gain;
}

/** Build the action ad-lib SFX file paths for a track's asset directory. */
function sfxFilesFor(base: string): Record<SfxName, string> {
  return {
    move: `${base}/sfx-move.mp3`,
    rotate: `${base}/sfx-rotate.mp3`,
    softdrop: `${base}/sfx-softdrop.mp3`,
    harddrop: `${base}/sfx-harddrop.mp3`,
    stage: `${base}/sfx-stage.mp3`,
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
 * methods are no-ops before {@link unlock}.
 */
export class InteractiveAudioEngine {
  private started = false;
  private muted = false;
  private volume = 0.5;
  private preset: AudioPreset = PRESETS[DEFAULT_MIX];
  private bpm = FALLBACK_BPM;

  private master?: Tone.Gain;
  private filter?: Tone.Filter;

  private segments: Segment[] = [];
  private segmentIndex = 0;
  private maxSegmentReached = 0;
  private recordedBedActive = false;

  private currentTrack: TrackBundle = TRACK_SONG1;
  private manifest?: TrackManifest;
  private switching = false;

  private sfxPlayers: Partial<Record<SfxName, Tone.Player>> = {};

  // Procedural fallback bed voices (used only if the recorded base fails).
  private kick?: Tone.MembraneSynth;
  private snare?: Tone.NoiseSynth;
  private hat?: Tone.NoiseSynth;
  private bass?: Tone.MonoSynth;
  private arp?: Tone.PolySynth;
  private pad?: Tone.PolySynth;
  private padGain?: Tone.Gain;

  // Procedural action voices (blips — always available; song2's primary SFX layer).
  private blip?: Tone.PolySynth;
  private thud?: Tone.MembraneSynth;

  private lastTriggerTime = 0;
  private loops: Tone.Loop[] = [];
  private seq?: Tone.Sequence<number | null>;
  private intensity = 0;

  // ── Horizontal advance (LOCAL section progress) ─────────────────────────────
  /** Clearing weight accumulated WITHIN the active section (reset on entry). */
  private sectionClearProgress = 0;
  /** Excess carried INTO the next section from the previous (per excessCarry). */
  private carriedProgress = 0;
  private transitionInFlight = false;
  private transitionToken = 0;
  /** Index a transition is moving toward (so clears mid-transition attribute right). */
  private pendingSegmentIndex: number | null = null;
  /** Transport event ids scheduled for an in-flight transition (cancel on invalidate). */
  private pendingTransportEvents: number[] = [];
  onSongComplete?: () => void;
  private songCompleted = false;

  // ── Vertical (vocal) reveal ─────────────────────────────────────────────────
  private activeVoxUnlocked = false;
  private prevVoxUnlocked = false;
  /** A clear has armed the next vocal phrase (progression armedPhrase mode). */
  private voxArmed = false;
  /** Transport ids for an armed-phrase trigger (cancelled on section change). */
  private pendingVoxEvents: number[] = [];

  setPreset(mix: AudioMix): void {
    this.preset = PRESETS[mix];
    try {
      this.applyVoxReveal();
      this.applyIntensity();
    } catch {
      // best-effort
    }
  }

  getPreset(): AudioMix {
    return this.preset.mix;
  }

  setInitialTrack(track: TrackBundle): boolean {
    if (this.started) return false;
    this.currentTrack = track;
    return true;
  }

  getCurrentTrackId(): string {
    return this.currentTrack.id;
  }

  /** The active segment, or undefined. */
  private active(): Segment | undefined {
    return this.segments[this.segmentIndex];
  }

  /**
   * Live audio state for the test probe (MECHANICS are HEADLESS-VERIFIABLE).
   * Actual audio-param gains are read (not targets) so a verification proves the
   * ramps really moved. Reports the active section ROLE + bed mode so looper-holds
   * vs progression-advances are assertable.
   */
  getAudioState(): {
    segmentIndex: number;
    maxSegmentReached: number;
    segmentCount: number;
    activeRole: SectionRole | null;
    activeBedMode: BedMode | null;
    transitionInFlight: boolean;
    pendingSegmentIndex: number | null;
    sectionClearProgress: number;
    voxUnlocked: boolean;
    voxArmed: boolean;
    recordedBedActive: boolean;
    bpm: number;
    layerGains: { bed: number; vox: number };
    intensity: number;
    trackId: string;
    /** @deprecated back-compat: vox gain target. */
    progression: number;
  } {
    const read = (g: Tone.Gain | undefined): number => {
      try {
        return g ? g.gain.value : 0;
      } catch {
        return 0;
      }
    };
    const a = this.active();
    const voxGain = read(a?.voxGain);
    return {
      segmentIndex: this.segmentIndex,
      maxSegmentReached: this.maxSegmentReached,
      segmentCount: this.segments.length,
      activeRole: a?.meta.role ?? null,
      activeBedMode: a?.meta.bedMode ?? null,
      transitionInFlight: this.transitionInFlight,
      pendingSegmentIndex: this.pendingSegmentIndex,
      sectionClearProgress: this.sectionClearProgress,
      voxUnlocked: this.activeVoxUnlocked,
      voxArmed: this.voxArmed,
      recordedBedActive: this.recordedBedActive,
      bpm: this.bpm,
      layerGains: { bed: read(a?.bedGain), vox: voxGain },
      intensity: this.intensity,
      trackId: this.currentTrack.id,
      progression: voxGain,
    };
  }

  async unlock(): Promise<void> {
    if (this.started) return;
    if (typeof window === "undefined") return;
    try {
      await Tone.start();
      this.build();
      const t = Tone.getTransport();
      t.bpm.value = this.bpm; // provisional; manifest updates it once loaded
      t.swing = 0;
      t.start();
      this.started = true;
      this.applyVolume();
      void this.loadRecorded();
    } catch {
      this.started = false;
    }
  }

  private build(): void {
    this.master = new Tone.Gain(this.volume).toDestination();
    this.filter = new Tone.Filter({
      type: "lowpass",
      frequency: 1400,
      Q: 0.7,
    }).connect(this.master);
    this.buildProceduralBed();
    this.buildActionVoices();
    this.buildProceduralBedLoops();

    const decay = new Tone.Loop((time) => {
      this.intensity = Math.max(0, this.intensity - 0.06);
      this.applyIntensity(time);
    }, "4n").start(0);
    this.loops.push(decay);
  }

  // ---- timing helpers ------------------------------------------------------

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
   * time is real (and assertable as a bar multiple), not an immediate jump.
   */
  private rampGain(
    g: Tone.Gain | undefined,
    target: number,
    dur: number,
    at?: number,
  ): void {
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

  /** Cancel any scheduled automation on a gain (used when invalidating a transition). */
  private cancelGain(g: Tone.Gain | undefined): void {
    if (!g) return;
    try {
      const now = Tone.now();
      const cur = g.gain.value;
      g.gain.cancelScheduledValues(now);
      g.gain.setValueAtTime(cur, now);
    } catch {
      // ignore
    }
  }

  // ---- manifest + asset loading -------------------------------------------

  private async loadManifest(
    track: TrackBundle,
  ): Promise<TrackManifest | undefined> {
    try {
      const res = await fetch(`${track.base}/manifest.json`, {
        cache: "force-cache",
      });
      if (!res.ok) return undefined;
      const m = (await res.json()) as TrackManifest;
      if (!m || !Array.isArray(m.segments) || m.segments.length === 0)
        return undefined;
      return m;
    } catch {
      return undefined;
    }
  }

  private async loadRecorded(): Promise<void> {
    const master = this.master;
    if (!master) return;
    const track = this.currentTrack;
    const manifest = await this.loadManifest(track);
    if (!manifest) return; // no structured assets — procedural bed keeps running
    const bank = await this.loadSegmentBank(
      track,
      this.segmentIndex,
      master,
      manifest,
    );
    if (this.currentTrack.id !== track.id) {
      this.disposeBank(bank);
      return;
    }
    this.manifest = manifest;
    this.applyManifestTempo(manifest);
    if (bank[this.segmentIndex]?.bedPlayer && !this.recordedBedActive) {
      this.recordedBedActive = true;
      this.fadeProceduralBed(0);
    }
    this.segments = bank;
    this.enterSection(this.segmentIndex, this.nextBar(), /*fresh*/ true);
    if (this.currentTrack.id === track.id) {
      this.sfxPlayers = await this.loadSfxSet(track, master);
    }
  }

  private applyManifestTempo(m: TrackManifest): void {
    this.bpm = m.tempo > 0 ? m.tempo : this.bpm;
    try {
      Tone.getTransport().bpm.value = this.bpm;
    } catch {
      // ignore
    }
  }

  /**
   * Load a full segment bank. A `loopRunning` bed is started looping synced to the
   * transport (phase-running, gain-gated). A `startOnEnter` bed is NOT started here
   * — it is started at offset 0 on entry so it enters phase-correct.
   */
  private async loadSegmentBank(
    track: TrackBundle,
    activeIndex: number,
    master: Tone.Gain,
    manifest: TrackManifest,
  ): Promise<Segment[]> {
    // Load every section's bed + vox CONCURRENTLY (independent fetches): a full
    // song is 10-12 sections × 2 players, and loading serially made Start wait on
    // ~20 sequential decodes. Parallel load keeps the bed audible quickly.
    const loadOne = async (i: number): Promise<Segment> => {
      const meta = manifest.segments[i]!;
      const seg: Segment = { meta };
      try {
        const bedGain = new Tone.Gain(i === activeIndex ? 1 : 0).connect(master);
        const bed = await this.loadPlayer(`${track.base}/${meta.bed}`);
        if (bed) {
          bed.loop = true;
          bed.connect(bedGain);
          if (meta.bedMode === "loopRunning") {
            bed.sync().start(0); // phase-running with the transport
          }
          seg.bedPlayer = bed;
          seg.bedGain = bedGain;
        } else {
          bedGain.dispose();
        }
      } catch {
        // bed missing — that section just won't play
      }
      if (meta.hasVox && meta.vox) {
        try {
          const voxGain = new Tone.Gain(0).connect(master);
          const vox = await this.loadPlayer(`${track.base}/${meta.vox}`);
          if (vox) {
            vox.loop = meta.voxMode === "loopLayer";
            vox.connect(voxGain);
            if (meta.voxMode === "loopLayer") vox.sync().start(0);
            seg.voxPlayer = vox;
            seg.voxGain = voxGain;
          } else {
            voxGain.dispose();
          }
        } catch {
          // vox missing — reveal just won't fire
        }
      }
      return seg;
    };
    return Promise.all(manifest.segments.map((_, i) => loadOne(i)));
  }

  private async loadSfxSet(
    track: TrackBundle,
    master: Tone.Gain,
  ): Promise<Partial<Record<SfxName, Tone.Player>>> {
    const out: Partial<Record<SfxName, Tone.Player>> = {};
    // Procedural-SFX songs (song2) deliberately use the in-key blip layer, not
    // recorded one-shots: skip loading recorded SFX so actions fall back to blips.
    if (this.manifest?.sfxMode === "procedural") return out;
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

  private disposeBank(bank: Segment[]): void {
    for (const seg of bank) {
      for (const n of [
        seg.bedPlayer,
        seg.voxPlayer,
        seg.bedGain,
        seg.voxGain,
      ]) {
        try {
          n?.dispose();
        } catch {
          // ignore
        }
      }
    }
  }

  // ---- section entry (PHASE-CORRECT) --------------------------------------

  /**
   * Enter section `index` at transport time `at`. PHASE-CORRECT: a `startOnEnter`
   * bed is (re)started at offset 0 so it enters at its musical start (the v2.6
   * mid-phrase fix); a `loopRunning` bed is already phase-running, just gain it up.
   * Resets the local section progress + vocal-arm state for the new section.
   */
  private enterSection(index: number, at: number, fresh: boolean): void {
    const seg = this.segments[index];
    if (!seg) return;

    // Clear any armed-phrase pending triggers from the previous section.
    this.clearPendingVox();

    if (seg.meta.bedMode === "startOnEnter" && seg.bedPlayer) {
      try {
        seg.bedPlayer.stop();
        seg.bedPlayer.loop = true;
        // start at offset 0 on the bar boundary -> musical start, never mid-phrase
        seg.bedPlayer.start(at, 0);
      } catch {
        // ignore
      }
    }
    this.rampGain(seg.bedGain, 1, fresh ? 0.01 : LAYER_RAMP_S, at);

    // Vocal: carry-over floor if the previous section's vocal was unlocked.
    this.activeVoxUnlocked = false;
    this.voxArmed = false;
    const floor = this.prevVoxUnlocked ? VOX_FLOOR : 0;
    if (seg.meta.voxMode === "loopLayer") {
      this.rampGain(seg.voxGain, floor, LAYER_RAMP_S, at);
    } else {
      // armedPhrase / none start silent; armed-phrase waits for a clear.
      this.rampGain(seg.voxGain, 0, 0.05, at);
    }

    // Reset local progress; absorb any excess carried from the previous section.
    this.sectionClearProgress = this.carriedProgress;
    this.carriedProgress = 0;
  }

  // ---- event play ----------------------------------------------------------

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

  private safeTime(time: number, span = 0): number {
    const base = Math.max(time, this.lastTriggerTime + 0.001);
    this.lastTriggerTime = base + span;
    return base;
  }

  private trig(fn: () => void): void {
    try {
      fn();
    } catch {
      // dropped note — never surfaces to the game
    }
  }

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
   * The sound for an action. CLEAR IS SILENT: lineClear/chain fire NO sound of
   * their own — they only arm/reveal vocals + feed the advance accumulator (a
   * subtle bed duck acknowledges the clear). Non-clear actions fire their mapped
   * ad-lib (song1) or procedural blip (song2 / fallback).
   */
  private play(ev: AudioEvent, rawTime: number): void {
    const time = this.safeTime(rawTime);

    if (ev.type === "lineClear") {
      this.bumpIntensity(0.25 + ev.squares * 0.05 + ev.combo * 0.08);
      this.clearDuck(time);
      this.onClear(1 + ev.squares + ev.combo, time);
      return;
    }
    if (ev.type === "chain") {
      this.bumpIntensity(0.6);
      this.clearDuck(time);
      this.onClear(2 + Math.min(8, ev.size), time);
      return;
    }

    // Non-clear actions: route to recorded ad-lib and/or procedural blip.
    const route = routeEvent(this.preset, ev);
    let sfxFired = false;
    if (route.sfx) sfxFired = this.playSfx(route.sfx, time, 0.85);
    const wantBlip =
      route.blip === true ||
      (route.sfx != null && !sfxFired) ||
      !this.recordedBedActive;
    if (wantBlip || this.manifest?.sfxMode === "procedural")
      this.playBlip(ev, time);
  }

  /**
   * Subtle NON-match acknowledgment of a clear (D15): a brief bed duck on the
   * master filter — never a match SFX. Keeps the clear feeling connected without
   * giving clearing its own sound.
   */
  private clearDuck(time: number): void {
    const f = this.filter;
    if (!f) return;
    try {
      const base =
        1400 + this.intensity * (this.preset.intensityReactive ? 4000 : 800);
      f.frequency.cancelScheduledValues(time);
      f.frequency.setValueAtTime(base * 0.6, time);
      f.frequency.linearRampToValueAtTime(base, time + 0.18);
    } catch {
      // ignore
    }
  }

  // ---- clear handling: arm vocals + advance (LOCAL progress) --------------

  private onClear(weight: number, time: number): void {
    if (this.segments.length === 0) return;
    this.sectionClearProgress += weight;

    const seg = this.active();
    if (!seg) return;

    // Vocal state as it was BEFORE this clear (so the clear that first arms a
    // progression's vocal does not also advance off it).
    const voxWasLive = this.activeVoxUnlocked || this.voxArmed;

    // VERTICAL: reveal/arm the vocal for the active section.
    this.revealVocal(seg);

    // HORIZONTAL: forward-only, single-step, in-flight-locked.
    if (this.transitionInFlight) return;

    const gate = Math.max(1, this.gateFor(seg.meta));
    if (this.sectionClearProgress < gate) return;

    // A PROGRESSION must let its vocal phrase play before advancing: don't step on
    // the same clear that first arms/reveals the vocal — give the section a beat so
    // the vocal is actually heard (matches "vocals layer on clear, THEN advance").
    if (
      seg.meta.role === "progression" &&
      seg.meta.voxMode !== "none" &&
      !voxWasLive
    ) {
      return;
    }

    const last = this.segments.length - 1;
    if (seg.meta.isTerminalRideout || this.segmentIndex >= last) {
      // Terminal: complete only if a completionGate is set (>0); else ride out.
      const cg = seg.meta.completionGate;
      if (cg > 0 && this.sectionClearProgress >= cg && !this.songCompleted) {
        this.complete();
      }
      return;
    }

    // Compute carry per this section's policy, then step.
    const excess = this.sectionClearProgress - gate;
    this.carriedProgress = this.carryExcess(seg.meta, excess, gate);
    this.stepSegment(this.segmentIndex + 1, time);
  }

  /** The clear-gate for a section, preset-scaled. */
  private gateFor(meta: ManifestSegment): number {
    return Math.max(1, Math.round(meta.gate * this.preset.gateScale));
  }

  private carryExcess(
    meta: ManifestSegment,
    excess: number,
    gate: number,
  ): number {
    switch (meta.excessCarry) {
      case "carry":
        return Math.max(0, Math.min(excess, gate)); // carry up to one gate's worth
      case "cap":
        return Math.min(Math.max(0, excess), 1);
      default:
        return 0; // discard
    }
  }

  /** Reveal the active section's vocal: loopLayer = gain up; armedPhrase = arm. */
  private revealVocal(seg: Segment): void {
    if (seg.meta.voxMode === "loopLayer") {
      if (
        !this.activeVoxUnlocked &&
        this.sectionClearProgress >= this.voxUnlockClears()
      ) {
        this.activeVoxUnlocked = true;
        this.applyVoxReveal(this.nextBar());
      }
    } else if (seg.meta.voxMode === "armedPhrase") {
      if (!this.activeVoxUnlocked && !this.voxArmed) {
        this.armVocalPhrase(seg);
      }
    }
  }

  private voxUnlockClears(): number {
    return Math.max(1, Math.round(this.preset.voxUnlockClears));
  }

  /**
   * ARMED-PHRASE (D10): a clear arms the vocal; fire it at the next bar boundary
   * (its phrase start), never mid-word. The section bed is bar-aligned, so the bar
   * boundary lands the phrase at a bar.
   */
  private armVocalPhrase(seg: Segment): void {
    this.voxArmed = true;
    if (!seg.voxPlayer || !seg.voxGain) {
      // no vocal asset: mark unlocked so the probe reflects intent
      this.activeVoxUnlocked = true;
      return;
    }
    try {
      const id = Tone.getTransport().scheduleOnce((t) => {
        if (this.active() !== seg) return; // section changed — drop
        try {
          seg.voxPlayer?.stop();
          seg.voxPlayer?.start(t, 0); // phrase from its start
        } catch {
          // ignore
        }
        this.activeVoxUnlocked = true;
        this.rampGain(seg.voxGain, 1, LAYER_RAMP_S, t);
      }, "@1m");
      this.pendingVoxEvents.push(id);
    } catch {
      // ignore
    }
  }

  private clearPendingVox(): void {
    for (const id of this.pendingVoxEvents) {
      try {
        Tone.getTransport().clear(id);
      } catch {
        // ignore
      }
    }
    this.pendingVoxEvents = [];
  }

  // ---- forward-only segment step (AUDIO-CLOCK commit) ---------------------

  /**
   * FORWARD-ONLY single step: crossfade active bed out / next bed in on the next
   * bar boundary, ENTER the next section phase-correct, and COMMIT the index on the
   * AUDIO CLOCK (a Transport callback) — with a setTimeout fallback — guarded by a
   * token so a switchTrack/reset/dispose can't let a stale callback land.
   */
  private stepSegment(index: number, time: number): void {
    void time;
    const from = this.active();
    const to = this.segments[index];
    if (!to) return;

    this.transitionInFlight = true;
    this.pendingSegmentIndex = index;
    const token = ++this.transitionToken;

    const at = this.nextBar();
    const xf = LAYER_RAMP_S;
    this.prevVoxUnlocked = this.activeVoxUnlocked;
    this.rampGain(from?.bedGain, 0, xf, at);
    this.rampGain(from?.voxGain, 0, xf, at);
    // enterSection ramps the new bed up + (re)starts a startOnEnter bed at offset 0.
    this.enterSection(index, at, /*fresh*/ false);

    const commit = () => {
      if (token !== this.transitionToken) return;
      this.segmentIndex = index;
      this.maxSegmentReached = Math.max(this.maxSegmentReached, index);
      this.transitionInFlight = false;
      this.pendingSegmentIndex = null;
    };
    // Commit on the audio clock at the crossfade settle point; setTimeout fallback.
    try {
      const id = Tone.getTransport().scheduleOnce(
        () => commit(),
        at + xf + 0.02,
      );
      this.pendingTransportEvents.push(id);
    } catch {
      // ignore — fallback below covers it
    }
    let settleMs = (xf + 0.2) * 1000;
    try {
      settleMs = Math.max(0, at - Tone.now() + xf) * 1000 + 150;
    } catch {
      // keep default
    }
    try {
      if (typeof window !== "undefined") window.setTimeout(commit, settleMs);
      else commit();
    } catch {
      commit();
    }
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

  // ---- live track switch ---------------------------------------------------

  /**
   * Live-swap the soundtrack with a beat-aligned crossfade. Loads the new track's
   * bank + SFX, crossfades on the next bar. Invalidates any pending transition and
   * CANCELS its scheduled ramps (token guards stale JS, not stale Web Audio
   * automation — D11). A startOnEnter destination is entered phase-correct.
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

    // Invalidate + CANCEL any pending transition's audio automation.
    this.transitionToken++;
    this.transitionInFlight = false;
    this.invalidatePending();

    try {
      const newManifest = await this.loadManifest(track);
      if (!newManifest) {
        this.switching = false;
        return;
      }
      const provisionalIdx = Math.min(
        this.segmentIndex,
        newManifest.segments.length - 1,
      );
      const newBank = await this.loadSegmentBank(
        track,
        provisionalIdx,
        master,
        newManifest,
      );
      const newSfx = await this.loadSfxSet(track, master);
      const idx = Math.min(provisionalIdx, Math.max(0, newBank.length - 1));

      const oldBank = this.segments;
      const oldSfx = this.sfxPlayers;
      const from = oldBank[this.segmentIndex];
      const at = this.nextBar();

      this.rampGain(from?.bedGain, 0, seconds, at);
      this.rampGain(from?.voxGain, 0, seconds, at);

      // Swap live refs, then ENTER the destination phase-correct.
      this.segments = newBank;
      this.sfxPlayers = newSfx;
      this.currentTrack = track;
      this.manifest = newManifest;
      this.applyManifestTempo(newManifest);
      this.segmentIndex = idx;
      this.maxSegmentReached = Math.max(this.maxSegmentReached, idx);
      this.songCompleted = false;
      this.carriedProgress = 0;
      this.enterSection(idx, at, /*fresh*/ false);
      this.rampGain(newBank[idx]?.bedGain, 1, seconds, at);

      let disposeDelayMs: number;
      try {
        disposeDelayMs = Math.max(0, at - Tone.now() + seconds) * 1000 + 500;
      } catch {
        disposeDelayMs = Math.ceil((seconds + 0.6) * 1000) + 400;
      }
      window.setTimeout(() => {
        this.disposeBank(oldBank);
        for (const n of Object.values(oldSfx)) {
          try {
            n?.dispose();
          } catch {
            // ignore
          }
        }
      }, disposeDelayMs);
    } catch {
      // keep the old track running (never crash / never go silent)
    } finally {
      this.switching = false;
    }
  }

  /** Cancel pending transition transport events + their ramps. */
  private invalidatePending(): void {
    for (const id of this.pendingTransportEvents) {
      try {
        Tone.getTransport().clear(id);
      } catch {
        // ignore
      }
    }
    this.pendingTransportEvents = [];
    this.clearPendingVox();
    const a = this.active();
    this.cancelGain(a?.bedGain);
    this.cancelGain(a?.voxGain);
    if (this.pendingSegmentIndex != null) {
      const p = this.segments[this.pendingSegmentIndex];
      this.cancelGain(p?.bedGain);
      this.cancelGain(p?.voxGain);
    }
    this.pendingSegmentIndex = null;
  }

  // ---- procedural fallback bed + action voices ----------------------------

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
      oscillator: { type: "triangle" },
      envelope: { attack: 0.002, decay: 0.09, sustain: 0, release: 0.07 },
      volume: -12,
    }).connect(this.master!);
    this.thud = new Tone.MembraneSynth({
      pitchDecay: 0.05,
      octaves: 3,
      envelope: { attack: 0.001, decay: 0.3, sustain: 0, release: 0.2 },
      volume: -8,
    }).connect(filter);
  }

  private fadeProceduralBed(level: number): void {
    const targets: (
      | Tone.MembraneSynth
      | Tone.NoiseSynth
      | Tone.MonoSynth
      | Tone.PolySynth
    )[] = [];
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
      0,
      null,
      0,
      0,
      null,
      5,
      null,
      3,
      0,
      null,
      0,
      null,
      6,
      null,
      4,
      null,
    ];
    this.seq = new Tone.Sequence(
      (time, deg) => {
        if (deg === null) return;
        this.trig(() =>
          this.bass?.triggerAttackRelease(scaleNote(deg), "16n", time),
        );
      },
      bassPhrase,
      "16n",
    ).start(0);
  }

  /** Procedural in-key action tone (song2's primary SFX layer / song1 fallback). */
  private playBlip(ev: AudioEvent, time: number): void {
    switch (ev.type) {
      case "move": {
        const d = scaleNote(2 + (Math.random() < 0.5 ? 0 : 1), BLIP_BASE);
        this.trig(() => this.blip?.triggerAttackRelease(d, "32n", time, 0.35));
        break;
      }
      case "rotate": {
        const d = 4 + Math.floor(Math.random() * 3);
        this.trig(() =>
          this.blip?.triggerAttackRelease(
            scaleNote(d, BLIP_BASE),
            "32n",
            time,
            0.5,
          ),
        );
        break;
      }
      case "softDrop": {
        this.trig(() =>
          this.blip?.triggerAttackRelease(
            scaleNote(1, BLIP_BASE),
            "64n",
            time,
            0.3,
          ),
        );
        break;
      }
      case "lock": {
        this.trig(() =>
          this.thud?.triggerAttackRelease("C#1", "8n", time, 0.6),
        );
        break;
      }
      default:
        break; // clears are silent
    }
  }

  private bumpIntensity(by: number): void {
    this.intensity = Math.max(0, Math.min(1, this.intensity + by));
  }

  private applyVoxReveal(at?: number): void {
    const a = this.active();
    const g = a?.voxGain;
    if (!g) return;
    const target = this.activeVoxUnlocked
      ? 1
      : this.prevVoxUnlocked
        ? VOX_FLOOR
        : 0;
    this.rampGain(g, target, LAYER_RAMP_S, at);
  }

  private applyIntensity(time?: number): void {
    const i = this.intensity;
    try {
      const reactive = this.preset.intensityReactive;
      const baseHz = reactive ? 1000 : 1600;
      const span = reactive ? 4000 : 1000;
      if (time != null)
        this.filter?.frequency.rampTo(baseHz + i * span, 0.4, time);
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

  dispose(): void {
    this.transitionToken++;
    this.transitionInFlight = false;
    this.invalidatePending();
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
    this.disposeBank(this.segments);
    const nodes: (Tone.ToneAudioNode | undefined)[] = [
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
    this.sectionClearProgress = 0;
    this.carriedProgress = 0;
    this.activeVoxUnlocked = false;
    this.prevVoxUnlocked = false;
    this.voxArmed = false;
    this.songCompleted = false;
    this.intensity = 0;
    this.started = false;
  }
}

/** @deprecated old spike name — kept as an alias during the rename. */
export { InteractiveAudioEngine as ProceduralAudioEngine };
