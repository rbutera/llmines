"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BACKING_TRACK_URL } from "../core";
import { GameController } from "../engine/controller";
import { keyToAction } from "../engine/keymap";
import { LeaderboardProvider, useLeaderboard } from "../leaderboard/context";
import { TEST_MODE } from "../test-api/flag";
import { installTestApi } from "../test-api/install";
import { AuthPanel } from "./AuthPanel";
import { ControlsCheatsheet } from "./ControlsCheatsheet";
import { GameCanvas } from "./GameCanvas";
import { Leaderboard } from "./Leaderboard";
import { ScoreOverlay } from "./ScoreOverlay";

type Phase = "start" | "playing" | "gameover";

/**
 * Top-level client component: owns the single GameController, the phase
 * machine (start / playing / gameover), the HUD, audio, keyboard, the auth +
 * leaderboard seam, and (only in test mode) the window.__lumines interface.
 */
export function GameShell() {
  const [phase, setPhase] = useState<Phase>("start");
  const [score, setScore] = useState(0);
  // Created eagerly (pure constructor) so the leaderboard provider always has it.
  const [controller] = useState(
    () => new GameController({ testMode: TEST_MODE, seed: 1 }),
  );
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const phaseRef = useRef<Phase>("start");
  phaseRef.current = phase;

  // Wire subscription + (test mode) the window.__lumines interface.
  useEffect(() => {
    const unsubscribe = controller.subscribe((rs) => {
      setScore(rs.score);
      // Allow the game-over transition from any non-gameover phase so the
      // deterministic endGame() hook works even before a manual start.
      if (rs.gameOver && phaseRef.current !== "gameover") setPhase("gameover");
    });
    const uninstall = TEST_MODE ? installTestApi(controller) : undefined;
    return () => {
      unsubscribe();
      uninstall?.();
      controller.stop();
    };
  }, [controller]);

  // Keyboard controls — active only while playing.
  useEffect(() => {
    if (phase !== "playing") return;
    const onKey = (e: KeyboardEvent) => {
      const action = keyToAction(e);
      if (!action) return;
      e.preventDefault();
      // Drop keys must be DELIBERATE: only a fresh keydown (not OS auto-repeat)
      // counts as a press. This kills the soft-drop-cascade — a key held across
      // a lock produces only repeat events, which are ignored, so the newly
      // spawned (held) block does not auto-fall until the player re-presses.
      if (action === "softDrop") {
        if (!e.repeat) controller.pressSoftDrop();
        return;
      }
      if (action === "hardDrop") {
        if (!e.repeat) controller.pressHardDrop();
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
  }, [phase, controller]);

  const handleStart = useCallback(() => {
    setScore(0);
    controller.start();
    audioRef.current?.play().catch(() => undefined);
    setPhase("playing");
  }, [controller]);

  const handleRestart = useCallback(() => {
    controller.restart(1);
    setScore(0);
    if (audioRef.current) {
      audioRef.current.currentTime = 0;
      audioRef.current.play().catch(() => undefined);
    }
    setPhase("playing");
  }, [controller]);

  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-[#070912] px-4 py-8 text-white">
      <BackdropGlow />
      {/* Looping backing track — present in the DOM so its loop/src are
          inspectable. Live autoplay is not required. */}
      <audio ref={audioRef} src={BACKING_TRACK_URL} loop preload="auto" />

      <LeaderboardProvider controller={controller}>
        <div className="relative z-10 w-full max-w-5xl">
          <Header />

          {phase === "start" && <StartScreen onStart={handleStart} />}

          {phase === "playing" && (
            <PlayingScreen controller={controller} score={score} />
          )}

          {phase === "gameover" && (
            <GameOverScreen score={score} onRestart={handleRestart} />
          )}
        </div>
      </LeaderboardProvider>
    </main>
  );
}

function Header() {
  return (
    <div className="mb-6 flex items-center justify-between gap-4">
      <div className="flex items-end gap-3">
        <h1 className="bg-gradient-to-r from-[#37e0c9] to-[#ff5fb0] bg-clip-text text-3xl font-black tracking-tight text-transparent sm:text-4xl">
          LLMines
        </h1>
        <span className="hidden text-xs tracking-widest text-white/40 uppercase sm:inline">
          a lumines-like
        </span>
      </div>
      <AuthPanel />
    </div>
  );
}

function StartScreen({ onStart }: { onStart: () => void }) {
  return (
    <section
      aria-label="Start"
      className="grid items-start gap-6 md:grid-cols-[1fr_300px]"
    >
      <div className="rounded-2xl border border-white/10 bg-white/5 p-8 backdrop-blur">
        <h2 className="text-2xl font-bold">How to play</h2>
        <p className="mt-3 max-w-prose text-white/70">
          2×2 colour blocks fall onto the field. Line up four cells of the{" "}
          <span className="text-[#37e0c9]">same colour</span> into a square. A
          timeline bar sweeps left-to-right in time with the music, clearing
          every square it crosses. Clear more squares in a single sweep to
          multiply your score. The game ends if the stack reaches the top.
        </p>
        <button
          data-testid="start-button"
          onClick={onStart}
          autoFocus
          className="mt-6 rounded-xl bg-gradient-to-r from-[#37e0c9] to-[#16b89f] px-8 py-3 text-lg font-bold text-[#04140f] shadow-lg transition hover:brightness-110 focus:ring-4 focus:ring-[#37e0c9]/40 focus:outline-none"
        >
          Start game
        </button>
      </div>
      <div className="flex flex-col gap-6">
        <Leaderboard />
        <ControlsCheatsheet />
      </div>
    </section>
  );
}

function PlayingScreen({
  controller,
  score,
}: {
  controller: GameController;
  score: number;
}) {
  return (
    <section
      aria-label="Game"
      className="grid items-start gap-6 md:grid-cols-[1fr_240px]"
    >
      <div className="relative">
        <GameCanvas controller={controller} />
        <ScoreOverlay score={score} />
      </div>
      <aside className="flex flex-col gap-4">
        <ControlsCheatsheet compact />
      </aside>
    </section>
  );
}

function GameOverScreen({
  score,
  onRestart,
}: {
  score: number;
  onRestart: () => void;
}) {
  const { user, submitScore } = useLeaderboard();
  const submittedRef = useRef(false);

  // The REAL game-over path: submit the final score once when signed in.
  // Signed-out runs are never written (the unauthenticated rule).
  useEffect(() => {
    if (submittedRef.current) return;
    submittedRef.current = true;
    if (user) submitScore(score);
  }, [user, score, submitScore]);

  return (
    <section
      data-testid="game-over"
      aria-label="Game over"
      className="grid items-start gap-6 md:grid-cols-[1fr_320px]"
    >
      <div className="rounded-2xl border border-white/10 bg-white/5 p-10 text-center backdrop-blur">
        <h2 className="text-3xl font-black tracking-tight text-[#ff5fb0]">
          Game over
        </h2>
        <div className="mt-6 text-xs tracking-widest text-white/50 uppercase">
          Final score
        </div>
        <div className="font-mono text-6xl font-black tabular-nums">
          {score}
        </div>
        {!user && (
          <p className="mt-4 text-sm text-white/50">
            Sign in to save your score to the global leaderboard.
          </p>
        )}
        <button
          data-testid="restart"
          onClick={onRestart}
          autoFocus
          className="mt-8 rounded-xl bg-gradient-to-r from-[#ff5fb0] to-[#c93f87] px-8 py-3 text-lg font-bold text-white shadow-lg transition hover:brightness-110 focus:ring-4 focus:ring-[#ff5fb0]/40 focus:outline-none"
        >
          Play again
        </button>
      </div>
      <Leaderboard />
    </section>
  );
}

function BackdropGlow() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0">
      <div className="absolute -top-32 -left-24 h-96 w-96 rounded-full bg-[#37e0c9]/10 blur-3xl" />
      <div className="absolute -right-24 -bottom-32 h-96 w-96 rounded-full bg-[#ff5fb0]/10 blur-3xl" />
    </div>
  );
}
