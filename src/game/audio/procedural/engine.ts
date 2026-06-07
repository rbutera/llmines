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
/**
 * Quarter-notes to HOLD progression after a clear before decay resumes. At
 * 112 BPM a quarter is ~0.536s, so ~6 beats ≈ 3.2s of grace — long enough that
 * a normal, sparse clear cadence keeps building the song instead of the decay
 * bleeding it out between clears (the bug: clears were too rare to outrun decay).
 */
const GRACE_BEATS = 6;
/** Seconds for a layer-gain ramp. Short so the audible gain TRACKS progression
 * promptly (a long ramp + per-beat re-issue made gains crawl far behind). */
const LAYER_RAMP_S = 0.35;

/** Public base path for the recorded audio assets. */
const ASSET_BASE = "/audio";

/**
 * The song is cut into ORDERED SEGMENTS — sequential 8-bar windows from
 * different sections of the real track (intro → verse → build → hook → …). Each
 * segment has a `bed` (instrumental) loop and a `vox` (lead+backing vocals)
 * loop, all the same length (~16.94s) so they loop in phase and segment
 * crossfades land on the bar grid.
 *
 * Two axes of "clearing advances the song":
 *  - HORIZONTAL: cumulative clears step the active SEGMENT forward (1→2→3…), so
 *    NEW musical material plays — the song moves through its structure instead of
 *    looping one window. Segment→segment is crossfaded on a bar boundary.
 *  - VERTICAL: within the active segment, the VOX layer fades in as recent
 *    clearing builds `progression`, and recedes when idle.
 */
const SEGMENT_COUNT = 6;
const segBed = (i: number) => `${ASSET_BASE}/seg${i}-bed.mp3`;
const segVox = (i: number) => `${ASSET_BASE}/seg${i}-vox.mp3`;

