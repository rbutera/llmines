"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { NORMAL_GRAVITY_MS } from "~/game/constants";
import { GameEngine } from "~/game/engine";
import type { LuminesTestApi, Piece } from "~/game/types";

import { ControlsCheatsheet } from "./controls-cheatsheet";
import { PixiBoard } from "./pixi-board";

declare global {
  interface Window {
    __lumines?: LuminesTestApi;
  }
}

type Screen = "start" | "playing" | "game-over";

const IS_TEST_MODE = process.env.NEXT_PUBLIC_TEST_MODE === "1";

const createEngine = () => new GameEngine({ autoSpawn: !IS_TEST_MODE });

export function GameClient() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const engineRef = useRef<GameEngine>(createEngine());
  const [screen, setScreen] = useState<Screen>("start");
  const [, setVersion] = useState(0);

  const refresh = useCallback(() => {
    setVersion((value) => value + 1);
  }, []);

  const syncGameOver = useCallback(() => {
    if (engineRef.current.state().gameOver) {
      setScreen("game-over");
    }
  }, []);

  const runCommand = useCallback(
    (command: (engine: GameEngine) => void) => {
      command(engineRef.current);
      syncGameOver();
      refresh();
    },
    [refresh, syncGameOver],
  );

  const startGame = useCallback(() => {
    if (engineRef.current.state().gameOver) {
      engineRef.current = createEngine();
    }

    setScreen("playing");
    refresh();
    void audioRef.current?.play().catch(() => undefined);
  }, [refresh]);

  const restart = useCallback(() => {
    engineRef.current = createEngine();
    setScreen("playing");
    refresh();
    void audioRef.current?.play().catch(() => undefined);
  }, [refresh]);

  useEffect(() => {
    if (!IS_TEST_MODE) return;

    window.__lumines = {
      marked: () => engineRef.current.marked(),
      seed: (seed: number) => {
        engineRef.current.seed(seed);
        refresh();
      },
      spawn: (piece: Piece) => {
        runCommand((engine) => engine.spawn(piece));
      },
      state: () => engineRef.current.state(),
      sweepNow: () => {
        runCommand((engine) => engine.sweepNow());
      },
      sweepProgress: (dtMs: number) => {
        runCommand((engine) => engine.sweepProgress(dtMs));
      },
      tick: () => {
        runCommand((engine) => engine.tick());
      },
    };

    return () => {
      delete window.__lumines;
    };
  }, [refresh, runCommand]);

  useEffect(() => {
    if (screen !== "playing") return;

    const onKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      let handled = true;

      switch (key) {
        case "arrowleft":
        case "h":
          runCommand((engine) => {
            engine.move(-1);
          });
          break;
        case "arrowright":
        case "l":
          runCommand((engine) => {
            engine.move(1);
          });
          break;
        case "arrowdown":
        case "j":
          runCommand((engine) => {
            engine.tick();
          });
          break;
        case "arrowup":
        case "k":
          runCommand((engine) => {
            engine.rotate();
          });
          break;
        case " ":
          runCommand((engine) => {
            engine.hardDrop();
          });
          break;
        default:
          handled = false;
      }

      if (handled) {
        event.preventDefault();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [runCommand, screen]);

  useEffect(() => {
    if (screen !== "playing" || IS_TEST_MODE) return;

    let frame = 0;
    let last = performance.now();
    let gravityMs = 0;

    const animate = (now: number) => {
      const dt = Math.min(100, now - last);
      last = now;
      gravityMs += dt;

      engineRef.current.sweepProgress(dt);

      while (gravityMs >= NORMAL_GRAVITY_MS) {
        engineRef.current.tick();
        gravityMs -= NORMAL_GRAVITY_MS;
      }

      syncGameOver();
      refresh();
      frame = window.requestAnimationFrame(animate);
    };

    frame = window.requestAnimationFrame(animate);
    return () => window.cancelAnimationFrame(frame);
  }, [refresh, screen, syncGameOver]);

  const snapshot = engineRef.current.snapshot();
  const score = snapshot.score;

  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden bg-[radial-gradient(circle_at_20%_12%,rgba(33,214,255,0.18),transparent_30%),radial-gradient(circle_at_84%_28%,rgba(255,210,63,0.16),transparent_28%),linear-gradient(135deg,#071015,#101820_52%,#071015)]">
      <audio ref={audioRef} src="/backing-track.mp3" loop preload="auto" />
      <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col px-5 py-6 sm:px-8">
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 pb-5">
          <div>
            <p className="text-xs font-semibold tracking-[0.32em] text-[#9fffd9] uppercase">
              120 BPM timeline puzzle
            </p>
            <h1 className="mt-2 text-4xl font-black tracking-normal text-white sm:text-5xl">
              LLMines
            </h1>
          </div>
          <div className="rounded-lg border border-white/15 bg-black/30 px-5 py-3 text-right">
            <p className="text-xs tracking-[0.2em] text-slate-400 uppercase">
              Score
            </p>
            <p
              className="font-mono text-3xl font-bold text-[#ffe985]"
              data-testid="score"
            >
              {score}
            </p>
          </div>
        </header>

        {screen === "start" ? (
          <StartScreen onStart={startGame} />
        ) : (
          <div className="grid flex-1 items-center gap-6 py-6 lg:grid-cols-[minmax(0,1fr)_340px]">
            <div className="flex justify-center">
              <PixiBoard snapshot={snapshot} />
            </div>
            <aside className="flex flex-col gap-4">
              <ControlsCheatsheet />
              <StatusPanel snapshot={snapshot} />
            </aside>
          </div>
        )}

        {screen === "game-over" ? (
          <GameOver score={score} onRestart={restart} />
        ) : null}

        <footer className="border-t border-white/10 pt-4 text-xs leading-5 text-slate-400">
          Sano - SET ME FREE [NCS Release]. Music provided by NoCopyrightSounds.
          https://youtu.be/e1QIqXmZ2os
        </footer>
      </div>
    </div>
  );
}

function StartScreen({ onStart }: { onStart: () => void }) {
  return (
    <div className="grid flex-1 items-center gap-8 py-8 lg:grid-cols-[minmax(0,1fr)_360px]">
      <section className="max-w-3xl">
        <p className="text-sm font-semibold tracking-[0.28em] text-[#ffe985] uppercase">
          Build squares. Ride the sweep.
        </p>
        <h2 className="mt-4 text-5xl leading-tight font-black tracking-normal text-white sm:text-7xl">
          Drop blocks into the beat.
        </h2>
        <p className="mt-5 max-w-2xl text-lg leading-8 text-slate-300">
          Place falling 2x2 colour blocks to form same-colour squares. The
          timeline crosses the field every four seconds, clearing marked cells
          and multiplying your score.
        </p>
        <button
          className="mt-8 rounded-lg bg-[#21d6ff] px-7 py-4 text-base font-black tracking-[0.16em] text-[#061018] uppercase shadow-[0_0_32px_rgba(33,214,255,0.45)] transition hover:bg-[#7eeeff] focus:ring-4 focus:ring-[#21d6ff]/40 focus:outline-none"
          data-testid="start-button"
          type="button"
          onClick={onStart}
        >
          Start game
        </button>
      </section>
      <ControlsCheatsheet />
    </div>
  );
}

function StatusPanel({
  snapshot,
}: {
  snapshot: ReturnType<GameEngine["snapshot"]>;
}) {
  return (
    <section className="rounded-lg border border-white/15 bg-black/30 p-4">
      <h2 className="text-sm font-semibold tracking-[0.18em] text-[#9fffd9] uppercase">
        Field
      </h2>
      <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
        <div className="rounded-md bg-white/5 p-3">
          <p className="text-slate-400">Marked cells</p>
          <p className="font-mono text-xl text-white">
            {snapshot.marked.length}
          </p>
        </div>
        <div className="rounded-md bg-white/5 p-3">
          <p className="text-slate-400">Squares</p>
          <p className="font-mono text-xl text-white">
            {snapshot.distinctSquares}
          </p>
        </div>
      </div>
    </section>
  );
}

function GameOver({
  onRestart,
  score,
}: {
  onRestart: () => void;
  score: number;
}) {
  return (
    <div
      className="fixed inset-0 z-20 flex items-center justify-center bg-[#02070b]/82 px-5 backdrop-blur-sm"
      data-testid="game-over"
      role="dialog"
      aria-modal="true"
      aria-label="Game over"
    >
      <section className="w-full max-w-md rounded-lg border border-white/15 bg-[#0b1520] p-6 text-center shadow-2xl">
        <p className="text-sm font-semibold tracking-[0.24em] text-[#ffe985] uppercase">
          Game over
        </p>
        <h2 className="mt-3 text-4xl font-black">Final score {score}</h2>
        <button
          className="mt-6 rounded-lg bg-[#ffe985] px-6 py-3 text-sm font-black tracking-[0.16em] text-[#101820] uppercase transition hover:bg-white focus:ring-4 focus:ring-[#ffe985]/40 focus:outline-none"
          data-testid="restart"
          type="button"
          onClick={onRestart}
        >
          Restart
        </button>
        <div className="mt-5 text-left">
          <ControlsCheatsheet />
        </div>
      </section>
    </div>
  );
}
