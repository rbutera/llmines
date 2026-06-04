"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { LLMinesPixi } from "~/app/_components/llmines-pixi";
import { GRAVITY_TICK_MS, LuminesEngine } from "~/game/engine";
import { isLuminesTestMode } from "~/game/test-mode";
import type { LuminesSnapshot, MoveCommand, Piece } from "~/game/types";

type Screen = "start" | "playing" | "gameOver";

const EMPTY_SNAPSHOT: LuminesSnapshot = {
  grid: Array.from({ length: 10 }, () => Array<null>(16).fill(null)),
  settled: Array.from({ length: 10 }, () => Array<null>(16).fill(null)),
  active: null,
  marked: [],
  score: 0,
  gameOver: false,
  sweepX: 0,
};

function ControlsCheatsheet({ compact = false }: { compact?: boolean }) {
  return (
    <section
      data-testid="controls-cheatsheet"
      className={compact ? "space-y-3 text-sm text-slate-200" : "space-y-4 text-base text-slate-100"}
      aria-label="Controls cheatsheet"
    >
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {[
          ["h", "Left"],
          ["l", "Right"],
          ["j", "Soft drop"],
          ["k", "Rotate"],
          ["space", "Hard drop"],
        ].map(([key, label]) => (
          <div key={key} className="rounded-md border border-white/15 bg-white/8 px-3 py-2">
            <div className="font-mono text-sm font-semibold text-cyan-200">{key}</div>
            <div className="text-xs uppercase tracking-wide text-slate-300">{label}</div>
          </div>
        ))}
      </div>
      <p className="leading-6 text-slate-300">
        Drop 2x2 pieces, build same-color 2x2 squares, and let the beat-synced
        timeline sweep clear marked cells. Larger same-color blocks count every
        aligned 2x2 square.
      </p>
    </section>
  );
}

