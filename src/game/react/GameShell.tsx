"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "~/auth/AuthProvider";
import { useScores } from "~/scores/ScoreProvider";
import type { LeaderboardEntry } from "~/scores/types";
import { BACKING_TRACK_URL } from "../core";
import { GameController } from "../engine/controller";
import { keyToAction } from "../engine/keymap";
import { TEST_MODE } from "../test-api/flag";
import { installTestApi } from "../test-api/install";
import { ControlsCheatsheet } from "./ControlsCheatsheet";
import { GameCanvas } from "./GameCanvas";

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
  const auth = useAuth();
  const scores = useScores();
  const user = auth.user;
  const leaderboard = scores.leaderboard;
  const personalBest = scores.personalBest;
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const phaseRef = useRef<Phase>("start");
  const submittedRunRef = useRef<string | null>(null);
  phaseRef.current = phase;

  const submitFinalScore = useCallback(
    async (finalScore: number) => {
      if (!user) return;
      const runKey = `${user.subject}:${finalScore}`;
      if (submittedRunRef.current === runKey) return;
      submittedRunRef.current = runKey;
      await scores.submitScore(finalScore);
    },
    [scores, user],
  );

  // Create the controller on the client; wire subscription + test interface.
  useEffect(() => {
    const c = new GameController({ testMode: TEST_MODE, seed: 1 });
    setController(c);
    const unsubscribe = c.subscribe((rs) => {
      setScore(rs.score);
      if (rs.gameOver && phaseRef.current === "playing") setPhase("gameover");
    });
    const uninstall = TEST_MODE ? installTestApi(c) : undefined;
    return () => {
      unsubscribe();
      uninstall?.();
      c.stop();
    };
  }, []);

  useEffect(() => {
    if (!TEST_MODE || !controller || typeof window === "undefined") return;
    if (!window.__lumines) return;

    window.__lumines.auth = {
      signIn: (args) => auth.mockSignIn(args),
      signOut: () => auth.mockSignOut(),
    };
    window.__lumines.endGame = async (finalScore) => {
      controller.testEndGame(finalScore);
      await submitFinalScore(finalScore);
    };

    return () => {
      if (!window.__lumines) return;
      delete window.__lumines.auth;
      delete window.__lumines.endGame;
    };
  }, [auth, controller, submitFinalScore]);

  useEffect(() => {
    if (phase === "gameover") void submitFinalScore(score);
  }, [phase, score, submitFinalScore]);

  // Keyboard controls — active only while playing.
  useEffect(() => {
    if (phase !== "playing" || !controller) return;
    const onKey = (e: KeyboardEvent) => {
      const action = keyToAction(e);
      if (!action) return;
      e.preventDefault();
      controller.input(action, {
        fresh:
          action === "softDrop" || action === "hardDrop" ? !e.repeat : true,
      });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, controller]);

  const handleStart = useCallback(() => {
    if (!controller) return;
    setScore(0);
    submittedRunRef.current = null;
    controller.start();
    audioRef.current?.play().catch(() => undefined);
    setPhase("playing");
  }, [controller]);

  const handleRestart = useCallback(() => {
    if (!controller) return;
    controller.restart(1);
    setScore(0);
    submittedRunRef.current = null;
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
        <Header
          user={user}
          personalBest={personalBest}
          onSignIn={() => auth.signIn()}
          onSignOut={() => auth.signOut()}
        />

        {phase === "start" && (
          <StartScreen leaderboard={leaderboard} onStart={handleStart} />
        )}

        {phase === "playing" && controller && (
          <PlayingScreen
            controller={controller}
            score={score}
            personalBest={personalBest}
            userSignedIn={user !== null}
          />
        )}

        {phase === "gameover" && (
          <GameOverScreen
            score={score}
            personalBest={personalBest}
            leaderboard={leaderboard}
            userSignedIn={user !== null}
            onRestart={handleRestart}
          />
        )}
      </div>
    </main>
  );
}

function Header({
  user,
  personalBest,
  onSignIn,
  onSignOut,
}: {
  user: { name: string; image?: string } | null;
  personalBest: number | null;
  onSignIn: () => Promise<void>;
  onSignOut: () => Promise<void>;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <h1 className="bg-gradient-to-r from-[#37e0c9] to-[#ff5fb0] bg-clip-text text-3xl font-black tracking-tight text-transparent sm:text-4xl">
        LLMines
      </h1>
      <div className="flex flex-wrap items-center justify-end gap-3">
        <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 backdrop-blur">
          <div className="text-[0.62rem] font-bold tracking-widest text-white/45 uppercase">
            Best
          </div>
          <div
            data-testid="personal-best"
            className="font-mono text-lg font-black tabular-nums"
          >
            {personalBest ?? "--"}
          </div>
        </div>
        <AuthPanel user={user} onSignIn={onSignIn} onSignOut={onSignOut} />
      </div>
    </div>
  );
}

function AuthPanel({
  user,
  onSignIn,
  onSignOut,
}: {
  user: { name: string; image?: string } | null;
  onSignIn: () => Promise<void>;
  onSignOut: () => Promise<void>;
}) {
  if (!user) {
    return (
      <button
        data-testid="signin"
        onClick={() => void onSignIn()}
        className="rounded-lg bg-white px-4 py-2 text-sm font-black text-[#070912] transition hover:brightness-110 focus:ring-4 focus:ring-white/20 focus:outline-none"
      >
        Sign in with Google
      </button>
    );
  }

  return (
    <div className="flex items-center gap-3 rounded-lg border border-white/10 bg-white/5 px-3 py-2 backdrop-blur">
      {user.image && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={user.image}
          alt=""
          className="h-8 w-8 rounded-full border border-white/20"
        />
      )}
      <span
        data-testid="user-name"
        className="max-w-36 truncate text-sm font-bold text-white"
      >
        {user.name}
      </span>
      <button
        data-testid="signout"
        onClick={() => void onSignOut()}
        className="rounded-md border border-white/15 px-2 py-1 text-xs font-bold text-white/80 transition hover:bg-white/10 focus:ring-4 focus:ring-white/15 focus:outline-none"
      >
        Sign out
      </button>
    </div>
  );
}

