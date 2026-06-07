"use client";

// GameApp — the screen state machine and host wiring (Req 9.1, 9.3, 11, 13.2,
// 15.1).
//
// Owns a single GameEngine, the PixiJS Application (once ready), and a
// GameRenderer. Routes between the Start, In-Game, and Game-Over screens, wires
// keyboard input, the normal-play game loop, and the backing track, and renders
// exactly one <main> landmark (Req 13.2) plus the music credit footer
// (Req 15.1).
//
// Test_Mode awareness: in Test_Mode the auto game loop and audio are disabled
// and spawning is left to the harness (which drives state via the Test_Api);
// the start button still transitions to "playing" so the canvas mounts.

import { useCallback, useEffect, useRef, useState } from "react";
import type { Application } from "pixi.js";

import { GameRenderer } from "~/app/_game/GameRenderer";
import { GameOverScreen } from "~/app/_game/GameOverScreen";
import { InGameView } from "~/app/_game/InGameView";
import { StartScreen } from "~/app/_game/StartScreen";
import { TEST_MODE } from "~/app/_game/testMode";
import { installTestApi, type Screen } from "~/app/_game/testApi";
import { useBackingTrack } from "~/app/_game/useBackingTrack";
import { useGameLoop } from "~/app/_game/useGameLoop";
import { useKeyboardControls } from "~/app/_game/useKeyboardControls";
import { createEngine, type GameEngine } from "~/game/engine";

/** The required NoCopyrightSounds attribution (Req 15.1). */
const MUSIC_CREDIT =
  "Sano - SET ME FREE [NCS Release]. Music provided by NoCopyrightSounds. https://youtu.be/e1QIqXmZ2os";

/**
 * Top-level game host. Renders the active screen inside a single <main> and
 * keeps the HUD score in sync with the live engine via a force-render tick.
 */
export function GameApp(): React.JSX.Element {
  const [screen, setScreen] = useState<Screen>("start");

  // Single engine for the whole session lifetime.
  const engineRef = useRef<GameEngine | null>(null);
  engineRef.current ??= createEngine();
  const engine = engineRef.current;

  // The PixiJS Application (set when the canvas is ready) and the renderer that
  // draws engine state onto it.
  const [app, setApp] = useState<Application | null>(null);
  const rendererRef = useRef<GameRenderer | null>(null);

  // Force a re-render so the React HUD (score) reflects the latest engine state.
  const [, setTick] = useState(0);
  const forceTick = useCallback(() => setTick((t) => t + 1), []);

  // Mirror the current screen for the Test_Api's getScreen (avoids stale reads).
  const screenRef = useRef<Screen>(screen);
  screenRef.current = screen;

  // Audio: disabled entirely in Test_Mode (Req 16.3).
  const { start: startAudio, stop: stopAudio, audioRef } = useBackingTrack({
    enabled: !TEST_MODE,
  });

  // Input is live only while playing. Arrow/vim keys drive the engine (Req 4).
  useKeyboardControls({
    enabled: screen === "playing",
    engine,
    onChange: forceTick,
  });

  // Normal-play loop: gravity + sweep cadence. Disabled in Test_Mode so the
  // harness advances state deterministically (Req 16.3).
  useGameLoop({
    enabled: !TEST_MODE && screen === "playing",
    app,
    engine,
    onGameOver: () => setScreen("gameover"),
    onChange: forceTick,
  });

  // Create the renderer once the PixiJS Application is ready; tear it down when
  // the canvas unmounts. The renderer only draws — it never advances the engine.
  const handleReady = useCallback(
    (readyApp: Application): (() => void) => {
      const renderer = new GameRenderer(readyApp, () => engine.getState());
      renderer.start();
      rendererRef.current = renderer;
      setApp(readyApp);
      return () => {
        renderer.destroy();
        rendererRef.current = null;
        setApp(null);
      };
    },
    [engine],
  );

  // Install the deterministic Test_Api in Test_Mode only (Req 16.2). The
  // installer is a no-op placeholder until Task 14.
  useEffect(() => {
    if (!TEST_MODE) {
      return;
    }
    installTestApi({
      engine,
      getScreen: () => screenRef.current,
      setScreen,
      notifyChange: forceTick,
    });
  }, [engine, forceTick]);

  /** Begin a fresh session (Req 11.2). The harness spawns in Test_Mode. */
  const onStart = useCallback((): void => {
    engine.startNewGame();
    if (!TEST_MODE) {
      engine.spawnRandom();
      startAudio();
    }
    setScreen("playing");
    forceTick();
  }, [engine, startAudio, forceTick]);

  /** Restart from game-over into a fresh session with score reset (Req 9.3). */
  const onRestart = useCallback((): void => {
    engine.startNewGame();
    if (!TEST_MODE) {
      engine.spawnRandom();
      stopAudio();
      startAudio();
    }
    setScreen("playing");
    forceTick();
  }, [engine, startAudio, stopAudio, forceTick]);

  const score = engine.getState().score;

  return (
    <div className="flex min-h-screen flex-col bg-gradient-to-b from-[#1a0b3d] to-[#0b0b14] text-white">
      <main className="flex flex-1 flex-col items-center justify-center px-4 py-12">
        {screen === "start" && <StartScreen onStart={onStart} />}
        {screen === "playing" && (
          <InGameView onReady={handleReady} score={score} audioRef={audioRef} />
        )}
        {screen === "gameover" && (
          <GameOverScreen score={score} onRestart={onRestart} />
        )}
      </main>

      <footer className="px-4 py-3 text-center text-xs text-white/40">
        <a
          href="https://youtu.be/e1QIqXmZ2os"
          target="_blank"
          rel="noreferrer"
          className="hover:text-white/70"
        >
          {MUSIC_CREDIT}
        </a>
      </footer>
    </div>
  );
}

export default GameApp;
