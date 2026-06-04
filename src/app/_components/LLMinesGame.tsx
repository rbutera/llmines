"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { ControlsPanel } from "./ControlsPanel";
import { GameHud } from "./GameHud";
import { PixiBoard } from "./PixiBoard";
import { BACKING_TRACK_SRC, NORMAL_GRAVITY_MS } from "~/lib/llmines/constants";
import {
  applyCommand,
  createInitialState,
  restartRound,
  startRound,
  sweepProgress,
  tick,
} from "~/lib/llmines/engine";
import { commandFromKey } from "~/lib/llmines/input";
import { createLuminesTestApi } from "~/lib/llmines/test-api";
import type { GameState } from "~/lib/llmines/types";

const TEST_MODE = process.env.NEXT_PUBLIC_TEST_MODE === "1";

function runtimeTestMode() {
  return (
    TEST_MODE &&
    (typeof window === "undefined" ||
      !window.location.search.includes("normalMode=1"))
  );
}

export function LLMinesGame() {
  const testMode = runtimeTestMode();
  const [started, setStarted] = useState(false);
  const [gameState, setGameState] = useState<GameState>(() =>
    createInitialState(1),
  );
  const gameStateRef = useRef(gameState);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const updateGame = useCallback((updater: (state: GameState) => GameState) => {
    setGameState((current) => {
      const next = updater(current);
      gameStateRef.current = next;
      return next;
    });
  }, []);

  useEffect(() => {
    gameStateRef.current = gameState;
  }, [gameState]);

  const start = useCallback(() => {
    const next = startRound(1);
    gameStateRef.current = next;
    setGameState(next);
    setStarted(true);
    void audioRef.current?.play().catch(() => undefined);
  }, []);

  const restart = useCallback(() => {
    const next = restartRound(1);
    gameStateRef.current = next;
    setGameState(next);
    setStarted(true);
    if (audioRef.current) {
      audioRef.current.currentTime = 0;
      void audioRef.current.play().catch(() => undefined);
    }
  }, []);

  useEffect(() => {
    if (!testMode) return;
    window.__lumines = createLuminesTestApi(
      () => gameStateRef.current,
      (updater) => updateGame(updater),
    );
    return () => {
      delete window.__lumines;
    };
  }, [testMode, updateGame]);

  useEffect(() => {
    if (!started || gameState.gameOver) return;

    const onKeyDown = (event: KeyboardEvent) => {
      const command = commandFromKey(event.key);
      if (!command) return;
      event.preventDefault();
      updateGame((state) =>
        applyCommand(state, command, { autoSpawn: !testMode }),
      );
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [gameState.gameOver, started, testMode, updateGame]);

  useEffect(() => {
    if (!started || testMode || gameState.gameOver) return;

    let frame = 0;
    let last = performance.now();
    let gravityAccumulator = 0;

    const loop = (now: number) => {
      const dt = Math.min(now - last, 100);
      last = now;
      gravityAccumulator += dt;

      updateGame((state) => {
        let next = sweepProgress(state, dt);
        if (gravityAccumulator >= NORMAL_GRAVITY_MS) {
          gravityAccumulator = 0;
          next = tick(next, { autoSpawn: true });
        }
        return next;
      });

      frame = requestAnimationFrame(loop);
    };

    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [gameState.gameOver, started, testMode, updateGame]);

  if (!started) {
    return (
      <main className="app-shell app-shell--start">
        <audio ref={audioRef} src={BACKING_TRACK_SRC} loop preload="auto" />
        <section className="start-layout" aria-labelledby="game-title">
          <div className="title-stack">
            <p className="kicker">120 BPM puzzle flow</p>
            <h1 id="game-title">LLMines</h1>
            <p className="intro">
              Drop two-color 2x2 blocks, form glowing squares, and let the
              timeline sweep turn clean setups into score bursts.
            </p>
            <button
              type="button"
              data-testid="start-button"
              className="primary-action"
              onClick={start}
            >
              Start
            </button>
          </div>
          <ControlsPanel />
        </section>
      </main>
    );
  }

  if (gameState.gameOver) {
    return (
      <main className="app-shell">
        <audio ref={audioRef} src={BACKING_TRACK_SRC} loop preload="auto" />
        <section className="game-over" data-testid="game-over">
          <p className="kicker">Stack overflow</p>
          <h1>Game Over</h1>
          <p className="final-score">
            Final score <span>{gameState.score}</span>
          </p>
          <button
            type="button"
            data-testid="restart"
            className="primary-action"
            onClick={restart}
          >
            Restart
          </button>
          <ControlsPanel compact />
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <audio ref={audioRef} src={BACKING_TRACK_SRC} loop preload="auto" />
      <section className="game-layout" aria-label="LLMines game">
        <PixiBoard state={gameState} />
        <GameHud score={gameState.score} />
      </section>
    </main>
  );
}