/** One loaded segment: its bed + vox players and their gain nodes. */
interface Segment {
  bedPlayer?: Tone.Player;
  voxPlayer?: Tone.Player;
  bedGain?: Tone.Gain; // 1 when this is the active segment, 0 otherwise
  voxGain?: Tone.Gain; // 0..1 vertical reveal (only meaningful for the active seg)
}

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

  // Recorded bed: ordered segments, each with a bed + vox player/gain. All start
  // synced to the transport at time 0 so every segment loop stays in phase; only
  // the ACTIVE segment's gains are non-zero.
  private segments: Segment[] = [];
  /** Index of the currently-playing segment (horizontal song advance). */
  private segmentIndex = 0;
  /** Highest segment index reached (so an idle dip never rewinds the song). */
  private maxSegmentReached = 0;
  /** True once the recorded bed loaded + started (else the synth bed runs). */
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
   * VERTICAL progression: 0 (bed only) .. 1 (vox full). Clears bump it, idle
   * decays it; the active segment's VOX gain tracks it via the preset bands.
   */
  private progression = 0;
  /** Quarter-notes elapsed since the last clear; gates the decay grace window. */
  private beatsSinceClear = GRACE_BEATS + 1;
  /**
   * HORIZONTAL advance accumulator: a weighted count of clearing activity
   * (squares + combos + chains). Crossing a per-preset threshold steps the song
   * to the next SEGMENT, so new material plays. Monotonic — never decays (the
   * song moves forward through its structure as you progress).
   */
  private clearProgress = 0;

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
   * Live audio state for the test probe (so "clearing advances the song" is
   * HEADLESS-VERIFIABLE). Reports both axes:
   *  - `segmentIndex` / `maxSegmentReached` / `clearProgress` — the HORIZONTAL
   *    song advance (which section is playing).
   *  - `progression` + `layerGains.{bed,vox}` — the VERTICAL reveal (how much of
   *    the active segment's vocal is in).
   * The ACTUAL audio-param gain values are read (not computed targets) so a
   * verification can prove the ramps really moved, not just that the math did.
   */
  getAudioState(): {
    progression: number;
    segmentIndex: number;
    maxSegmentReached: number;
    segmentCount: number;
    clearProgress: number;
    recordedBedActive: boolean;
    layerGains: { bed: number; vox: number };
    intensity: number;
  } {
    const read = (g: Tone.Gain | undefined): number => {
      try {
        return g ? g.gain.value : 0;
      } catch {
        return 0;
      }
    };
    const active = this.segments[this.segmentIndex];
    return {
      progression: this.progression,
      segmentIndex: this.segmentIndex,
      maxSegmentReached: this.maxSegmentReached,
      segmentCount: this.segments.length,
      clearProgress: this.clearProgress,
      recordedBedActive: this.recordedBedActive,
      intensity: this.intensity,
      layerGains: {
        bed: read(active?.bedGain),
        vox: read(active?.voxGain),
      },
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
    // Decay is GENTLE and only starts after a short grace window since the last
    // clear, so a normal (sparse) clear cadence still ACCUMULATES the song
    // instead of bleeding out between clears. `decayPerBeat` is per quarter-note.
    const decay = new Tone.Loop((time) => {
      this.intensity = Math.max(0, this.intensity - 0.06);
      // Grace: hold progression steady for ~GRACE_BEATS after the last clear, so
      // the build doesn't evaporate while the player sets up the next clear.
      this.beatsSinceClear += 1;
      if (this.beatsSinceClear > GRACE_BEATS) {
        this.progression = Math.max(0, this.progression - this.preset.curve.decayPerBeat);
      }
      this.applyIntensity(time);
      this.applyProgression(time);
    }, "4n").start(0);
    this.loops.push(decay);
  }

  /**
   * Load the ordered song segments (bed + vox each) + ad-lib SFX. On success the
   * recorded bed takes over from the procedural fallback. Every segment loop is
   * synced to transport time 0 so all stay in phase; only segment 0's bed starts
   * audible. Fully guarded; a partial failure leaves the missing pieces silent or
   * synthesised.
   */
  private async loadRecorded(): Promise<void> {
    const master = this.master;
    if (!master) return;

    for (let i = 0; i < SEGMENT_COUNT; i++) {
      const seg: Segment = {};
      try {
        const bedGain = new Tone.Gain(i === 0 ? 1 : 0).connect(master);
        const bed = await this.loadPlayer(segBed(i));
        if (bed) {
          bed.loop = true;
          bed.connect(bedGain);
          bed.sync().start(0);
          seg.bedPlayer = bed;
          seg.bedGain = bedGain;
          if (i === 0 && !this.recordedBedActive) {
            this.recordedBedActive = true;
            // Fade the procedural fallback bed out now the real bed is in.
            this.fadeProceduralBed(0);
          }
        } else {
          bedGain.dispose();
        }
      } catch {
        // segment bed missing — that index just won't play
      }
      try {
        const voxGain = new Tone.Gain(0).connect(master); // revealed by progression
        const vox = await this.loadPlayer(segVox(i));
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
      this.segments[i] = seg;
    }

    if (this.recordedBedActive) {
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

    // Progression + intensity bumps on clears (advance the song). A clear also
    // resets the decay grace window so the build HOLDS while the player lines up
    // the next clear (clears are sparse; without this, decay outran them and the
    // song never progressed — the reported bug).
    const c = this.preset.curve;
    if (ev.type === "lineClear") {
      // `perClear` is a per-clear floor so EVERY clear makes a clearly audible
      // step, even a single-square clear (which the deriver reports as squares=1).
      this.beatsSinceClear = 0;
      const weight = 1 + ev.squares + ev.combo; // clearing activity for this event
      this.bumpProgression(c.perClear + ev.squares * c.perSquare + ev.combo * c.perCombo);
      this.bumpIntensity(0.25 + ev.squares * 0.05 + ev.combo * 0.08);
      this.advanceSong(weight, time);
    } else if (ev.type === "chain") {
      this.beatsSinceClear = 0;
      const weight = 2 + Math.min(8, ev.size); // chains advance the song faster
      this.bumpProgression(c.perClear + Math.min(8, ev.size) * c.perChain);
      this.bumpIntensity(0.6);
      if (route.riser) this.riser(time);
      this.advanceSong(weight, time);
    }
  }

  /**
   * HORIZONTAL advance: accumulate clearing weight; each time `clearProgress`
   * crosses the preset's `clearsPerSegment` threshold, step to the NEXT segment
   * so new song material plays. Crossfades active↔next segment beds on a bar
   * boundary (`@1m`) so the section change is seamless. Monotonic — the song only
   * moves forward.
   */
  private advanceSong(weight: number, time: number): void {
    this.clearProgress += weight;
    const per = this.preset.curve.clearsPerSegment;
    const targetIndex = Math.min(
      this.segments.length - 1 || SEGMENT_COUNT - 1,
      Math.floor(this.clearProgress / per),
    );
    if (targetIndex > this.segmentIndex) {
      this.gotoSegment(targetIndex, time);
    }
  }

  /** Crossfade the active segment's bed out and the target segment's bed in. */
  private gotoSegment(index: number, time: number): void {
    const from = this.segments[this.segmentIndex];
    const to = this.segments[index];
    const prevIndex = this.segmentIndex;
    this.segmentIndex = index;
    this.maxSegmentReached = Math.max(this.maxSegmentReached, index);
    // Carry the current vertical reveal into the new segment's vox immediately so
    // the build doesn't reset when the section changes.
    try {
      // Crossfade beds on the next bar boundary so the section change lands
      // musically. rampTo with a 3rd "startTime" arg schedules it; we add a small
      // ramp so it's a quick blend, not a hard cut.
      const at = Tone.getTransport().nextSubdivision("1m");
      from?.bedGain?.gain.rampTo(0, 0.4, at);
      // also pull the OLD segment's vox down (its reveal belongs to the section)
      from?.voxGain?.gain.rampTo(0, 0.4, at);
      to?.bedGain?.gain.rampTo(1, 0.4, at);
      // new segment's vox tracks current progression
      void prevIndex;
      this.applyProgression(at);
    } catch {
      // best-effort — fall back to immediate
      try {
        from?.bedGain?.gain.rampTo(0, 0.4);
        from?.voxGain?.gain.rampTo(0, 0.4);
        to?.bedGain?.gain.rampTo(1, 0.4);
        this.applyProgression();
      } catch {
        // ignore
      }
    }
    void time;
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
   * VERTICAL reveal: map `progression` -> the ACTIVE segment's VOX gain using the
   * preset's reveal band. Smooth ramp so the vocal swells/recedes, never hard-cut.
   * Non-active segments' vox stay at 0. Harmless no-op before the bed loads.
   */
  private applyProgression(time?: number): void {
    const band = this.preset.curve.vocalBand;
    const target = layerGain(this.progression, band);
    const active = this.segments[this.segmentIndex];
    const g = active?.voxGain;
    if (!g) return;
    try {
      if (time != null) g.gain.rampTo(target, LAYER_RAMP_S, time);
      else g.gain.rampTo(target, LAYER_RAMP_S);
    } catch {
      // ignore
    }
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
    this.progression = 0;
    this.segmentIndex = 0;
    this.maxSegmentReached = 0;
    this.clearProgress = 0;
    this.started = false;
  }
}

/** @deprecated old spike name — kept as an alias during the rename. */
export { InteractiveAudioEngine as ProceduralAudioEngine };
