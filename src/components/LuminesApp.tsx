"use client";

import { useEffect, useRef, useState } from "react";

import {
  BACKING_TRACK_SRC,
  GRAVITY_INTERVAL_MS,
  SOFT_DROP_INTERVAL_MS,
} from "~/game/constants";
import { GameEngine } from "~/game/engine";
import { createTestApi } from "~/game/testApi";
import type { Phase } from "~/game/types";
import { ControlsCheatsheet } from "./ControlsCheatsheet";
import { GameBoard } from "./GameBoard";

const TEST_MODE = process.env.NEXT_PUBLIC_TEST_MODE === "1";

export function LuminesApp() {
  const engineRef = useRef<GameEngine | null>(null);
  engineRef.current ??= new GameEngine();
  const engine = engineRef.current;

  const [phase, setPhase] = useState<Phase>(engine.phase);
  const [score, setScore] = useState(0);
  const audioRef = useRef<HTMLAudioElement>(null);
  const softDropRef = useRef(false);

  // Mirror engine state into React (setState de-dupes identical values).
  useEffect(() => {
    const offPhase = engine.on("phase", (p) => setPhase(p as Phase));
    const offChange = engine.on("change", () => setScore(engine.score));
    setPhase(engine.phase);
    setScore(engine.score);
    return () => {
      offPhase();
      offChange();
    };
  }, [engine]);

  // Expose the deterministic test interface only in test mode.
  useEffect(() => {
    if (!TEST_MODE) return;
    window.__lumines = createTestApi(engine);
    return () => {
      delete window.__lumines;
    };
  }, [engine]);

  // Keyboard controls (vim-style + arrow aliases).
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      switch (e.key) {
        case "h":
        case "ArrowLeft":
          engine.moveLeft();
          break;
        case "l":
        case "ArrowRight":
          engine.moveRight();
          break;
        case "k":
        case "ArrowUp":
          engine.rotate();
          break;
        case "j":
        case "ArrowDown":
          e.preventDefault();
          if (!softDropRef.current) engine.softDrop();
          softDropRef.current = true;
          break;
        case " ":
        case "Spacebar":
          e.preventDefault();
          if (engine.hardDrop() && !TEST_MODE) engine.spawnNextIfIdle();
          break;
        default:
          return;
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === "j" || e.key === "ArrowDown") softDropRef.current = false;
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [engine]);

  // Production loop: real-time gravity + tempo-locked sweep. Disabled in test
  // mode (the harness drives gravity/sweep deterministically instead).
  useEffect(() => {
    if (TEST_MODE || phase !== "playing") return;
    let raf = 0;
    let last = performance.now();
    let gravAccum = 0;
    const loop = (now: number) => {
      const dt = Math.min(now - last, 100); // clamp tab-switch jumps
      last = now;
      engine.sweepProgress(dt);
      gravAccum += dt;
      const interval = softDropRef.current
        ? SOFT_DROP_INTERVAL_MS
        : GRAVITY_INTERVAL_MS;
      while (gravAccum >= interval) {
        gravAccum -= interval;
        engine.tickWithAutoSpawn();
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [engine, phase]);

  // Pause the track when the run ends.
  useEffect(() => {
    if (phase === "gameover") audioRef.current?.pause();
  }, [phase]);

  const handleStart = () => {
    engine.start(!TEST_MODE);
    if (!TEST_MODE) void audioRef.current?.play().catch(() => undefined);
  };

  const handleRestart = () => {
    engine.restart(!TEST_MODE);
    if (!TEST_MODE) {
      const a = audioRef.current;
      if (a) {
        a.currentTime = 0;
        void a.play().catch(() => undefined);
      }
    }
  };

  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-[#070912] text-slate-100">
      <BackdropGlow />

      {/* Looping backing track. Loop + src are required even in test mode. */}
      <audio ref={audioRef} src={BACKING_TRACK_SRC} loop preload="auto" />

      {phase === "start" && <StartScreen onStart={handleStart} />}

      {(phase === "playing" || phase === "gameover") && (
        <PlayView engine={engine} score={score} />
      )}

      {phase === "gameover" && (
        <GameOverScreen score={score} onRestart={handleRestart} />
      )}
    </main>
  );
}

function BackdropGlow() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0">
      <div className="absolute -top-40 left-1/2 h-96 w-96 -translate-x-1/2 rounded-full bg-cyan-500/20 blur-[120px]" />
      <div className="absolute bottom-0 left-10 h-72 w-72 rounded-full bg-amber-500/10 blur-[120px]" />
      <div className="absolute top-20 right-10 h-72 w-72 rounded-full bg-fuchsia-500/10 blur-[120px]" />
    </div>
  );
}

