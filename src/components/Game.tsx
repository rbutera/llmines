"use client";

import { useCallback, useState } from "react";
import { GameCanvas } from "./GameCanvas";
import { Cheatsheet } from "./Cheatsheet";

type Screen = "start" | "playing" | "over";

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
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-gradient-to-b from-[#10122b] to-[#05060f] p-6 text-white">
      <h1 className="bg-gradient-to-r from-cyan-300 to-fuchsia-300 bg-clip-text text-4xl font-black tracking-tight text-transparent">
        LLMines
      </h1>

      {screen === "start" && (
        <section className="flex w-full max-w-md flex-col items-center gap-6">
          <p className="text-center text-white/70">
            Stack 2×2 colour blocks, form same-colour squares, and let the
            timeline bar sweep them away in time with the beat.
          </p>
          <Cheatsheet />
          <button
            data-testid="start-button"
            onClick={startGame}
            className="rounded-full bg-cyan-400 px-8 py-3 font-bold text-slate-900 shadow-lg transition hover:scale-105 hover:bg-cyan-300"
          >
            Start
          </button>
        </section>
      )}

      {screen === "playing" && (
        <section className="flex items-start gap-6">
          <GameCanvas
            key={runId}
            onScore={handleScore}
            onGameOver={handleGameOver}
          />
          <aside className="flex w-56 flex-col gap-4">
            <div className="rounded-lg border border-white/10 bg-white/5 p-4">
              <div className="text-xs uppercase tracking-widest text-white/50">
                Score
              </div>
              <div
                data-testid="score"
                className="font-mono text-3xl font-bold text-cyan-200"
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
          className="flex w-full max-w-md flex-col items-center gap-6"
        >
          <h2 className="text-3xl font-bold text-fuchsia-300">Game Over</h2>
          <div className="text-center">
            <div className="text-xs uppercase tracking-widest text-white/50">
              Final Score
            </div>
            <div className="font-mono text-5xl font-bold text-cyan-200">
              {finalScore}
            </div>
          </div>
          <button
            data-testid="restart"
            onClick={startGame}
            className="rounded-full bg-fuchsia-400 px-8 py-3 font-bold text-slate-900 shadow-lg transition hover:scale-105 hover:bg-fuchsia-300"
          >
            Play Again
          </button>
        </section>
      )}
    </main>
  );
}
