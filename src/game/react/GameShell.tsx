"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AccountBar, Leaderboard, PersonalBest } from "../account/AccountUI";
import { useAuth, useScores } from "../account/context";
import {
  BACKING_TRACK_URL,
  BOARD_ASPECT,
  type GeneratedPiece,
  PREVIEW_DEPTH,
  skinAt,
} from "../core";
import { InteractiveAudioEngine } from "../audio/procedural/engine";
import { AudioEventDeriver } from "../audio/procedural/events";
import {
  type AudioMix,
  asAudioMix,
  DEFAULT_MIX,
  PRESETS,
} from "../audio/procedural/presets";
import { GameController, type RenderState } from "../engine/controller";
import { keyToAction } from "../engine/keymap";
import { TEST_MODE } from "../test-api/flag";
import { installTestApi } from "../test-api/install";
import { loadSettings, saveSettings } from "../render3d/settings";
import { ControlsCheatsheet } from "./ControlsCheatsheet";
import { GameCanvas } from "./GameCanvas";
import { ScoreFx } from "./ScoreFx";

type Phase = "start" | "playing" | "gameover";

/** localStorage key for the selected audio mix preset (A/B/C). */
const AUDIO_MIX_KEY = "llmines.audioMix";

/**
 * Top-level client component: owns the single GameController, the phase
 * machine (start / playing / gameover), the HUD, audio, keyboard, and (only in
 * test mode) the window.__lumines interface. Renders the single <main> landmark.
 */
