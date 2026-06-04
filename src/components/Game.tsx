"use client";

import { useCallback, useState } from "react";
import { GameCanvas } from "./GameCanvas";
import { Cheatsheet } from "./Cheatsheet";

type Screen = "start" | "playing" | "over";

// Shared rounded-panel system used across every screen for cohesion.
const PANEL =
  "rounded-2xl border border-white/10 bg-white/[0.04] shadow-[0_0_40px_-20px_rgba(76,194,255,0.5)] backdrop-blur-sm";

export function Game() {
  const [screen, setScreen] = useState<Screen>("start");
  const [score, setScore] = useState(0);
  const [finalScore, setFinalScore] = useState(0);
  // Remount the canvas (fresh engine/driver) on each play.
  const [runId, setRunId] = useState(0);

  const handleScore = useCallback((s: number) => setScore(s), []);
  const handleGameOver = useCallback((s: number) => {
    setFinalScore(s);
    setScreen("over");
  }, []);

  const startGame = () => {
    setScore(0);
    setRunId((n) => n + 1);
    setScreen("playing");
  };

  return (
    <main className="app-bg flex min-h-screen flex-col items-center justify-center gap-8 p-6 text-white">
      <h1 className="bg-gradient-to-r from-cyan-300 via-sky-200 to-fuchsia-300 bg-clip-text text-5xl font-black tracking-tight text-transparent drop-shadow-[0_0_20px_rgba(76,194,255,0.35)]">
        LLMines
      </h1>

      {screen === "start" && (
        <section className="panel-in flex w-full max-w-md flex-col items-center gap-6">
          <p className="text-center text-base leading-relaxed text-white/70">
            Stack 2×2 colour blocks, form same-colour squares, and let the
            timeline bar sweep them away in time with the beat.
          </p>
          <Cheatsheet />
          <button
            data-testid="start-button"
            onClick={startGame}
            className="rounded-full bg-gradient-to-r from-cyan-400 to-cyan-300 px-10 py-3 text-lg font-bold tracking-wide text-slate-950 shadow-[0_0_30px_-6px_rgba(76,194,255,0.8)] transition hover:scale-105 hover:shadow-[0_0_40px_-4px_rgba(76,194,255,0.9)] focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200"
          >
            Start
          </button>
        </section>
      )}

      {screen === "playing" && (
        <section className="panel-in flex items-start gap-6">
          <GameCanvas
            key={runId}
            onScore={handleScore}
            onGameOver={handleGameOver}
          />
          <aside className="flex w-56 flex-col gap-4">
            <div className={`${PANEL} p-4`}>
              <div className="text-xs font-medium uppercase tracking-[0.2em] text-white/50">
                Score
              </div>
              <div
                key={score}
                data-testid="score"
                className="score-bump origin-left font-mono text-4xl font-bold text-cyan-200 drop-shadow-[0_0_12px_rgba(76,194,255,0.4)]"
              >
                {score}
              </div>
            </div>
            <Cheatsheet compact />
          </aside>
        </section>
      )}

      {screen === "over" && (
        <section
          data-testid="game-over"
          className={`panel-in flex w-full max-w-md flex-col items-center gap-7 ${PANEL} p-10`}
        >
          <h2 className="bg-gradient-to-r from-fuchsia-300 to-pink-200 bg-clip-text text-4xl font-black tracking-tight text-transparent drop-shadow-[0_0_18px_rgba(255,122,217,0.4)]">
            Game Over
          </h2>
          <div className="text-center">
            <div className="text-xs font-medium uppercase tracking-[0.2em] text-white/50">
              Final Score
            </div>
            <div className="font-mono text-6xl font-bold text-cyan-200 drop-shadow-[0_0_16px_rgba(76,194,255,0.45)]">
              {finalScore}
            </div>
          </div>
          <button
            data-testid="restart"
            onClick={startGame}
            className="rounded-full bg-gradient-to-r from-fuchsia-400 to-fuchsia-300 px-10 py-3 text-lg font-bold tracking-wide text-slate-950 shadow-[0_0_30px_-6px_rgba(255,122,217,0.8)] transition hover:scale-105 hover:shadow-[0_0_40px_-4px_rgba(255,122,217,0.9)] focus:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-200"
          >
            Play Again
          </button>
        </section>
      )}
    </main>
  );
}