export function LLMinesApp() {
  const engine = useMemo(() => {
    const next = new LuminesEngine({ autoSpawn: !isLuminesTestMode });
    next.reset(false);
    return next;
  }, []);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [screen, setScreen] = useState<Screen>("start");
  const [snapshot, setSnapshot] = useState<LuminesSnapshot>(() => engine.snapshot());

  const refresh = useCallback(() => {
    const next = engine.snapshot();
    setSnapshot(next);
    if (next.gameOver) {
      setScreen("gameOver");
    }
  }, [engine]);

  const startGame = useCallback(() => {
    engine.reset(!isLuminesTestMode);
    setScreen("playing");
    setSnapshot(engine.snapshot());

    const audio = audioRef.current;
    if (audio) {
      audio.currentTime = 0;
      void audio.play().catch(() => undefined);
    }
  }, [engine]);

  const restartGame = useCallback(() => {
    startGame();
  }, [startGame]);

  const runCommand = useCallback(
    (command: MoveCommand) => {
      engine.command(command);
      refresh();
    },
    [engine, refresh],
  );

  useEffect(() => {
    if (!isLuminesTestMode) {
      return;
    }

    window.__lumines = {
      seed(n: number) {
        engine.seed(n);
      },
      state() {
        return engine.state();
      },
      marked() {
        return engine.marked();
      },
      spawn(piece: Piece) {
        setScreen("playing");
        engine.spawn(piece);
        refresh();
      },
      tick() {
        engine.tick();
        refresh();
      },
      sweepNow() {
        engine.sweepNow();
        refresh();
      },
      sweepProgress(dtMs: number) {
        engine.sweepProgress(dtMs);
        refresh();
      },
    };

    return () => {
      delete window.__lumines;
    };
  }, [engine, refresh]);

  useEffect(() => {
    if (screen !== "playing") {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      const commandByKey: Record<string, MoveCommand | undefined> = {
        h: "left",
        arrowleft: "left",
        l: "right",
        arrowright: "right",
        j: "softDrop",
        arrowdown: "softDrop",
        k: "rotate",
        arrowup: "rotate",
        " ": "hardDrop",
        spacebar: "hardDrop",
      };
      const command = commandByKey[key];

      if (!command) {
        return;
      }

      event.preventDefault();
      runCommand(command);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [runCommand, screen]);

  useEffect(() => {
    if (screen !== "playing" || isLuminesTestMode) {
      return;
    }

    let animationFrame = 0;
    let lastTime = performance.now();
    let gravityMs = 0;

    const step = (now: number) => {
      const dtMs = Math.min(now - lastTime, 100);
      lastTime = now;
      gravityMs += dtMs;

      engine.sweepProgress(dtMs);
      while (gravityMs >= GRAVITY_TICK_MS && !engine.state().gameOver) {
        engine.tick();
        gravityMs -= GRAVITY_TICK_MS;
      }

      const next = engine.snapshot();
      setSnapshot(next);
      if (next.gameOver) {
        setScreen("gameOver");
        return;
      }

      animationFrame = requestAnimationFrame(step);
    };

    animationFrame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(animationFrame);
  }, [engine, screen]);

  const isGameOver = screen === "gameOver";
  const displaySnapshot = screen === "start" ? EMPTY_SNAPSHOT : snapshot;

  return (
    <main className="min-h-screen bg-[#0b1020] text-white">
      <audio ref={audioRef} src="/backing-track.mp3" loop preload="auto" />
      <div className="mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-6 px-5 py-6 lg:px-8">
        <header className="flex flex-wrap items-end justify-between gap-4 border-b border-white/10 pb-4">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.28em] text-cyan-200">
              120 BPM puzzle sweep
            </p>
            <h1 className="mt-2 text-4xl font-black tracking-normal text-white sm:text-5xl">
              LLMines
            </h1>
          </div>
          <div className="rounded-md border border-white/15 bg-white/8 px-4 py-3 text-right">
            <div className="text-xs uppercase tracking-[0.22em] text-slate-400">Score</div>
            <div data-testid="score" className="text-3xl font-black tabular-nums text-yellow-200">
              {snapshot.score}
            </div>
          </div>
        </header>

        {screen === "start" ? (
          <section className="grid flex-1 items-center gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
            <div className="space-y-5">
              <LLMinesPixi snapshot={displaySnapshot} />
              <button
                data-testid="start-button"
                type="button"
                className="w-full rounded-md bg-cyan-300 px-5 py-4 text-lg font-black text-slate-950 shadow-lg shadow-cyan-950/30 transition hover:bg-cyan-200 focus:outline-none focus:ring-4 focus:ring-cyan-200/40 sm:w-auto"
                onClick={startGame}
              >
                Start game
              </button>
            </div>
            <div className="rounded-lg border border-white/15 bg-slate-900/80 p-5 shadow-xl shadow-slate-950/30">
              <h2 className="mb-4 text-xl font-bold text-white">How to play</h2>
              <ControlsCheatsheet />
            </div>
          </section>
        ) : (
          <section className="grid flex-1 gap-6 lg:grid-cols-[minmax(0,1fr)_330px]">
            <div className="space-y-4">
              <LLMinesPixi snapshot={displaySnapshot} />
              {isGameOver ? (
                <div
                  data-testid="game-over"
                  className="rounded-lg border border-yellow-200/25 bg-yellow-200/10 p-5"
                >
                  <h2 className="text-2xl font-black text-yellow-100">Game over</h2>
                  <p className="mt-2 text-slate-200">
                    Final score:{" "}
                    <span className="font-black tabular-nums text-yellow-100">
                      {snapshot.score}
                    </span>
                  </p>
                  <button
                    data-testid="restart"
                    type="button"
                    className="mt-4 rounded-md bg-yellow-200 px-4 py-3 font-black text-slate-950 transition hover:bg-yellow-100 focus:outline-none focus:ring-4 focus:ring-yellow-100/40"
                    onClick={restartGame}
                  >
                    Restart
                  </button>
                </div>
              ) : null}
            </div>

            <aside className="space-y-4">
              <div className="rounded-lg border border-white/15 bg-slate-900/85 p-5">
                <h2 className="mb-3 text-lg font-bold text-white">Controls</h2>
                <ControlsCheatsheet compact />
              </div>
              <div className="rounded-lg border border-white/15 bg-slate-900/85 p-5">
                <div className="text-xs uppercase tracking-[0.22em] text-slate-400">Sweep</div>
                <div className="mt-2 text-2xl font-black tabular-nums text-cyan-200">
                  {snapshot.sweepX.toFixed(2)}
                </div>
                <p className="mt-3 text-sm leading-6 text-slate-300">
                  The bar crosses all 16 columns every 4.0 seconds. Marked squares
                  clear only as the sweep passes.
                </p>
              </div>
            </aside>
          </section>
        )}
      </div>
    </main>
  );
}
