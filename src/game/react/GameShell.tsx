"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BACKING_TRACK_URL } from "../core";
import { GameController } from "../engine/controller";
import { keyToAction } from "../engine/keymap";
import { TEST_MODE } from "../test-api/flag";
import { installTestApi } from "../test-api/install";
import { mockAuth } from "./auth/mockAuth";
import { AuthControls } from "./AuthControls";
import { ControlsCheatsheet } from "./ControlsCheatsheet";
import { GameCanvas } from "./GameCanvas";
import { LeaderboardPanel } from "./LeaderboardPanel";
import { ScoreFx } from "./ScoreFx";
import { useAuth } from "./providers/AuthProvider";
import { useScores } from "./providers/ScoresProvider";

type Phase = "start" | "playing" | "gameover";

/**
 * Top-level client component: owns the single GameController, the phase
 * machine (start / playing / gameover), the HUD, audio, keyboard, and (only in
 * test mode) the window.__lumines interface. Renders the single <main> landmark.
 */
export function GameShell() {
  const [phase, setPhase] = useState<Phase>("start");
  const [score, setScore] = useState(0);
  const [controller, setController] = useState<GameController | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const phaseRef = useRef<Phase>("start");
  phaseRef.current = phase;

  const auth = useAuth();
  const scores = useScores();

  // The single game-over path: record the final score (signed-in only) and show
  // the game-over screen. Used by BOTH the real game (controller reports
  // gameOver) and the deterministic test hook `window.__lumines.endGame(score)`.
  const handleGameOver = useCallback(
    (finalScore: number) => {
      setScore(finalScore);
      phaseRef.current = "gameover";
      setPhase("gameover");
      if (auth.status === "authenticated") scores.submit(finalScore);
    },
    [auth.status, scores],
  );
  const handleGameOverRef = useRef(handleGameOver);
  handleGameOverRef.current = handleGameOver;

  // Create the controller on the client; wire subscription + test interface.
  useEffect(() => {
    const c = new GameController({ testMode: TEST_MODE, seed: 1 });
    setController(c);
    const unsubscribe = c.subscribe((rs) => {
      setScore(rs.score);
      if (rs.gameOver && phaseRef.current === "playing") {
        handleGameOverRef.current(rs.score);
      }
    });
    const uninstall = TEST_MODE ? installTestApi(c) : undefined;
    return () => {
      unsubscribe();
      uninstall?.();
      c.stop();
    };
  }, []);

  // TEST_MODE only: augment window.__lumines (installed above) with the auth +
  // endGame hooks. Gated exactly like the game hooks; never shipped.
  useEffect(() => {
    if (!TEST_MODE || typeof window === "undefined") return;
    const attach = () => {
      const api = window.__lumines;
      if (!api) return false;
      api.auth = {
        signIn: (identity: { name: string; subject: string; avatar?: string }) =>
          mockAuth.signIn(identity),
        signOut: () => mockAuth.signOut(),
      };
      api.endGame = (s: number) => handleGameOverRef.current(s);
      return true;
    };
    if (attach()) return;
    const id = window.setTimeout(attach, 0);
    return () => window.clearTimeout(id);
  }, []);

  // Keyboard controls — active only while playing.
  useEffect(() => {
    if (phase !== "playing" || !controller) return;
    const onKey = (e: KeyboardEvent) => {
      const action = keyToAction(e);
      if (!action) return;
      e.preventDefault();
      // `e.repeat` is false on the initial press and true for OS key-repeat. A
      // drop key held across a lock keeps firing repeat events; passing
      // fresh=!e.repeat lets the controller require a deliberate re-press to drop
      // a freshly spawned (holding) block.
      controller.input(action, { fresh: !e.repeat });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, controller]);

  const handleStart = useCallback(() => {
    if (!controller) return;
    setScore(0);
    controller.start();
    audioRef.current?.play().catch(() => undefined);
    setPhase("playing");
  }, [controller]);

  const handleRestart = useCallback(() => {
    if (!controller) return;
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

      <div className="relative z-10 w-full max-w-5xl">
        <Header />

        {phase === "start" && <StartScreen onStart={handleStart} />}

        {phase === "playing" && controller && (
          <PlayingScreen controller={controller} score={score} />
        )}

        {phase === "gameover" && (
          <GameOverScreen score={score} onRestart={handleRestart} />
        )}
      </div>
    </main>
  );
}

function Header() {
  return (
    <div className="mb-6 flex items-end justify-between">
      <h1 className="bg-gradient-to-r from-[#37e0c9] to-[#ff5fb0] bg-clip-text text-3xl font-black tracking-tight text-transparent sm:text-4xl">
        LLMines
      </h1>
      <AuthControls />
    </div>
  );
}

function StartScreen({ onStart }: { onStart: () => void }) {
  return (
    <section
      aria-label="Start"
      className="grid items-start gap-6 md:grid-cols-[1fr_280px]"
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
        <ControlsCheatsheet />
        <LeaderboardPanel />
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
        {/* Cosmetic in-view score juice. The authoritative number stays in the
            HUD `score` testid below; this overlay never alters it. */}
        <ScoreFx score={score} />
      </div>
      <aside className="flex flex-col gap-4">
        <div className="rounded-xl border border-white/10 bg-white/5 p-4 backdrop-blur">
          <div className="text-xs tracking-widest text-white/50 uppercase">
            Score
          </div>
          <div
            data-testid="score"
            className="mt-1 font-mono text-4xl font-black tabular-nums"
          >
            {score}
          </div>
        </div>
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
  const auth = useAuth();
  return (
    <section
      data-testid="game-over"
      aria-label="Game over"
      className="mx-auto grid max-w-3xl gap-6 md:grid-cols-[1fr_280px]"
    >
      <div className="rounded-2xl border border-white/10 bg-white/5 p-10 text-center backdrop-blur">
        <h2 className="text-3xl font-black tracking-tight text-[#ff5fb0]">
          Game over
        </h2>
        <div className="mt-6 text-xs tracking-widest text-white/50 uppercase">
          Final score
        </div>
        <div className="font-mono text-6xl font-black tabular-nums">{score}</div>
        {auth.status !== "authenticated" && (
          <p data-testid="signin-prompt" className="mt-4 text-sm text-white/60">
            Sign in to save your score and join the leaderboard.
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
      <LeaderboardPanel />
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
