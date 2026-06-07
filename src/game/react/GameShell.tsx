"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AccountBar, Leaderboard, PersonalBest } from "../account/AccountUI";
import { useAuth, useScores } from "../account/context";
import {
  BACKING_TRACK_URL,
  type GeneratedPiece,
  PREVIEW_DEPTH,
  skinAt,
} from "../core";
import { GameController, type RenderState } from "../engine/controller";
import { keyToAction } from "../engine/keymap";
import { TEST_MODE } from "../test-api/flag";
import { installTestApi } from "../test-api/install";
import { ControlsCheatsheet } from "./ControlsCheatsheet";
import { GameCanvas } from "./GameCanvas";
import { ScoreFx } from "./ScoreFx";

type Phase = "start" | "playing" | "gameover";

/**
 * Top-level client component: owns the single GameController, the phase
 * machine (start / playing / gameover), the HUD, audio, keyboard, and (only in
 * test mode) the window.__lumines interface. Renders the single <main> landmark.
 */
export function GameShell() {
  const [phase, setPhase] = useState<Phase>("start");
  const [score, setScore] = useState(0);
  const [hud, setHud] = useState<{
    queue: GeneratedPiece[];
    skinIndex: number;
    bpm: number;
  }>({ queue: [], skinIndex: 0, bpm: 0 });
  const [controller, setController] = useState<GameController | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const phaseRef = useRef<Phase>("start");
  phaseRef.current = phase;

  // Account seam: submit the final score on game over (signed-in only). Held in
  // refs so the mount-once subscription always sees the current values.
  const { user } = useAuth();
  const { submitScore } = useScores();
  const submitRef = useRef(submitScore);
  submitRef.current = submitScore;
  const userRef = useRef(user);
  userRef.current = user;
  const gameOverSubmittedRef = useRef(false);

  // Create the controller on the client; wire subscription + test interface.
  useEffect(() => {
    const c = new GameController({ testMode: TEST_MODE, seed: 1 });
    setController(c);
    const unsubscribe = c.subscribe((rs: RenderState) => {
      setScore(rs.score);
      // V2 HUD: preview queue, skin, BPM (drives NextPreview + skin panel).
      setHud({ queue: rs.queue, skinIndex: rs.skinIndex, bpm: rs.bpm });
      if (rs.gameOver) {
        // Brownfield: run the score-submit path exactly once per game over.
        // `rs.score` is now V2's score (squares*40 + combo curve), so the
        // leaderboard submit reads the V2 scoring shape. Unauthenticated runs
        // submit nothing (the signed-out rule); the mutation/mock also enforce
        // it server-side.
        if (!gameOverSubmittedRef.current) {
          gameOverSubmittedRef.current = true;
          if (userRef.current) void submitRef.current(rs.score);
        }
        if (phaseRef.current === "playing") setPhase("gameover");
      }
    });
    const uninstall = TEST_MODE ? installTestApi(c) : undefined;
    return () => {
      unsubscribe();
      uninstall?.();
      c.stop();
    };
  }, []);

  // Keyboard controls — active only while playing.
  useEffect(() => {
    if (phase !== "playing" || !controller) return;
    const onKey = (e: KeyboardEvent) => {
      const action = keyToAction(e);
      if (!action) return;
      e.preventDefault();
      // A FRESH keydown (not an OS key-repeat) is a deliberate press: it ends
      // the spawn-hold and engages the drop. A carried-over key-repeat routes
      // to input(), which is a no-op while the new block is held — so a key
      // still down from the previous piece cannot cascade into this one.
      if (action === "softDrop" || action === "hardDrop") {
        if (e.repeat) {
          controller.input(action);
        } else if (action === "softDrop") {
          controller.pressSoftDrop();
        } else {
          controller.pressHardDrop();
        }
        return;
      }
      controller.input(action);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, controller]);

  const handleStart = useCallback(() => {
    if (!controller) return;
    setScore(0);
    gameOverSubmittedRef.current = false;
    controller.start();
    audioRef.current?.play().catch(() => undefined);
    setPhase("playing");
  }, [controller]);

  const handleRestart = useCallback(() => {
    if (!controller) return;
    controller.restart(1);
    setScore(0);
    gameOverSubmittedRef.current = false;
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

      {/* While playing, the board takes (almost) the whole viewport: a much wider
          container + a near-full-height canvas region (FIX 4). Start / game-over
          stay in the original narrower reading column. */}
      <div
        className={`relative z-10 w-full ${
          phase === "playing" ? "max-w-[1800px]" : "max-w-5xl"
        }`}
      >
        <Header />

        {phase === "start" && <StartScreen onStart={handleStart} />}

        {phase === "playing" && controller && (
          <PlayingScreen controller={controller} score={score} hud={hud} />
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
    <div className="mb-6 flex items-center justify-between gap-4">
      <div className="flex items-baseline gap-3">
        <h1 className="bg-gradient-to-r from-[#37e0c9] to-[#ff5fb0] bg-clip-text text-3xl font-black tracking-tight text-transparent sm:text-4xl">
          LLMines
        </h1>
        <span className="hidden text-xs tracking-widest text-white/40 uppercase sm:inline">
          a lumines-like
        </span>
      </div>
      <AccountBar />
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
        <PersonalBest />
        <Leaderboard />
      </div>
    </section>
  );
}

function PlayingScreen({
  controller,
  score,
  hud,
}: {
  controller: GameController;
  score: number;
  hud: { queue: GeneratedPiece[]; skinIndex: number; bpm: number };
}) {
  const skin = skinAt(hud.skinIndex);
  return (
    <section
      aria-label="Game"
      className="grid items-stretch gap-6 md:grid-cols-[1fr_280px]"
    >
      {/* Relative wrapper so the cosmetic ScoreFx overlay sits over the field.
          FIX 4: the board fills the available height (near-full viewport minus
          the header/padding) instead of being capped by the old narrow column.
          The canvas keeps its 16:10 aspect (width follows height) and is centred
          in the column, so it is as big as the viewport allows without cropping
          the well or the preview dock. */}
      <div className="relative flex h-[calc(100vh-9rem)] min-h-[420px] items-center justify-center">
        <GameCanvas controller={controller} />
        <ScoreFx score={score} />
      </div>
      <aside className="flex flex-col gap-4">
        <div className="rounded-xl border border-white/10 bg-white/5 p-4 backdrop-blur">
          <div className="text-xs tracking-widest text-white/50 uppercase">
            Score
          </div>
          {/* Authoritative value: exact integer, instant. The pop is a pure
              CSS transform (text never changes), so assertions stay stable. */}
          <div
            key={score}
            data-testid="score"
            className="score-pop mt-1 font-mono text-4xl font-black tabular-nums"
          >
            {score}
          </div>
        </div>
        <NextPreview queue={hud.queue} palette={skin.blockPalette} />
        <div className="rounded-xl border border-white/10 bg-white/5 p-4 backdrop-blur">
          <div className="text-xs tracking-widest text-white/50 uppercase">
            Skin
          </div>
          <div className="mt-1 flex items-baseline justify-between">
            <span data-testid="skin-id" className="text-sm font-semibold">
              {skin.id}
            </span>
            <span
              data-testid="bpm"
              className="font-mono text-sm tabular-nums text-white/60"
            >
              {hud.bpm} BPM
            </span>
          </div>
        </div>
        <ControlsCheatsheet compact />
      </aside>
    </section>
  );
}

/**
 * Render-only next-3 preview. Reads the controller's queue (render projection)
 * and draws each upcoming 2x2 piece, flagging any that carries a chain special.
 */
function NextPreview({
  queue,
  palette,
}: {
  queue: GeneratedPiece[];
  palette: readonly [string, string];
}) {
  const upcoming = queue.slice(0, PREVIEW_DEPTH);
  return (
    <div
      data-testid="preview"
      className="rounded-xl border border-white/10 bg-white/5 p-4 backdrop-blur"
    >
      <div className="text-xs tracking-widest text-white/50 uppercase">Next</div>
      <ol className="mt-3 flex gap-3">
        {upcoming.map((gp, i) => (
          <li key={i} className="flex flex-col items-center gap-1">
            <PiecePreview piece={gp} palette={palette} />
            {gp.special && (
              <span
                data-testid="preview-special"
                className="text-[10px] font-bold tracking-wide text-[#ffd166] uppercase"
              >
                chain
              </span>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}

function PiecePreview({
  piece,
  palette,
}: {
  piece: GeneratedPiece;
  palette: readonly [string, string];
}) {
  const flat = [
    piece.cells[0][0],
    piece.cells[0][1],
    piece.cells[1][0],
    piece.cells[1][1],
  ];
  return (
    <div className="grid grid-cols-2 gap-0.5">
      {flat.map((color, idx) => {
        const isChain = piece.special?.cellIndex === idx;
        return (
          <span
            key={idx}
            className="h-5 w-5 rounded-sm"
            style={{
              backgroundColor: palette[color],
              boxShadow: isChain ? "inset 0 0 0 2px #ffd166" : undefined,
            }}
          />
        );
      })}
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
    <section
      data-testid="game-over"
      aria-label="Game over"
      className="mx-auto grid max-w-3xl items-start gap-6 md:grid-cols-[1fr_280px]"
    >
      <div className="rounded-2xl border border-white/10 bg-white/5 p-10 text-center backdrop-blur">
        <h2 className="text-3xl font-black tracking-tight text-[#ff5fb0]">
          Game over
        </h2>
        <div className="mt-6 text-xs tracking-widest text-white/50 uppercase">
          Final score
        </div>
        <div className="font-mono text-6xl font-black tabular-nums">{score}</div>
        <button
          data-testid="restart"
          onClick={onRestart}
          autoFocus
          className="mt-8 rounded-xl bg-gradient-to-r from-[#ff5fb0] to-[#c93f87] px-8 py-3 text-lg font-bold text-white shadow-lg transition hover:brightness-110 focus:ring-4 focus:ring-[#ff5fb0]/40 focus:outline-none"
        >
          Play again
        </button>
      </div>
      <div className="flex flex-col gap-6">
        <PersonalBest />
        <Leaderboard />
      </div>
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