export function GameShell() {
  const [phase, setPhase] = useState<Phase>("start");
  const [paused, setPaused] = useState(false);
  const [score, setScore] = useState(0);
  const [hud, setHud] = useState<{
    queue: GeneratedPiece[];
    skinIndex: number;
    bpm: number;
  }>({ queue: [], skinIndex: 0, bpm: 0 });
  const [controller, setController] = useState<GameController | null>(null);
  // Music volume (0..1), default 0.5, persisted with the visual settings so the
  // renderer's Audio panel and this slider share one source of truth.
  const [musicVolume, setMusicVolume] = useState(0.5);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  // Interactive audio: mute toggle + the selectable mix preset (A/B/C).
  const [muted, setMuted] = useState(false);
  const [audioMix, setAudioMix] = useState<AudioMix>(DEFAULT_MIX);
  // The Tone.js engine + the RenderState->event deriver. Refs so the mount-once
  // subscription always sees them; built lazily (browser only, not in TEST_MODE).
  const audioEngineRef = useRef<InteractiveAudioEngine | null>(null);
  const audioDeriverRef = useRef<AudioEventDeriver | null>(null);
  const phaseRef = useRef<Phase>("start");
  phaseRef.current = phase;

  // Account seam: submit the final score on game over (signed-in only). Held in
  // refs so the mount-once subscription always sees the current values.
  const { user } = useAuth();
  const { submitScore } = useScores();
  const submitRef = useRef(submitScore);
  submitRef.current = submitScore;
  const userRef = useRef(user);
  userRef.current = user;
  const gameOverSubmittedRef = useRef(false);

  // Create the controller on the client; wire subscription + test interface.
  useEffect(() => {
    const c = new GameController({ testMode: TEST_MODE, seed: 1 });
    setController(c);
    // Build the interactive-audio engine + the RenderState->event deriver.
    // Silent until unlock() runs on the Start gesture; skipped entirely in
    // TEST_MODE so the deterministic suite stays observationally identical.
    if (!TEST_MODE && typeof window !== "undefined") {
      const engine = new InteractiveAudioEngine();
      audioEngineRef.current = engine;
      audioDeriverRef.current = new AudioEventDeriver();
      // Opt-in dev hook (URL `?audiodev=1` only): expose a handle to drive audio
      // events directly, so "clearing advances the song" is verifiable live
      // without having to skilfully clear squares headlessly. Absent in normal
      // use (no query param) so production stays clean.
      if (window.location.search.includes("audiodev=1")) {
        (window as unknown as { __luminesAudioDev?: InteractiveAudioEngine }).__luminesAudioDev =
          engine;
      }
    }
    const unsubscribe = c.subscribe((rs: RenderState) => {
      // Production-start acceptance probe (read-only). Surfaces the few fields the
      // non-TEST_MODE e2e guard asserts on — sweep position, whether a piece is in
      // play, and game-over — so a "tests green but Start is broken" regression
      // (frozen sweep / no spawn) fails CI. It mirrors the latest RenderState and
      // mutates nothing. Distinct from window.__lumines (the deterministic
      // TEST_MODE control seam), which is intentionally absent in production.
      // Derive musical events from the RenderState diff and fire them (in-key,
      // quantised to the next 1/16). Pure subscriber — never touches game logic.
      // No-op before the Start gesture unlocks the engine.
      const engine = audioEngineRef.current;
      const deriver = audioDeriverRef.current;
      if (engine && deriver) {
        for (const ev of deriver.derive(rs)) engine.fire(ev);
      }
      if (typeof window !== "undefined") {
        // Read-only acceptance probe. Surfaces the e2e-guarded fields PLUS the
        // live audio state, so "clearing advances the song" (segment index +
        // vox gain) is HEADLESS-VERIFIABLE — a verification can drive real
        // clears and assert the segment steps forward + the vox gain rises.
        (
          window as unknown as {
            __luminesProbe?: {
              sweepX: number;
              hasActive: boolean;
              gameOver: boolean;
              audio?: ReturnType<InteractiveAudioEngine["getAudioState"]>;
            };
          }
        ).__luminesProbe = {
          sweepX: rs.sweepX,
          hasActive: rs.active != null,
          gameOver: rs.gameOver,
          audio: engine?.getAudioState(),
        };
      }
      setScore(rs.score);
      // V2 HUD: preview queue, skin, BPM (drives NextPreview + skin panel).
      setHud({ queue: rs.queue, skinIndex: rs.skinIndex, bpm: rs.bpm });
      if (rs.gameOver) {
        // Brownfield: run the score-submit path exactly once per game over.
        // `rs.score` is now V2's score (squares*40 + combo curve), so the
        // leaderboard submit reads the V2 scoring shape. Unauthenticated runs
        // submit nothing (the signed-out rule); the mutation/mock also enforce
        // it server-side.
        if (!gameOverSubmittedRef.current) {
          gameOverSubmittedRef.current = true;
          if (userRef.current) void submitRef.current(rs.score);
        }
        if (phaseRef.current === "playing") setPhase("gameover");
      }
    });
    const uninstall = TEST_MODE ? installTestApi(c) : undefined;
    return () => {
      unsubscribe();
      uninstall?.();
      c.stop();
      audioEngineRef.current?.dispose();
      audioEngineRef.current = null;
      audioDeriverRef.current = null;
    };
  }, []);

  // Keyboard controls — active only while playing.
  useEffect(() => {
    if (phase !== "playing" || !controller) return;
    const onKey = (e: KeyboardEvent) => {
      // Escape toggles pause (sweep + gravity halt, resumable). Handled before
      // the action map so it works regardless of the active control scheme.
      if (e.key === "Escape") {
        e.preventDefault();
        controller.togglePause();
        setPaused(controller.isPaused());
        return;
      }
      const action = keyToAction(e);
      if (!action) return;
      e.preventDefault();
      // A FRESH keydown (not an OS key-repeat) is a deliberate press: it ends
      // the spawn-hold and engages the drop. A carried-over key-repeat routes
      // to input(), which is a no-op while the new block is held — so a key
      // still down from the previous piece cannot cascade into this one.
      if (action === "softDrop" || action === "hardDrop") {
        if (e.repeat) {
          controller.input(action);
        } else if (action === "softDrop") {
          // Fresh soft-drop press: immediate step + ENGAGE sustained mode so
          // HOLDING the key keeps the piece gliding down at soft-drop speed.
          controller.pressSoftDrop();
        } else {
          controller.pressHardDrop();
        }
        return;
      }
      controller.input(action);
    };
    // Soft-drop key release disengages sustained mode (back to gravity speed).
    const onKeyUp = (e: KeyboardEvent) => {
      if (keyToAction(e) === "softDrop") controller.releaseSoftDrop();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [phase, controller]);

  // Load the persisted music volume + audio mix once on mount. Volume shares
  // storage with the renderer's Audio panel; the mix has its own key.
  useEffect(() => {
    setMusicVolume(loadSettings().musicVolume);
    if (typeof window !== "undefined") {
      setAudioMix(asAudioMix(window.localStorage.getItem(AUDIO_MIX_KEY)));
    }
  }, []);

  // Apply the volume to the interactive engine. The leftover full-song
  // backing-track.mp3 stays muted (volume 0) so ONLY the interactive layer is
  // heard; the slider now drives the engine's master gain.
  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = 0;
    audioEngineRef.current?.setVolume(musicVolume);
  }, [musicVolume]);

  // Apply the mute toggle to the engine.
  useEffect(() => {
    audioEngineRef.current?.setMuted(muted);
  }, [muted]);

  // Apply the selected mix preset to the engine + persist it.
  useEffect(() => {
    audioEngineRef.current?.setPreset(audioMix);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(AUDIO_MIX_KEY, audioMix);
    }
  }, [audioMix]);

  const handleVolumeChange = useCallback((v: number) => {
    const clamped = Math.max(0, Math.min(1, v));
    setMusicVolume(clamped);
    // Persist alongside the rest of the settings (read-modify-write).
    saveSettings({ ...loadSettings(), musicVolume: clamped });
  }, []);

  const handleStart = useCallback(() => {
    if (!controller) return;
    setScore(0);
    setPaused(false);
    gameOverSubmittedRef.current = false;
    // The Start click IS the user gesture — unlock the AudioContext and start
    // the bed here. Fire-and-forget + self-guarded so a blocked/failed audio
    // start can never break the game start path.
    audioDeriverRef.current?.reset();
    void audioEngineRef.current?.unlock().then(() => {
      audioEngineRef.current?.setVolume(musicVolume);
      audioEngineRef.current?.setMuted(muted);
      audioEngineRef.current?.setPreset(audioMix);
    });
    controller.start();
    setPhase("playing");
  }, [controller, musicVolume, muted, audioMix]);

  const handleRestart = useCallback(() => {
    if (!controller) return;
    controller.restart(1);
    setScore(0);
    setPaused(false);
    gameOverSubmittedRef.current = false;
    // Reset the deriver so the fresh game does not fire spurious events off the
    // previous game's last state, and (re)unlock if needed.
    audioDeriverRef.current?.reset();
    void audioEngineRef.current?.unlock();
    setPhase("playing");
  }, [controller]);

  return (
    <main
      className={`relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-[#08060f] text-white ${
        // FIX 1: while playing, drop the reading-page padding so the board can
        // dominate the viewport (~90%). Start / game-over keep the padded column.
        phase === "playing" ? "p-0" : "px-4 py-8"
      }`}
    >
      <BackdropGlow />
      {/* Legacy full-song backing track — kept in the DOM (loop/src inspectable)
          but SILENCED (volume 0); the interactive engine is the live audio now. */}
      <audio ref={audioRef} src={BACKING_TRACK_URL} loop preload="auto" />

      {/* Interactive-audio controls: mute toggle + mix preset (A/B/C).
          Always-visible, top-right of the page, so the bed + action SFX can be
          silenced or the mix switched without hunting for the slider. */}
      <div className="absolute top-4 right-4 z-40 flex items-center gap-2">
        <select
          data-testid="audio-mix"
          aria-label="Audio mix preset"
          value={audioMix}
          onChange={(e) => setAudioMix(asAudioMix(e.target.value))}
          className="rounded-lg border border-white/10 bg-black/40 px-2 py-1.5 text-sm font-semibold text-white/80 backdrop-blur transition hover:bg-black/60 focus:ring-2 focus:ring-[#37e0c9]/40 focus:outline-none"
        >
          {(["A", "B", "C"] as AudioMix[]).map((m) => (
            <option key={m} value={m} className="bg-[#0b0e1a] text-white">
              {PRESETS[m].label}
            </option>
          ))}
        </select>
        <button
          type="button"
          data-testid="audio-mute"
          aria-pressed={muted}
          aria-label={muted ? "Unmute audio" : "Mute audio"}
          onClick={() => setMuted((m) => !m)}
          className="rounded-lg border border-white/10 bg-black/40 px-3 py-1.5 text-sm font-semibold text-white/80 backdrop-blur transition hover:bg-black/60"
        >
          {muted ? "🔇" : "🔊"}
        </button>
      </div>

      {/* Start / game-over keep a narrow reading column. While PLAYING the board
          fills ~90% of the viewport width (the inner PlayingScreen sets w-[90vw]),
          so the wrapper goes full-width and the title chrome is overlaid + hidden
          in-play rather than reserving a header band. */}
      <div
        className={`relative z-10 w-full ${
          phase === "playing" ? "max-w-none" : "max-w-5xl"
        }`}
      >
        {/* Title header: part of the chrome — hidden during active play. */}
        {phase !== "playing" && <Header />}

        {phase === "start" && (
          <StartScreen
            onStart={handleStart}
            musicVolume={musicVolume}
            onVolumeChange={handleVolumeChange}
          />
        )}

        {phase === "playing" && controller && (
          <PlayingScreen
            controller={controller}
            score={score}
            hud={hud}
            paused={paused}
            musicVolume={musicVolume}
            onVolumeChange={handleVolumeChange}
          />
        )}

        {phase === "gameover" && (
          <GameOverScreen score={score} onRestart={handleRestart} />
        )}
      </div>
    </main>
  );
}