function StartScreen({ onStart }: { onStart: () => void }) {
  return (
    <div className="relative z-10 flex w-full max-w-3xl flex-col items-center gap-8 px-6 py-12">
      <div className="text-center">
        <p className="mb-2 text-sm font-semibold tracking-[0.4em] text-cyan-300/70 uppercase">
          A music puzzle
        </p>
        <h1 className="bg-gradient-to-r from-amber-300 via-cyan-200 to-fuchsia-300 bg-clip-text text-7xl font-black tracking-tight text-transparent drop-shadow">
          LLMines
        </h1>
        <p className="mt-4 max-w-md text-balance text-slate-300">
          Stack 2×2 blocks, form same-colour squares, and let the timeline bar
          sweep them away in time with the beat.
        </p>
      </div>

      <button
        data-testid="start-button"
        onClick={onStart}
        autoFocus
        className="group relative rounded-full bg-gradient-to-r from-cyan-400 to-fuchsia-400 px-12 py-4 text-lg font-bold text-[#070912] shadow-[0_0_40px_-5px_rgba(125,249,255,0.7)] transition hover:scale-105 focus:outline-none focus-visible:ring-4 focus-visible:ring-cyan-300/60"
      >
        ▶ Start game
      </button>

      <div className="w-full max-w-sm">
        <ControlsCheatsheet />
      </div>
    </div>
  );
}

function PlayView({ engine, score }: { engine: GameEngine; score: number }) {
  return (
    <div className="relative z-10 flex flex-col items-center gap-6 px-4 py-6 lg:flex-row lg:items-start lg:gap-10">
      <GameBoard engine={engine} />
      <aside className="flex w-full max-w-xs flex-col gap-5">
        <ScorePanel score={score} />
        <ControlsCheatsheet compact />
      </aside>
    </div>
  );
}

function ScorePanel({ score }: { score: number }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-gradient-to-br from-white/10 to-white/5 p-5 backdrop-blur">
      <p className="text-xs font-bold tracking-[0.25em] text-cyan-300/80 uppercase">
        Score
      </p>
      <p
        data-testid="score"
        className="mt-1 font-mono text-5xl font-black text-white tabular-nums"
      >
        {score}
      </p>
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
    <div
      data-testid="game-over"
      className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-6 bg-[#070912]/85 backdrop-blur-sm"
    >
      <p className="text-sm font-semibold tracking-[0.4em] text-fuchsia-300/80 uppercase">
        Stack overflow
      </p>
      <h2 className="text-6xl font-black text-white">Game Over</h2>
      <div className="text-center">
        <p className="text-xs tracking-[0.3em] text-slate-400 uppercase">
          Final score
        </p>
        <p className="font-mono text-6xl font-black text-cyan-200 tabular-nums">
          {score}
        </p>
      </div>
      <button
        data-testid="restart"
        onClick={onRestart}
        autoFocus
        className="rounded-full bg-gradient-to-r from-cyan-400 to-fuchsia-400 px-10 py-3 text-lg font-bold text-[#070912] shadow-[0_0_40px_-5px_rgba(125,249,255,0.7)] transition hover:scale-105 focus:outline-none focus-visible:ring-4 focus-visible:ring-cyan-300/60"
      >
        ↻ Play again
      </button>
    </div>
  );
}
