"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { GameEngine } from "~/game/engine";
import { PixiRenderer } from "~/game/renderer";
import { initTestApi, removeTestApi } from "~/game/test-api";
import { ControlsCheatsheet } from "./ControlsCheatsheet";
import { GameOverScreen } from "./GameOverScreen";
import { StartScreen } from "./StartScreen";

type Screen = "start" | "playing" | "gameover";

const IS_TEST_MODE = process.env.NEXT_PUBLIC_TEST_MODE === "1";

/**
 * Focus the first interactive element within a selector, with rAF retry.
 * Falls back to the <main> element after 2 frames if target not found.
 */
function focusFirstInteractive(selector: string) {
  let attempts = 0;
  const tryFocus = () => {
    attempts++;
    const el = document.querySelector<HTMLElement>(selector);
    if (el) {
      el.focus();
    } else if (attempts < 2) {
      requestAnimationFrame(tryFocus);
    } else {
      // Fallback: focus main
      const main = document.querySelector<HTMLElement>("main");
      main?.focus();
    }
  };
  requestAnimationFrame(tryFocus);
}

export function Game() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<GameEngine | null>(null);
  const rendererRef = useRef<PixiRenderer | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const animFrameRef = useRef<number | null>(null);

  const [screen, setScreen] = useState<Screen>("start");
  const [score, setScore] = useState(0);

  // Initialize renderer
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const renderer = new PixiRenderer();
    rendererRef.current = renderer;

    void renderer.init(canvas);

    return () => {
      renderer.destroy();
      rendererRef.current = null;
    };
  }, []);

  // Render loop
  useEffect(() => {
    if (screen !== "playing") return;

    const renderLoop = () => {
      const engine = engineRef.current;
      const renderer = rendererRef.current;
      if (engine && renderer) {
        renderer.render(engine.state);
        setScore(engine.state.score);

        if (engine.state.gameOver) {
          setScreen("gameover");
          engine.stop();
          if (audioRef.current) {
            audioRef.current.pause();
            audioRef.current.currentTime = 0;
          }
          return;
        }
      }
      animFrameRef.current = requestAnimationFrame(renderLoop);
    };

    animFrameRef.current = requestAnimationFrame(renderLoop);

    return () => {
      if (animFrameRef.current !== null) {
        cancelAnimationFrame(animFrameRef.current);
      }
    };
  }, [screen]);

  // Focus management on screen transitions
  useEffect(() => {
    if (IS_TEST_MODE) return;

    if (screen === "start") {
      focusFirstInteractive('[data-testid="start-button"]');
    } else if (screen === "gameover") {
      focusFirstInteractive('[data-testid="restart"]');
    }
  }, [screen]);

  // Test mode setup
  useEffect(() => {
    if (!IS_TEST_MODE) return;

    const engine = new GameEngine(true);
    engineRef.current = engine;
    engine.start();
    initTestApi(engine);

    // In test mode, run a render loop too
    const renderLoop = () => {
      const renderer = rendererRef.current;
      if (engine && renderer) {
        renderer.render(engine.state);
        setScore(engine.state.score);
        if (engine.state.gameOver) {
          setScreen("gameover");
        }
      }
      animFrameRef.current = requestAnimationFrame(renderLoop);
    };
    // Start render loop after a small delay to allow renderer init
    setTimeout(() => {
      animFrameRef.current = requestAnimationFrame(renderLoop);
    }, 100);

    setScreen("playing");

    return () => {
      removeTestApi();
      engine.stop();
      if (animFrameRef.current !== null) {
        cancelAnimationFrame(animFrameRef.current);
      }
    };
  }, []);

  const handleStart = useCallback(() => {
    const engine = new GameEngine(false);
    engineRef.current = engine;

    // Audio setup
    const audio = audioRef.current;
    if (audio) {
      engine.setAudio(audio);
      audio.currentTime = 0;
      audio.play().catch(() => {
        // Autoplay blocked — game continues with wall-clock fallback
      });
    }

    engine.on("gameOver", () => {
      setScreen("gameover");
      if (audio) {
        audio.pause();
        audio.currentTime = 0;
      }
    });

    engine.on("pieceLocked", (data: { row: number; col: number }) => {
      rendererRef.current?.triggerLockEffect(data.row, data.col);
    });

    engine.start();
    setScreen("playing");
  }, []);

  const handleRestart = useCallback(() => {
    const engine = engineRef.current;
    if (engine) {
      engine.stop();
    }
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
    setScore(0);
    setScreen("start");
  }, []);

  return (
    <main
      className="relative flex h-screen w-screen items-center justify-center bg-[#0a0a1a]"
      tabIndex={-1}
    >
      {/* Audio element */}
      <audio ref={audioRef} src="/backing-track.mp3" loop preload="auto" />

      {/* Game area */}
      <div className="relative flex items-start gap-4">
        {/* Canvas */}
        <div data-testid="grid" className="relative">
          <canvas ref={canvasRef} className="rounded-lg shadow-2xl" />
        </div>

        {/* Side panel - only show during gameplay */}
        {screen === "playing" && (
          <div className="flex flex-col gap-4">
            {/* Score */}
            <div className="rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-center backdrop-blur-sm">
              <p className="text-xs tracking-wider text-white/50 uppercase">
                Score
              </p>
              <p
                data-testid="score"
                className="text-3xl font-bold text-white"
              >
                {score}
              </p>
            </div>

            {/* Controls legend */}
            <ControlsCheatsheet compact />
          </div>
        )}
      </div>

      {/* Screens */}
      <StartScreen
        onStart={handleStart}
        visible={screen === "start" && !IS_TEST_MODE}
      />
      <GameOverScreen
        score={score}
        onRestart={handleRestart}
        visible={screen === "gameover"}
      />
    </main>
  );
}
