"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth, useScores } from "../account/context";
import {
  BACKING_TRACK_URL,
  BOARD_ASPECT,
  COLS_PER_BEAT,
  type GeneratedPiece,
  SWEEP_BEATS_PER_TRAVERSAL,
} from "../core";
import { InteractiveAudioEngine } from "../audio/procedural/engine";
import { AudioEventDeriver } from "../audio/procedural/events";
import { GameController, type RenderState } from "../engine/controller";
import { keyToAction } from "../engine/keymap";
import { TEST_MODE } from "../test-api/flag";
import { installTestApi } from "../test-api/install";
import { loadSettings, saveSettings } from "../render3d/settings";
import { DEFAULT_SKIN, SKINS } from "../skins/skins";
import { useSkinSwitch } from "../skins/useSkinSwitch";
import { hudHueForSkin } from "../theme/tokens";
import { GameCanvas } from "./GameCanvas";
import { ScoreFx } from "./ScoreFx";
import { GameOverView, PauseOverlay, ControlsOverlay } from "./hud/overlays";
import { PlayHud, StartView } from "./hud/screens";
import { LeaderboardOverlay, UsernameSelect } from "./hud/account-screens";

type Phase = "start" | "playing" | "gameover";

/**
 * Top-level client component: owns the single GameController, the phase machine
 * (start / playing / gameover), the cockpit HUD, audio, keyboard, and (only in
 * test mode) the window.__lumines interface.
 *
 * v2.8 HUD redesign: the Three.js board fills the entire viewport and every UI
 * element floats on a HUD layer above it (in-world game hardware, not a web
 * app). This is a re-skin of the DOM chrome — the canvas, controller, audio
 * engine, skins, scoring, and keyboard are unchanged. The single `--hue` /
 * `--chroma` custom properties (set from the active skin) drive the whole
 * cockpit palette via OKLCH tokens declared on the `.screen` root in hud.css.
 */
