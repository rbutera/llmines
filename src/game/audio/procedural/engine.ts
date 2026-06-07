/**
 * Interactive-audio engine for LLMines.
 *
 * Goal: make playing the game FEEL like the soundtrack is responding to you.
 * The bed is the REAL recorded song (C# minor, ~112 BPM) split into stem
 * layers; action SFX are the REAL backing-vocal ad-lib one-shots. A synthesised
 * fallback bed + blips cover the case where the recorded assets fail to load, so
 * the engine always makes sound.
 *
 * ── Clock approach ──────────────────────────────────────────────────────────
 * The engine runs its OWN `Tone.Transport` as the master musical clock (112 BPM)
 * and starts every recorded stem loop + every action note ON that transport. It
 * does NOT drive — and is not driven by — the game's deterministic core or the
 * `window.__lumines` seam: this layer only SUBSCRIBES to the already-emitted
 * RenderState and fires sound. Action notes/SFX are quantised to the transport's
 * `@16n` grid and every synth note is drawn from the C#-minor scale, so they
 * always land on-beat and in-key with the bed.
 *
 * ── Clearing advances the song (the heart of the feel) ──────────────────────
 * The recorded bed is FOUR phase-aligned stem loops cut from the same window:
 *   - bed-base  (drums + bass + perc) — always audible.
 *   - layer-melody (synth + other)    — unlocks first.
 *   - layer-guitar                     — unlocks on sustained clearing.
 *   - layer-vocal (lead + backing)     — unlocks on a hot streak.
 * A `progression` scalar (0..1) is bumped by clears/combos/chains and decays
 * when idle; each upper layer's gain ramps smoothly across its reveal band, so
 * clearing UNFOLDS the song and going quiet lets it RECEDE back to the bed. The
 * unlock curve (and the action→voice routing) come from the active {@link
 * AudioPreset}, so the three mixes (A subtle / B reactive / C maximal) feel
 * genuinely different.
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
  layerGain,
  PRESETS,
  routeEvent,
  type SfxName,
} from "./presets";
import { energyToDegree, scaleNote } from "./scale";

const BPM = 112;
/** C#4 — action blips ring ~2 octaves above the bed root (C#2) so they cut through. */
const BLIP_BASE = 61;

/** Public base path for the recorded audio assets. */
const ASSET_BASE = "/audio";

/** The recorded stem layers. `base` is always on; the rest are clear-gated. */
const LAYER_FILES = {
  base: `${ASSET_BASE}/bed-base.mp3`,
  melody: `${ASSET_BASE}/layer-melody.mp3`,
  guitar: `${ASSET_BASE}/layer-guitar.mp3`,
  vocal: `${ASSET_BASE}/layer-vocal.mp3`,
} as const;

type UpperLayer = "melody" | "guitar" | "vocal";

