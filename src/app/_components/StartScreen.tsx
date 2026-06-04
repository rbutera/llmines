import { ControlsCheatsheet } from "./ControlsCheatsheet";

export function StartScreen({ onStart }: { onStart: () => void }) {
  return (
    <div className="flex w-full max-w-3xl flex-col items-center gap-8 text-center">
      <div className="flex flex-col items-center gap-3">
        <h1 className="bg-gradient-to-r from-amber-300 via-fuchsia-300 to-cyan-300 bg-clip-text text-6xl font-black tracking-tight text-transparent sm:text-7xl">
          LLMines
        </h1>
        <p className="max-w-md text-balance text-white/70">
          A music-synced block puzzle. Build same-coloured squares and let the
          timeline sweep clear them in rhythm.
        </p>
      </div>

      <button
        data-testid="start-button"
        onClick={onStart}
        autoFocus
        className="group relative rounded-full bg-gradient-to-r from-amber-400 to-fuchsia-500 px-10 py-4 text-lg font-bold text-black shadow-lg shadow-fuchsia-500/30 transition hover:scale-105 hover:shadow-fuchsia-500/50 focus:outline-none focus-visible:ring-4 focus-visible:ring-cyan-300/60"
      >
        Start Game
      </button>

      <div className="w-full max-w-sm">
        <ControlsCheatsheet />
      </div>
    </div>
  );
}