function StartScreen({
  leaderboard,
  onStart,
}: {
  leaderboard: LeaderboardEntry[];
  onStart: () => void;
}) {
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
      <div className="flex flex-col gap-4">
        <LeaderboardPanel entries={leaderboard} />
        <ControlsCheatsheet />
      </div>
    </section>
  );
}

function PlayingScreen({
  controller,
  score,
  personalBest,
  userSignedIn,
}: {
  controller: GameController;
  score: number;
  personalBest: number | null;
  userSignedIn: boolean;
}) {
  return (
    <section
      aria-label="Game"
      className="grid items-start gap-6 md:grid-cols-[1fr_240px]"
    >
      <GameCanvas controller={controller} score={score} />
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
        <div className="rounded-xl border border-white/10 bg-white/5 p-4 backdrop-blur">
          <div className="text-xs tracking-widest text-white/50 uppercase">
            Personal best
          </div>
          <div className="mt-1 font-mono text-3xl font-black tabular-nums">
            {personalBest ?? "--"}
          </div>
          {!userSignedIn && (
            <p className="mt-2 text-xs text-white/55">
              Sign in to save scores.
            </p>
          )}
        </div>
        <ControlsCheatsheet compact />
      </aside>
    </section>
  );
}

function GameOverScreen({
  score,
  personalBest,
  leaderboard,
  userSignedIn,
  onRestart,
}: {
  score: number;
  personalBest: number | null;
  leaderboard: LeaderboardEntry[];
  userSignedIn: boolean;
  onRestart: () => void;
}) {
  return (
    <section
      aria-label="Game over"
      className="grid gap-6 md:grid-cols-[1fr_320px]"
    >
      <div
        data-testid="game-over"
        className="rounded-2xl border border-white/10 bg-white/5 p-10 text-center backdrop-blur"
      >
        <h2 className="text-3xl font-black tracking-tight text-[#ff5fb0]">
          Game over
        </h2>
        <div className="mt-6 text-xs tracking-widest text-white/50 uppercase">
          Final score
        </div>
        <div className="font-mono text-6xl font-black tabular-nums">
          {score}
        </div>
        <div className="mt-5 rounded-xl border border-white/10 bg-black/20 p-4">
          <div className="text-xs tracking-widest text-white/50 uppercase">
            Personal best
          </div>
          <div className="font-mono text-4xl font-black tabular-nums">
            {personalBest ?? "--"}
          </div>
          {!userSignedIn && (
            <p className="mt-2 text-sm text-white/60">
              Sign in to save this score.
            </p>
          )}
        </div>
        <button
          data-testid="restart"
          onClick={onRestart}
          autoFocus
          className="mt-8 rounded-xl bg-gradient-to-r from-[#ff5fb0] to-[#c93f87] px-8 py-3 text-lg font-bold text-white shadow-lg transition hover:brightness-110 focus:ring-4 focus:ring-[#ff5fb0]/40 focus:outline-none"
        >
          Play again
        </button>
      </div>
      <LeaderboardPanel entries={leaderboard} />
    </section>
  );
}

function LeaderboardPanel({ entries = [] }: { entries?: LeaderboardEntry[] }) {
  return (
    <section
      data-testid="leaderboard"
      aria-label="Global leaderboard"
      className="rounded-xl border border-white/10 bg-white/5 p-4 backdrop-blur"
    >
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-black tracking-widest text-white/75 uppercase">
          Global Top 10
        </h2>
      </div>
      {entries.length === 0 ? (
        <p className="text-sm text-white/50">No saved scores yet.</p>
      ) : (
        <ol className="space-y-2">
          {entries.map((entry, index) => (
            <li
              key={entry.subject}
              data-testid="leaderboard-row"
              className="grid grid-cols-[2rem_1fr_auto] items-center gap-2 rounded-lg bg-black/20 px-3 py-2"
            >
              <span className="font-mono text-sm font-black text-white/45">
                {index + 1}
              </span>
              <span className="truncate text-sm font-bold text-white/85">
                {entry.name}
              </span>
              <span className="font-mono text-sm font-black text-[#fff2a8] tabular-nums">
                {entry.score}
              </span>
            </li>
          ))}
        </ol>
      )}
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