function Header() {
  return (
    <div className="mb-6 flex items-center justify-between gap-4">
      <div className="flex items-baseline gap-3">
        <h1 className="bg-gradient-to-r from-[#a855f7] to-[#c45cff] bg-clip-text text-3xl font-black tracking-tight text-transparent drop-shadow-[0_0_18px_rgba(196,92,255,0.35)] sm:text-4xl">
          LLMines
        </h1>
        <span className="hidden text-xs tracking-widest text-[#a855f7]/60 uppercase sm:inline">
          a lumines-like
        </span>
      </div>
      <AccountBar />
    </div>
  );
}

/** Music volume slider — persisted, shared with the renderer's Audio panel. */
function VolumeControl({
  musicVolume,
  onVolumeChange,
  compact = false,
}: {
  musicVolume: number;
  onVolumeChange: (v: number) => void;
  compact?: boolean;
}) {
  return (
    <div
      data-testid="volume-control"
      className="rounded-xl border border-white/10 bg-white/5 p-4 backdrop-blur"
    >
      <label
        htmlFor="music-volume"
        className={`mb-2 block font-semibold tracking-wide text-white/70 uppercase ${
          compact ? "text-[11px]" : "text-xs"
        }`}
      >
        Music volume
      </label>
      <div className="flex items-center gap-3">
        <input
          id="music-volume"
          data-testid="volume-slider"
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={musicVolume}
          onChange={(e) => onVolumeChange(Number(e.target.value))}
          className="w-full accent-[#c45cff]"
          aria-label="Music volume"
        />
        <span className="w-10 text-right font-mono text-xs tabular-nums text-white/60">
          {Math.round(musicVolume * 100)}%
        </span>
      </div>
    </div>
  );
}

