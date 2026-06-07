"use client";

// Start_Screen (Req 11.1, 12.1, 20.1, 20.5).
//
// Presents the title, a short tagline, the Controls_Cheatsheet, and the start
// control. The start button carries `data-testid="start-button"` only in
// Test_Mode (Req 20.1) and invokes `onStart` on click (Req 11.2).

import { ControlsCheatsheet } from "~/app/_game/ControlsCheatsheet";
import { tid } from "~/app/_game/testMode";

export interface StartScreenProps {
  /** Begin a new playable session. */
  onStart: () => void;
}

/**
 * The landing screen. Keyboard-focusable start button, cohesive dark-violet
 * theme shared with the in-game and game-over screens (Req 14.4).
 */
export function StartScreen({ onStart }: StartScreenProps): React.JSX.Element {
  return (
    <div className="flex w-full max-w-md flex-col items-center gap-8">
      <div className="text-center">
        <h1 className="bg-gradient-to-r from-teal-300 to-amber-300 bg-clip-text text-6xl font-extrabold tracking-tight text-transparent">
          LLMines
        </h1>
        <p className="mt-3 text-base text-white/60">
          A music-synced puzzle: stack blocks, build squares, ride the sweep.
        </p>
      </div>

      <button
        type="button"
        {...tid("start-button")}
        onClick={onStart}
        className="rounded-full bg-gradient-to-r from-teal-400 to-amber-400 px-10 py-3 text-lg font-bold text-slate-900 shadow-lg transition hover:brightness-110 focus:outline-none focus-visible:ring-4 focus-visible:ring-teal-300/50"
      >
        Start Game
      </button>

      <ControlsCheatsheet className="w-full" />
    </div>
  );
}

export default StartScreen;