export function GameShell() {
  const [phase, setPhase] = useState<Phase>("start");
  const [paused, setPaused] = useState(false);
  const [controlsOpen, setControlsOpen] = useState(false);
  const [leaderboardOpen, setLeaderboardOpen] = useState(false);
  const [score, setScore] = useState(0);
  const [hud, setHud] = useState<{
    queue: GeneratedPiece[];
    skinIndex: number;
    bpm: number;
    sweepX: number;
  }>({ queue: [], skinIndex: 0, bpm: 0, sweepX: 0 });
  const [controller, setController] = useState<GameController | null>(null);
  // Music volume (0..1), default 0.5, persisted with the visual settings so the
  // renderer's Audio panel and this slider share one source of truth.
  const [musicVolume, setMusicVolume] = useState(0.5);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  // Interactive audio: mute toggle.
  const [muted, setMuted] = useState(false);

  // Purely-presentational juice state, bumped from REAL render events (never a
  // timer): scoreKey replays the score pop, clearKey/multKey fire the chain
  // ×N flash + clear-wash, shaking fires the screen shake. bar/beat label the
  // timeline. mult is the shown multiplier.
  const [scoreKey, setScoreKey] = useState(0);
  const [clearKey, setClearKey] = useState(0);
  const [multKey, setMultKey] = useState(0);
  const [mult, setMult] = useState(0);
  const [shaking, setShaking] = useState(false);
  const [bar, setBar] = useState(1);
  const [beat, setBeat] = useState(1);

  // The Tone.js engine + the RenderState->event deriver. Refs so the mount-once
  // subscription always sees them; built lazily (browser only, not in TEST_MODE).
  const audioEngineRef = useRef<InteractiveAudioEngine | null>(null);
  const audioDeriverRef = useRef<AudioEventDeriver | null>(null);
  const phaseRef = useRef<Phase>("start");
  phaseRef.current = phase;
  // Volume/pause coupling: while PAUSED the audio sits at 0 (so a backgrounded
  // pause is silent), but dragging the volume slider in the pause menu briefly
  // bumps it to the chosen level so the player can hear the result, then fades
  // back to 0 after ~1s of no slider activity. Refs so the timer/handlers read
  // current values without re-subscribing.
  const musicVolumeRef = useRef(musicVolume);
  musicVolumeRef.current = musicVolume;
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const volumePreviewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  /** How long the pause-menu volume preview stays audible after the last drag. */
  const VOLUME_PREVIEW_MS = 1000;
  // Refs tracking the last-seen render event ids so the subscription fires each
  // juice effect exactly once per new event, and a wrap counter for the bar.
  const lastScoreRef = useRef(0);
  const lastChainIdRef = useRef(0);
  const lastHardDropIdRef = useRef(0);
  const lastSweepXRef = useRef(0);
  const barRef = useRef(1);
  const shakeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The single skin system: a skin bundles COLOUR (board + chrome), a SOUNDTRACK,
  // and the track TEMPO that drives the sweep speed. The hook crossfades the
  // colours; the onSwitch callback crossfades the audio engine to the skin's
  // track AND pushes the new track tempo + skin index to the controller in lock
  // step (the controller latches the tempo at the next pass boundary, and reads
  // the skin index for per-skin visual variety). Fire-and-forget + self-guarded
  // so a failed audio switch can never break the colour switch or the game.
  const controllerRef = useRef<GameController | null>(null);
  const skinSwitch = useSkinSwitch((skin) => {
    void audioEngineRef.current?.switchTrack(skin.track);
    const c = controllerRef.current;
    if (c) {
      c.setTempo(skin.tempo);
      c.setSkinIndex(SKINS.findIndex((s) => s.id === skin.id));
    }
  });
  // Keep a live ref to the skin-advance so the engine's onSongComplete (set once
  // at mount) always advances the CURRENT skin, not a stale closure. Song
  // completion is the ONLY progression trigger (no toggle, no hotkey).
  const advanceSkinRef = useRef(skinSwitch.advanceSkin);
  advanceSkinRef.current = skinSwitch.advanceSkin;

  // Account seam: submit the final score on game over (signed-in only). Held in
  // refs so the mount-once subscription always sees the current values.
  const { user, needsUsername, signIn, signOut } = useAuth();
  const { submitScore, personalBest, leaderboard } = useScores();
  const submitRef = useRef(submitScore);
  submitRef.current = submitScore;
  const userRef = useRef(user);
  userRef.current = user;
  const gameOverSubmittedRef = useRef(false);

  // Create the controller on the client; wire subscription + test interface.
  useEffect(() => {
    const c = new GameController({ testMode: TEST_MODE, seed: 1 });
    setController(c);
    controllerRef.current = c;
    // Seed the controller's sweep tempo + skin index from the base skin so the
    // bar runs in time from the very first pass (before the async audio load).
    c.setTempo(skinSwitch.skin.tempo);
    c.setSkinIndex(SKINS.findIndex((s) => s.id === skinSwitch.skin.id));
    // Build the interactive-audio engine + the RenderState->event deriver.
    // Silent until unlock() runs on the Start gesture; skipped entirely in
    // TEST_MODE so the deterministic suite stays observationally identical.
    if (!TEST_MODE && typeof window !== "undefined") {
      const engine = new InteractiveAudioEngine();
      audioEngineRef.current = engine;
      audioDeriverRef.current = new AudioEventDeriver();
      // When a song rides out to its TERMINAL segment, advance the skin (which
      // crossfades to the next song's bed via switchTrack). Advancing the skin
      // keeps the colour world + soundtrack + sweep tempo in lock step. Song
      // completion is the ONLY skin-progression trigger.
      engine.onSongComplete = () => advanceSkinRef.current();
      // Opt-in dev hook (URL `?audiodev=1` only): expose a handle to drive audio
      // events directly. Absent in normal use so production stays clean.
      if (window.location.search.includes("audiodev=1")) {
        (
          window as unknown as { __luminesAudioDev?: InteractiveAudioEngine }
        ).__luminesAudioDev = engine;
      }
    }
    const unsubscribe = c.subscribe((rs: RenderState) => {
      // Derive musical events from the RenderState diff and fire them. Pure
      // subscriber — never touches game logic. No-op before the Start gesture
      // unlocks the engine. (Audio-wiring block — identical to v2.5.)
      const engine = audioEngineRef.current;
      const deriver = audioDeriverRef.current;
      if (engine && deriver) {
        for (const ev of deriver.derive(rs)) engine.fire(ev);
      }
      if (typeof window !== "undefined") {
        // Read-only acceptance probe (production-start e2e + audio probe).
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
      setHud({
        queue: rs.queue,
        skinIndex: rs.skinIndex,
        bpm: rs.bpm,
        sweepX: rs.sweepX,
      });

      // --- Cockpit-HUD juice, derived from REAL render events --------------
      // Score pop: bump the key whenever the score rises so the readout replays
      // the pop on its re-key.
      if (rs.score > lastScoreRef.current) {
        lastScoreRef.current = rs.score;
        setScoreKey((k) => k + 1);
      } else if (rs.score < lastScoreRef.current) {
        // Reset / restart — resync without firing.
        lastScoreRef.current = rs.score;
      }
      // Timeline bar/beat from the real sweep. beat = which eighth-note column
      // group within the 8-beat traversal; bar increments on each wrap.
      const beatInBar =
        (Math.floor(rs.sweepX / COLS_PER_BEAT) % SWEEP_BEATS_PER_TRAVERSAL) + 1;
      if (rs.sweepX < lastSweepXRef.current - 1) {
        barRef.current += 1;
        setBar(barRef.current);
      }
      lastSweepXRef.current = rs.sweepX;
      setBeat(beatInBar);
      // Chain clear: fire the ×N flash + clear-wash + shake once per new id.
      if (rs.lastChainClear && rs.lastChainClear.id > lastChainIdRef.current) {
        lastChainIdRef.current = rs.lastChainClear.id;
        // Multiplier read = the size of the cleared component (cells), a good
        // proxy for "how big was this chain" for the ×N flash.
        setMult(Math.max(2, rs.lastChainClear.cells.length));
        setMultKey((k) => k + 1);
        setClearKey((k) => k + 1);
        fireShake();
      }
      // Hard-drop slam: a short screen-shake once per new drop id.
      if (rs.lastHardDrop && rs.lastHardDrop.id > lastHardDropIdRef.current) {
        lastHardDropIdRef.current = rs.lastHardDrop.id;
        fireShake();
      }

      if (rs.gameOver) {
        if (!gameOverSubmittedRef.current) {
          gameOverSubmittedRef.current = true;
          if (userRef.current) void submitRef.current(rs.score);
        }
        if (phaseRef.current === "playing") {
          // Reset the music progression back to the song's opening so the NEXT game
          // starts fresh (segment 0, floor tiers), not wherever this game ended.
          audioEngineRef.current?.resetForNewGame();
          setPhase("gameover");
        }
      }
    });
    const uninstall = TEST_MODE ? installTestApi(c) : undefined;
    return () => {
      unsubscribe();
      uninstall?.();
      c.stop();
      controllerRef.current = null;
      audioEngineRef.current?.dispose();
      audioEngineRef.current = null;
      audioDeriverRef.current = null;
      if (shakeTimerRef.current) clearTimeout(shakeTimerRef.current);
      if (volumePreviewTimerRef.current)
        clearTimeout(volumePreviewTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fire a brief screen-shake (replayable — clear any in-flight timer first).
  const fireShake = useCallback(() => {
    setShaking(true);
    if (shakeTimerRef.current) clearTimeout(shakeTimerRef.current);
    shakeTimerRef.current = setTimeout(() => setShaking(false), 430);
  }, []);

  // Pause helpers. Pausing halts the controller (sweep + gravity freeze) AND
  // raises the overlay; resuming reverses both. The controller is the source of
  // truth for the frozen sweep (the production-start e2e asserts on it), so we
  // mirror its state into `paused` for the overlay.
  const pauseGame = useCallback(() => {
    if (!controller || phaseRef.current !== "playing") return;
    if (!controller.isPaused()) controller.togglePause();
    setPaused(true);
  }, [controller]);

  const resumeGame = useCallback(() => {
    if (!controller) return;
    if (controller.isPaused()) controller.togglePause();
    setPaused(false);
  }, [controller]);

  // Keyboard controls — active only while playing.
  useEffect(() => {
    if (phase !== "playing" || !controller) return;
    const onKey = (e: KeyboardEvent) => {
      // Escape: when the controls overlay is open it takes priority (close it);
      // otherwise toggle pause (sweep + gravity halt, resumable).
      if (e.key === "Escape") {
        e.preventDefault();
        if (controlsOpen) {
          setControlsOpen(false);
          return;
        }
        if (controller.isPaused()) resumeGame();
        else pauseGame();
        return;
      }
      const action = keyToAction(e);
      if (!action) return;
      e.preventDefault();
      if (action === "softDrop" || action === "hardDrop") {
        if (e.repeat) {
          controller.input(action);
        } else if (action === "softDrop") {
          controller.pressSoftDrop();
        } else {
          controller.pressHardDrop();
        }
        return;
      }
      controller.input(action);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (keyToAction(e) === "softDrop") controller.releaseSoftDrop();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [phase, controller, controlsOpen, pauseGame, resumeGame]);

  // Focus loss raises the pause overlay (and freezes the controller): window
  // blur OR the document becoming hidden (tab switch). Only while actively
  // playing + not already paused.
  useEffect(() => {
    const onBlur = () => {
      if (
        phaseRef.current === "playing" &&
        controller &&
        !controller.isPaused()
      ) {
        pauseGame();
      }
    };
    const onVis = () => {
      if (document.hidden) onBlur();
    };
    window.addEventListener("blur", onBlur);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [controller, pauseGame]);

  // Start screen: Enter / Space engages (mirrors the ENGAGE button).
  useEffect(() => {
    if (phase !== "start") return;
    const onKey = (e: KeyboardEvent) => {
      if (controlsOpen) {
        if (e.key === "Escape") setControlsOpen(false);
        return;
      }
      if (e.key === "Enter" || e.key === " ") {
        const el = e.target as HTMLElement | null;
        // Don't hijack space/enter while a button/field is focused for its own
        // activation — but the ENGAGE button is autofocused, so guard inputs.
        if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA")) return;
        e.preventDefault();
        handleStart();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, controlsOpen]);

  // Load the persisted music volume once on mount.
  useEffect(() => {
    setMusicVolume(loadSettings().musicVolume);
  }, []);

  // Apply the volume to the interactive engine. While PLAYING, the engine follows
  // `musicVolume`. While PAUSED, volume is driven to 0 by the pause effect below
  // (and previewed by the slider handler), so a volume change made while paused is
  // NOT pushed here — the slider handler owns the paused preview.
  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = 0;
    if (!pausedRef.current) audioEngineRef.current?.setVolume(musicVolume);
  }, [musicVolume]);

  // Pause ⇒ silence; resume ⇒ restore the chosen volume. This makes a backgrounded
  // pause silent (the player can pause and walk away with no sound). Any in-flight
  // volume-preview fade is cancelled on either transition.
  useEffect(() => {
    if (volumePreviewTimerRef.current) {
      clearTimeout(volumePreviewTimerRef.current);
      volumePreviewTimerRef.current = null;
    }
    audioEngineRef.current?.setVolume(paused ? 0 : musicVolumeRef.current);
  }, [paused]);

  // Apply the mute toggle to the engine. (Audio-wiring — identical v2.5.)
  useEffect(() => {
    audioEngineRef.current?.setMuted(muted);
  }, [muted]);

  const handleVolumeChange = useCallback((v: number) => {
    const clamped = Math.max(0, Math.min(1, v));
    setMusicVolume(clamped);
    musicVolumeRef.current = clamped;
    saveSettings({ ...loadSettings(), musicVolume: clamped });
    if (pausedRef.current) {
      // PAUSED: preview the chosen level so the player hears the result, then fade
      // back to silence after a beat of no slider activity (each drag re-arms it).
      audioEngineRef.current?.setVolume(clamped);
      if (volumePreviewTimerRef.current) {
        clearTimeout(volumePreviewTimerRef.current);
      }
      volumePreviewTimerRef.current = setTimeout(() => {
        volumePreviewTimerRef.current = null;
        // Only fade back if still paused (resume already restored full volume).
        if (pausedRef.current) audioEngineRef.current?.setVolume(0, 0.6);
      }, VOLUME_PREVIEW_MS);
    } else {
      audioEngineRef.current?.setVolume(clamped);
    }
  }, []);

  const handleStart = useCallback(() => {
    if (!controller) return;
    // The Start click IS the user gesture. Unlock the AudioContext FIRST, before any
    // React state setter or other work, so the context create+resume rides the
    // synchronous gesture stack. Strict-autoplay browsers block a context that is
    // created/resumed off the gesture (the intermittent cold-load silence), so the
    // resume MUST be the first thing the handler does. unlock() is self-guarded.
    audioDeriverRef.current?.reset();
    // Start on the base skin: reset the skin world to SKINS[0] (a prior game may
    // have advanced it), set its track + push its tempo + skin index to the
    // controller (latched at the first pass boundary) BEFORE controller.start().
    skinSwitch.resetToBaseSkin();
    audioEngineRef.current?.setInitialTrack(DEFAULT_SKIN.track);
    controller.setTempo(DEFAULT_SKIN.tempo);
    controller.setSkinIndex(0);
    void audioEngineRef.current?.unlock().then(() => {
      audioEngineRef.current?.setVolume(musicVolume);
      audioEngineRef.current?.setMuted(muted);
    });
    setScore(0);
    setPaused(false);
    setControlsOpen(false);
    gameOverSubmittedRef.current = false;
    lastScoreRef.current = 0;
    lastChainIdRef.current = 0;
    lastHardDropIdRef.current = 0;
    lastSweepXRef.current = 0;
    barRef.current = 1;
    setBar(1);
    setBeat(1);
    controller.start();
    setPhase("playing");
  }, [controller, musicVolume, muted, skinSwitch]);

  const handleRestart = useCallback(() => {
    if (!controller) return;
    // Restart resets to the BASE skin (no carry-over): pass the base tempo + skin
    // index INTO restart() so they are latched before the new run's first emit
    // (atomic restart-to-base, never a fallback-tempo flash).
    controller.restart({
      tempo: DEFAULT_SKIN.tempo,
      skinIndex: 0,
    });
    setScore(0);
    setPaused(false);
    gameOverSubmittedRef.current = false;
    lastScoreRef.current = 0;
    lastChainIdRef.current = 0;
    lastHardDropIdRef.current = 0;
    lastSweepXRef.current = 0;
    barRef.current = 1;
    setBar(1);
    setBeat(1);
    // Reset the colour world to the base skin + the engine back to song1.
    skinSwitch.resetToBaseSkin();
    audioDeriverRef.current?.reset();
    audioEngineRef.current?.setInitialTrack(DEFAULT_SKIN.track);
    void audioEngineRef.current?.unlock();
    setPhase("playing");
  }, [controller, skinSwitch]);

  const handleEndRun = useCallback(() => {
    if (controller?.isPaused()) controller.togglePause();
    setPaused(false);
    // Reset the music progression to the song's opening for the next game.
    audioEngineRef.current?.resetForNewGame();
    setPhase("gameover");
    // Submit once if the run wasn't already submitted (e.g. ended via END RUN
    // rather than a stack-overflow game over).
    if (!gameOverSubmittedRef.current) {
      gameOverSubmittedRef.current = true;
      if (userRef.current) void submitRef.current(score);
    }
  }, [controller, score]);

  // The single-hue cockpit tint, fed by the active skin. Set on the `.screen`
  // root so the OKLCH token block in hud.css recomputes per skin.
  const { hue, chroma } = hudHueForSkin(skinSwitch.skin.id);
  const globalTop =
    leaderboard.length > 0
      ? { name: leaderboard[0]!.name, best: leaderboard[0]!.best }
      : null;

  return (
    <main
      data-testid="game-root"
      data-skin={skinSwitch.skin.id}
      className={`screen ${shaking ? "shake" : ""}`}
      style={
        {
          width: "100vw",
          height: "100vh",
          "--hue": String(hue),
          "--chroma": String(chroma),
        } as React.CSSProperties
      }
    >
      {/* BOARD LAYER — the Three.js scene fills the entire viewport. */}
      <div className="layer" style={{ zIndex: 1 }}>
        <div className="ambient" />
        {controller && (
          <div style={{ position: "absolute", inset: 0 }}>
            {/* The renderer auto-fits a 16:10 well; give it a full-bleed box. */}
            <div
              style={{
                position: "absolute",
                inset: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <div
                style={{
                  width: `min(100vw, calc(100vh * (16 / 10)))`,
                  height: `min(100vh, calc(100vw * (10 / 16)))`,
                  aspectRatio: BOARD_ASPECT,
                }}
              >
                <GameCanvas
                  controller={controller}
                  palette={skinSwitch.board}
                />
                {phase === "playing" && <ScoreFx score={score} />}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Legacy full-song backing track — kept in the DOM (loop/src inspectable)
          but SILENCED (volume 0); the interactive engine is the live audio. */}
      <audio ref={audioRef} src={BACKING_TRACK_URL} loop preload="auto" />

      {/* START SCREEN: dim the board, float the title HUD. */}
      {phase === "start" && (
        <>
          <div className="start-scrim" />
          <div className="layer hud-layer">
            <StartView
              onStart={handleStart}
              onControls={() => setControlsOpen(true)}
              onSign={user ? signOut : signIn}
              onLeaderboard={() => setLeaderboardOpen(true)}
              signedIn={!!user}
              signedInName={user?.username ?? null}
              personalBest={personalBest}
              globalTop={globalTop}
            />
          </div>
        </>
      )}

      {/* IN-PLAY HUD: data on glass over the fullscreen board. */}
      {phase === "playing" && controller && (
        <PlayHud
          score={score}
          bpm={hud.bpm}
          queue={hud.queue}
          sweepX={hud.sweepX}
          scoreKey={scoreKey}
          multKey={multKey}
          mult={mult}
          clearKey={clearKey}
          bar={bar}
          beat={beat}
          onPause={pauseGame}
        />
      )}

      {/* PAUSE OVERLAY. */}
      {phase === "playing" && paused && (
        <PauseOverlay
          onResume={resumeGame}
          onEnd={handleEndRun}
          musicVolume={musicVolume}
          onVolumeChange={handleVolumeChange}
          muted={muted}
          onToggleMute={() => setMuted((m) => !m)}
        />
      )}

      {/* CONTROLS OVERLAY (on-demand from Start). */}
      {controlsOpen && phase === "start" && (
        <ControlsOverlay onClose={() => setControlsOpen(false)} />
      )}

      {/* GAME OVER. */}
      {phase === "gameover" && (
        <GameOverView
          score={score}
          best={personalBest}
          signedIn={!!user}
          onAgain={handleRestart}
          onLeaderboard={() => setLeaderboardOpen(true)}
        />
      )}

      {/* USERNAME SELECT — shown after first sign-in, before play. Highest
          overlay so the player picks a callsign before anything else. */}
      {needsUsername && <UsernameSelect onDone={() => undefined} />}

      {/* LEADERBOARD — reachable from Start + Game Over. */}
      {leaderboardOpen && (
        <LeaderboardOverlay
          onClose={() => setLeaderboardOpen(false)}
          highlightSubject={user?.subject ?? null}
        />
      )}

      {/* Persistent control-scheme legend for the test contract (the e2e suite
          asserts the cheatsheet is visible on start AND in-game). Off-screen,
          non-interactive: the visible cockpit cheatsheet lives in the Controls +
          Pause overlays; this keeps the long-standing accessibility/test
          contract without cluttering the cockpit glass. */}
      <ControlsContract />

      {/* CRT ambiance — scanlines + vignette + phosphor wash, always on. */}
      <div className="layer crt" />
    </main>
  );
}

/**
 * The control-scheme legend, kept mounted in every phase to satisfy the
 * long-standing `controls-cheatsheet` test contract (visible on start and
 * in-game). Visually unobtrusive (a small, dim footer chip) so it does not
 * compete with the cockpit glass — the rich keycap cheatsheet lives in the
 * Controls + Pause overlays.
 */
function ControlsContract() {
  return (
    <div
      data-testid="controls-cheatsheet"
      className="hint"
      style={{
        position: "absolute",
        bottom: 6,
        right: 10,
        zIndex: 7,
        opacity: 0.35,
        pointerEvents: "none",
        fontSize: 9,
      }}
    >
      ← → move · ↑ rotate · ↓ drop · space slam · esc pause
    </div>
  );
}
