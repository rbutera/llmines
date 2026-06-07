"use client";

// Game_Over_Screen (Req 9.2, 9.3, 11.4, 20.2, 20.4).
//
// Shows the final score and a restart control. The restart button carries
// `data-testid="restart"` and a dedicated element carries
// `data-testid="game-over"`, both emitted only in Test_Mode. `onRestart`
// returns to a fresh playable session (score reset to 0, Req 9.3).

import { tid } from "~/app/_game/testMode";

export interface GameOverScreenProps {
  /** The final score to display (Req 9.2). */
  score: number;
  /** Restart into a fresh session (Req 9.3, 11.4). */
  onRestart: () => void;
}

/**
 * The end-of-session screen, styled to match the start and in-game screens
 * (Req 14.4).
 */
export function GameOverScreen({
  score,
  onRestart,
}: GameOverScreenProps): React.JSX.Element {
  return (
    <div
      {...tid("game-over")}
      className="flex w-full max-w-md flex-col items-center gap-8 text-center"
    >
      <div>
        <h1 className="text-5xl font-extrabold tracking-tight text-amber-300">
          Game Over
        </h1>
        <p className="mt-4 text-sm tracking-wide text-white/60 uppercase">
          Final Score
        </p>
        <p className="mt-1 font-mono text-6xl font-bold text-teal-300 tabular-nums">
          {score}
        </p>
      </div>

      <button
        type="button"
        {...tid("restart")}
        onClick={onRestart}
        className="rounded-full bg-gradient-to-r from-teal-400 to-amber-400 px-10 py-3 text-lg font-bold text-slate-900 shadow-lg transition hover:brightness-110 focus:outline-none focus-visible:ring-4 focus-visible:ring-teal-300/50"
      >
        Play Again
      </button>
    </div>
  );
}

export default GameOverScreen;