function StartScreen({
  onStart,
  musicVolume,
  onVolumeChange,
}: {
  onStart: () => void;
  musicVolume: number;
  onVolumeChange: (v: number) => void;
}) {
  return (
    <section
      aria-label="Start"
      className="grid items-start gap-6 md:grid-cols-[1fr_280px]"
    >
      <div className="rounded-2xl border border-[#a855f7]/20 bg-[#a855f7]/[0.06] p-8 shadow-[0_0_40px_-20px_rgba(168,85,247,0.6)] backdrop-blur">
        <h2 className="text-2xl font-bold">How to play</h2>
        <p className="mt-3 max-w-prose text-white/70">
          2×2 colour blocks fall onto the field. Line up four cells of the{" "}
          <span className="text-[#c45cff]">same colour</span> into a square. A
          timeline bar sweeps left-to-right in time with the music, clearing
          every square it crosses. Clear more squares in a single sweep to
          multiply your score. The game ends if the stack reaches the top.
        </p>
        <button
          data-testid="start-button"
          onClick={onStart}
          autoFocus
          className="mt-6 rounded-xl bg-gradient-to-r from-[#a855f7] to-[#c45cff] px-8 py-3 text-lg font-bold text-white shadow-[0_0_30px_-6px_rgba(196,92,255,0.7)] transition hover:brightness-110 focus:ring-4 focus:ring-[#c45cff]/40 focus:outline-none"
        >
          Start game
        </button>
      </div>
      <div className="flex flex-col gap-6">
        <ControlsCheatsheet />
        <VolumeControl musicVolume={musicVolume} onVolumeChange={onVolumeChange} />
        <PersonalBest />
        <Leaderboard />
      </div>
    </section>
  );
}

