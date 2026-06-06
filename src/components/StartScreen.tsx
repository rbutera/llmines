"use client";

import { ControlsCheatsheet } from "./ControlsCheatsheet";

interface StartScreenProps {
  onStart: () => void;
  visible: boolean;
}

export function StartScreen({ onStart, visible }: StartScreenProps) {
  return (
    <div
      className={`absolute inset-0 z-20 flex items-center justify-center bg-gradient-to-b from-[#0a0a1a] to-[#1a1035] transition-opacity duration-300 ${
        visible ? "opacity-100" : "pointer-events-none opacity-0"
      }`}
    >
      <div className="flex max-w-md flex-col items-center gap-6 px-6 text-center">
        {/* Title */}
        <div className="space-y-2">
          <h1 className="text-5xl font-bold tracking-tight text-white">
            LL<span className="text-[#ff6b9d]">Mines</span>
          </h1>
          <p className="text-sm text-white/40">A Lumines-inspired puzzle game</p>
        </div>

        {/* Instructions */}
        <div
          data-testid="instructions"
          className="rounded-lg border border-white/10 bg-white/5 px-5 py-4 text-sm leading-relaxed text-white/70"
        >
          Manipulate falling 2×2 blocks to form same-colour 2×2 squares.
          Squares are cleared by the sweep bar to earn points.
        </div>

        {/* Controls */}
        <ControlsCheatsheet />

        {/* Start Button */}
        <button
          data-testid="start-button"
          onClick={onStart}
          className="mt-2 rounded-lg bg-gradient-to-r from-[#ff6b9d] to-[#c850c0] px-8 py-3 text-lg font-semibold text-white shadow-lg transition-all hover:scale-105 hover:shadow-xl focus:outline-none focus:ring-2 focus:ring-cyan-400"
          autoFocus
        >
          Start Game
        </button>
      </div>
    </div>
  );
}