/** The eight curated ad-lib one-shots and their files. */
const SFX_FILES: Record<SfxName, string> = {
  move: `${ASSET_BASE}/sfx-move.mp3`,
  rotate: `${ASSET_BASE}/sfx-rotate.mp3`,
  lock: `${ASSET_BASE}/sfx-lock.mp3`,
  match: `${ASSET_BASE}/sfx-match.mp3`,
  softdrop: `${ASSET_BASE}/sfx-softdrop.mp3`,
  harddrop: `${ASSET_BASE}/sfx-harddrop.mp3`,
  gem: `${ASSET_BASE}/sfx-gem.mp3`,
  chain: `${ASSET_BASE}/sfx-chain.mp3`,
};

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

  // Recorded bed: one Player per stem layer + a gain per upper layer.
  private layerPlayers: Partial<Record<keyof typeof LAYER_FILES, Tone.Player>> = {};
  private layerGains: Partial<Record<UpperLayer, Tone.Gain>> = {};
  /** True once the recorded base bed loaded + started (else the synth bed runs). */
  private recordedBedActive = false;

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

  /**
   * Monotonic "next safe trigger time" guard. Tone's monophonic + membrane
   * voices throw "Start time must be strictly greater than previous start time"
   * if retriggered at the EXACT same audio time — which happens because many
   * rapid game events quantise onto the same `@16n` grid slot. We nudge each
   * trigger to be strictly after the last by a tiny epsilon so two notes never
   * collide on the same sample. Render-only; inaudible (sub-millisecond).
   */
  private lastTriggerTime = 0;

  // Bed loops (procedural fallback) + the bass sequence — kept so dispose stops them.
  private loops: Tone.Loop[] = [];
  private seq?: Tone.Sequence<number | null>;

  // Adaptive intensity: 0 (calm) .. 1 (hot). Decays each beat; bumped on clears.
  private intensity = 0;
  /**
   * Song progression: 0 (just the bed) .. 1 (full mix). Clears bump it, idle
   * decays it; the upper layer gains track it via the active preset's bands.
   */
  private progression = 0;

  /** Pick the active mix (instant — no teardown). */
  setPreset(mix: AudioMix): void {
    this.preset = PRESETS[mix];
    // Re-apply both reactive surfaces so the switch takes effect immediately.
    try {
      this.applyProgression();
      this.applyIntensity();
    } catch {
      // ignore — best-effort
    }
  }

  getPreset(): AudioMix {
    return this.preset.mix;
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
      await Tone.start(); // resumes the AudioContext under the gesture
      this.build();
      const t = Tone.getTransport();
      t.bpm.value = BPM;
      t.swing = 0.04; // a touch of shuffle
      t.swingSubdivision = "16n";
      t.start();
      this.started = true;
      this.applyVolume();
      // Load the recorded assets in the background; until/if they arrive the
      // procedural fallback bed already plays, so there's never dead air.
      void this.loadRecorded();
    } catch {
      // Audio unavailable / blocked: degrade to silence, never throw.
      this.started = false;
    }
  }

  /** Build the synth graph + start the procedural fallback bed (always safe). */
  private build(): void {
    this.master = new Tone.Gain(this.volume).toDestination();
    // Low-pass the whole mix; intensity opens it up (brighter = hotter).
    this.filter = new Tone.Filter({ type: "lowpass", frequency: 1200, Q: 0.7 }).connect(
      this.master,
    );

    this.buildProceduralBed();
    this.buildActionVoices();
    this.buildProceduralBedLoops();

    // Per-beat intensity + progression decay; ramp the reactive surfaces.
    const decay = new Tone.Loop((time) => {
      this.intensity = Math.max(0, this.intensity - 0.06);
      this.progression = Math.max(0, this.progression - this.preset.curve.decayPerBeat);
      this.applyIntensity(time);
      this.applyProgression(time);
    }, "4n").start(0);
    this.loops.push(decay);
  }

  /**
   * Load the recorded stem layers + ad-lib SFX. On success, the recorded base
   * bed takes over from the procedural fallback (which is faded out). Fully
   * guarded; a partial failure simply leaves the missing pieces synthesised.
   */
  private async loadRecorded(): Promise<void> {
    const master = this.master;
    const filter = this.filter;
    if (!master || !filter) return;

    // --- stem layers ---
    try {
      const baseGain = new Tone.Gain(1).connect(master); // base goes direct to master (full, un-ducked)
      const base = await this.loadPlayer(LAYER_FILES.base);
      if (base) {
        base.loop = true;
        base.connect(baseGain);
        base.sync().start(0);
        this.layerPlayers.base = base;
        this.recordedBedActive = true;
        // Fade the procedural fallback bed out now the real bed is in.
        this.fadeProceduralBed(0);
      }
    } catch {
      // keep the procedural bed
    }

    if (this.recordedBedActive) {
      for (const layer of ["melody", "guitar", "vocal"] as UpperLayer[]) {
        try {
          const g = new Tone.Gain(0).connect(master); // starts silent, clear-gated
          const p = await this.loadPlayer(LAYER_FILES[layer]);
          if (p) {
            p.loop = true;
            p.connect(g);
            p.sync().start(0);
            this.layerPlayers[layer] = p;
            this.layerGains[layer] = g;
          } else {
            g.dispose();
          }
        } catch {
          // missing layer just never reveals — bed still plays
        }
      }
      this.applyProgression();
    }

    // --- ad-lib SFX (independent of the bed; load even if the bed failed) ---
    for (const name of Object.keys(SFX_FILES) as SfxName[]) {
      try {
        const p = await this.loadPlayer(SFX_FILES[name]);
        if (p) {
          p.connect(master);
          this.sfxPlayers[name] = p;
        }
      } catch {
        // missing SFX falls back to a procedural blip at play time
      }
    }
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

    // Pad rides its own gain so adaptive intensity can fade it in/out.
    this.padGain = new Tone.Gain(0).connect(filter);
    this.pad = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: "fatsawtooth", count: 3, spread: 28 },
      envelope: { attack: 0.8, decay: 0.4, sustain: 0.7, release: 1.6 },
      volume: -20,
    }).connect(this.padGain);
  }

  private buildActionVoices(): void {
    const filter = this.filter!;

    // Action blips bypass the lowpass (-> master direct) so they stay CRISP and
    // cut through the (filtered, low) bed.
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
    // dB target: 0 -> -Infinity (silence), 1 -> keep current (no-op here).
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
    // Four-on-the-floor kick.
    this.loops.push(
      new Tone.Loop((time) => {
        this.trig(() => this.kick?.triggerAttackRelease("C#1", "8n", time));
      }, "4n").start(0),
    );

    // Backbeat snare on 2 + 4.
    this.loops.push(
      new Tone.Loop((time) => {
        this.trig(() => this.snare?.triggerAttackRelease("16n", time));
      }, "2n").start("4n"),
    );

    // Off-beat hats (1/8 with swing).
    this.loops.push(
      new Tone.Loop((time) => {
        this.trig(() => this.hat?.triggerAttackRelease("32n", time, 0.6));
      }, "8n").start("8n"),
    );

    // C#-minor bassline: a 16-step phrase, low octave. Degrees from C#2; null = rest.
    const bassPhrase: (number | null)[] = [
      0, null, 0, 0, null, 5, null, 3,
      0, null, 0, null, 6, null, 4, null,
    ];
    this.seq = new Tone.Sequence(
      (time, deg) => {
        if (deg === null) return;
        this.trig(() => this.bass?.triggerAttackRelease(scaleNote(deg), "16n", time));
      },
      bassPhrase,
      "16n",
    ).start(0);

    // Soft arp on the up-beats, an octave up.
    const arpDegrees = [7, 9, 11, 14];
    let arpStep = 0;
    this.loops.push(
      new Tone.Loop((time) => {
        const deg = arpDegrees[arpStep % arpDegrees.length]!;
        arpStep++;
        this.trig(() => this.arp?.triggerAttackRelease(scaleNote(deg), "16n", time, 0.4));
      }, "4n").start("8n"),
    );

    // Pad: a slow C#-minor chord every two bars (rides padGain).
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
   * Transport grid (on the beat) and — being scale-derived — always in key.
   * No-op before unlock. Guarded: a scheduling failure never throws.
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

  /**
   * Return a trigger time strictly greater than any previously used, advancing
   * the monotonic guard. Prevents Tone's "start time must be strictly greater"
   * throw when many events land on the same quantised grid slot.
   */
  private safeTime(time: number, span = 0): number {
    const base = Math.max(time, this.lastTriggerTime + 0.001);
    this.lastTriggerTime = base + span;
    return base;
  }

  /**
   * Trigger a voice, swallowing any Tone error. Tone's monophonic + membrane
   * voices throw synchronously if two notes hit the same audio time. A dropped
   * note is fine; what must NEVER happen is the throw escaping into the page (the
   * production-start e2e asserts 0 page errors). Used by EVERY trigger.
   */
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
   * active preset: fire the recorded ad-lib (if the preset maps one and it
   * loaded), the procedural blip (if the preset asks, or as a fallback when the
   * ad-lib is missing), or both. Also advances the song progression so clearing
   * reveals the recorded layers.
   */
  private play(ev: AudioEvent, rawTime: number): void {
    const time = this.safeTime(rawTime);
    const route = routeEvent(this.preset, ev);

    // Recorded ad-lib (preset-mapped). Track whether it actually fired so we can
    // fall back to a blip if the buffer is missing.
    let sfxFired = false;
    if (route.sfx) {
      const vel = ev.type === "lineClear" || ev.type === "chain" ? 1 : 0.85;
      sfxFired = this.playSfx(route.sfx, time, vel);
      // Big musical moments also fire the gem one-shot for extra payoff.
      if (ev.type === "chain") this.playSfx("gem", time + 0.08, 0.9);
    }

    // Procedural blip: when the preset asks for it, OR as a fallback when a
    // mapped ad-lib couldn't play (so an action ALWAYS makes a sound — rotate in
    // particular must never be silent).
    const wantBlip = route.blip === true || (route.sfx != null && !sfxFired);
    if (wantBlip) this.playBlip(ev, time);

    // Progression + intensity bumps on clears (advance the song).
    const c = this.preset.curve;
    if (ev.type === "lineClear") {
      this.bumpProgression(ev.squares * c.perSquare + ev.combo * c.perCombo);
      this.bumpIntensity(0.25 + ev.squares * 0.05 + ev.combo * 0.08);
    } else if (ev.type === "chain") {
      this.bumpProgression(Math.min(8, ev.size) * c.perChain);
      this.bumpIntensity(0.6);
      if (route.riser) this.riser(time);
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

  private bumpProgression(by: number): void {
    this.progression = Math.max(0, Math.min(1, this.progression + by));
    this.applyProgression();
  }

  /**
   * Map progression -> per-layer gains (recorded bed) using the active preset's
   * reveal bands. Smooth ramps (~a bar) so layers swell/recede, never hard-cut.
   * When the recorded bed isn't loaded this is a harmless no-op (no layer gains).
   */
  private applyProgression(time?: number): void {
    const bands = this.preset.curve.bands;
    const ramp = (g: Tone.Gain | undefined, band: [number, number]) => {
      if (!g) return;
      const target = layerGain(this.progression, band);
      try {
        if (time != null) g.gain.rampTo(target, 1.2, time);
        else g.gain.rampTo(target, 1.2);
      } catch {
        // ignore
      }
    };
    ramp(this.layerGains.melody, bands.melody);
    ramp(this.layerGains.guitar, bands.guitar);
    ramp(this.layerGains.vocal, bands.vocal);
  }

  /** Map intensity -> filter brightness + (procedural) pad presence. */
  private applyIntensity(time?: number): void {
    const i = this.intensity;
    try {
      // Reactive presets open the filter with heat; A stays flatter.
      const reactive = this.preset.intensityReactive;
      const baseHz = reactive ? 900 : 1600;
      const span = reactive ? 4300 : 1200;
      if (time != null) this.filter?.frequency.rampTo(baseHz + i * span, 0.4, time);
      else this.filter?.frequency.rampTo(baseHz + i * span, 0.4);
      // Procedural pad only matters while the synth bed is the bed.
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
    const nodes: (Tone.ToneAudioNode | undefined)[] = [
      ...Object.values(this.layerPlayers),
      ...Object.values(this.layerGains),
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
    this.layerPlayers = {};
    this.layerGains = {};
    this.sfxPlayers = {};
    this.recordedBedActive = false;
    this.progression = 0;
    this.started = false;
  }
}

/** @deprecated old spike name — kept as an alias during the rename. */
export { InteractiveAudioEngine as ProceduralAudioEngine };