function PlayingScreen({
  controller,
  score,
  hud,
  paused,
  musicVolume,
  onVolumeChange,
}: {
  controller: GameController;
  score: number;
  hud: { queue: GeneratedPiece[]; skinIndex: number; bpm: number };
  paused: boolean;
  musicVolume: number;
  onVolumeChange: (v: number) => void;
}) {
  const skin = skinAt(hud.skinIndex);
  // Chrome (the side panels) is OVERLAID on the canvas and HIDDEN during active
  // play, shown when paused. The in-canvas PreviewDock keeps the next piece
  // visible in-play, so hiding the DOM preview loses no information. The score
  // chip and pause hint stay always-visible (tiny, non-blocking).
  const chromeVisible = paused;
  return (
    <section
      aria-label="Game"
      className="relative flex h-screen w-screen items-center justify-center"
    >
      {/* FIX 1: the board DOMINATES the viewport. The box is sized to the largest
          16:10 rectangle that fits in ~94% of BOTH viewport axes
          (min(94vw, 94vh*aspect) wide), so on any window it fills the screen
          instead of floating small in a padded column. Aspect-locked so the well
          + preview never clip and a wide box never produces a degenerate canvas
          size (which would trip the AutoFitCamera guard). */}
      <div
        className="relative flex items-center justify-center"
        style={{
          width: `min(94vw, calc(94vh * (16 / 10)))`,
          aspectRatio: BOARD_ASPECT,
        }}
      >
        <div
          className="relative h-full w-full"
          style={{ aspectRatio: BOARD_ASPECT }}
        >
          <GameCanvas controller={controller} />
          <ScoreFx score={score} />

          {/* Always-visible score chip (small, overlaid top-left). The
              authoritative integer lives here; never driven by the transient FX. */}
          <div className="pointer-events-none absolute top-3 left-3 z-30 rounded-lg border border-white/10 bg-black/40 px-3 py-1.5 backdrop-blur">
            <div className="text-[10px] tracking-widest text-white/50 uppercase">
              Score
            </div>
            <div
              key={score}
              data-testid="score"
              className="score-pop font-mono text-2xl font-black tabular-nums"
            >
              {score}
            </div>
          </div>

          {/* Skin / BPM chip — overlaid top-CENTER so it never sits under the
              renderer's Settings button (which lives top-right of the canvas).
              FIX 5: the old top-right placement covered + blocked that button. */}
          <div className="pointer-events-none absolute top-3 left-1/2 z-30 -translate-x-1/2 rounded-lg border border-white/10 bg-black/40 px-3 py-1.5 text-center backdrop-blur">
            <span
              data-testid="skin-id"
              className="block text-xs font-semibold text-white/80"
            >
              {skin.id}
            </span>
            <span
              data-testid="bpm"
              className="font-mono text-[11px] tabular-nums text-white/50"
            >
              {hud.bpm} BPM
            </span>
          </div>

          {/* Auto-hiding chrome overlay: hidden during play, shown when paused. */}
          <div
            data-testid="game-chrome"
            data-visible={chromeVisible}
            className={`absolute inset-0 z-20 flex items-center justify-center bg-black/55 backdrop-blur-sm transition-opacity duration-200 ${
              chromeVisible
                ? "opacity-100"
                : "pointer-events-none opacity-0"
            }`}
          >
            <div className="flex max-h-full w-[min(320px,80%)] flex-col gap-4 overflow-auto">
              {paused && (
                <div className="rounded-xl border border-[#c45cff]/30 bg-white/5 p-4 text-center backdrop-blur">
                  <div className="text-lg font-black tracking-wide text-[#c45cff]">
                    Paused
                  </div>
                  <div className="mt-1 text-xs text-white/60">
                    Press Esc to resume
                  </div>
                </div>
              )}
              {/* The DOM preview is part of the chrome — only needed when paused,
                  since the in-canvas dock covers in-play. */}
              <NextPreview queue={hud.queue} palette={skin.blockPalette} />
              <VolumeControl
                musicVolume={musicVolume}
                onVolumeChange={onVolumeChange}
                compact
              />
              <ControlsCheatsheet compact />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/**
 * Render-only next-3 preview. Reads the controller's queue (render projection)
 * and draws each upcoming 2x2 piece, flagging any that carries a chain special.
 */
function NextPreview({
  queue,
  palette,
}: {
  queue: GeneratedPiece[];
  palette: readonly [string, string];
}) {
  const upcoming = queue.slice(0, PREVIEW_DEPTH);
  return (
    <div
      data-testid="preview"
      className="rounded-xl border border-white/10 bg-white/5 p-4 backdrop-blur"
    >
      <div className="text-xs tracking-widest text-white/50 uppercase">Next</div>
      <ol className="mt-3 flex gap-3">
        {upcoming.map((gp, i) => (
          <li key={i} className="flex flex-col items-center gap-1">
            <PiecePreview piece={gp} palette={palette} />
            {gp.special && (
              <span
                data-testid="preview-special"
                className="text-[10px] font-bold tracking-wide text-[#ffd166] uppercase"
              >
                chain
              </span>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}

function PiecePreview({
  piece,
  palette,
}: {
  piece: GeneratedPiece;
  palette: readonly [string, string];
}) {
  const flat = [
    piece.cells[0][0],
    piece.cells[0][1],
    piece.cells[1][0],
    piece.cells[1][1],
  ];
  return (
    <div className="grid grid-cols-2 gap-0.5">
      {flat.map((color, idx) => {
        const isChain = piece.special?.cellIndex === idx;
        return (
          <span
            key={idx}
            className="h-5 w-5 rounded-sm"
            style={{
              backgroundColor: palette[color],
              boxShadow: isChain ? "inset 0 0 0 2px #ffd166" : undefined,
            }}
          />
        );
      })}
    </div>
  );
}

function GameOverScreen({
  score,
  onRestart,
}: {
  score: number;
  onRestart: () => void;
}) {
  return (
    <section
      data-testid="game-over"
      aria-label="Game over"
      className="mx-auto grid max-w-3xl items-start gap-6 md:grid-cols-[1fr_280px]"
    >
      <div className="rounded-2xl border border-[#c45cff]/20 bg-[#c45cff]/[0.06] p-10 text-center shadow-[0_0_40px_-20px_rgba(196,92,255,0.6)] backdrop-blur">
        <h2 className="text-3xl font-black tracking-tight text-[#c45cff]">
          Game over
        </h2>
        <div className="mt-6 text-xs tracking-widest text-white/50 uppercase">
          Final score
        </div>
        <div className="font-mono text-6xl font-black tabular-nums">{score}</div>
        <button
          data-testid="restart"
          onClick={onRestart}
          autoFocus
          className="mt-8 rounded-xl bg-gradient-to-r from-[#a855f7] to-[#c45cff] px-8 py-3 text-lg font-bold text-white shadow-[0_0_30px_-6px_rgba(196,92,255,0.7)] transition hover:brightness-110 focus:ring-4 focus:ring-[#c45cff]/40 focus:outline-none"
        >
          Play again
        </button>
      </div>
      <div className="flex flex-col gap-6">
        <PersonalBest />
        <Leaderboard />
      </div>
    </section>
  );
}

function BackdropGlow() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0">
      <div className="absolute -top-32 -left-24 h-96 w-96 rounded-full bg-[#7c3aed]/15 blur-3xl" />
      <div className="absolute -right-24 -bottom-32 h-96 w-96 rounded-full bg-[#c45cff]/12 blur-3xl" />
    </div>
  );
}
